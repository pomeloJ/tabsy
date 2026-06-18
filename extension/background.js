import { getAll, getById, save, getConflicts, getAutoSync } from './lib/storage.js';
import { performSync, isSyncConfigured } from './lib/sync.js';
import { applyMergedState } from './lib/live-sync.js';
import { captureWindow, detectWorkspaceWindows, hasWorkspaceChanged } from './lib/capture.js';
import { detectClosedTabs, refreshSnapshots } from './lib/closed-tabs.js';
import { FlowRunner } from './lib/flow-runner.js';
import { hasDangerousBlocks } from './lib/flow-schema.js';

const MARKER_BASE = chrome.runtime.getURL('marker.html');
function isMarkerUrl(url) { return url?.startsWith(MARKER_BASE); }
const SYNC_ALARM_NAME = 'tabsy-auto-sync';
const SYNC_INTERVAL_MINUTES = 0.5; // 30 seconds

// --- Alarm setup ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    delayInMinutes: SYNC_INTERVAL_MINUTES,
    periodInMinutes: SYNC_INTERVAL_MINUTES
  });
});

chrome.runtime.onStartup.addListener(async () => {
  const existing = await chrome.alarms.get(SYNC_ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(SYNC_ALARM_NAME, {
      delayInMinutes: SYNC_INTERVAL_MINUTES,
      periodInMinutes: SYNC_INTERVAL_MINUTES
    });
  }
});

// --- Auto-sync on alarm ---

let syncInProgress = false;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SYNC_ALARM_NAME) return;
  if (syncInProgress) return;

  const enabled = await getAutoSync();
  if (!enabled) return;

  syncInProgress = true;
  try {
    await autoSyncCycle();
  } catch (e) {
    console.error('[Tabsy] Auto-sync error:', e);
  } finally {
    syncInProgress = false;
  }
});

async function autoSyncCycle() {
  // Step 1: Detect all workspace windows
  const wsWindows = await detectWorkspaceWindows();

  // Step 1b: Detect user-closed tabs vs the previous (post-sync) snapshot.
  // Runs before sync so it only sees user actions during the idle gap; the
  // snapshot is refreshed after sync so sync-driven closures aren't counted.
  const configured = await isSyncConfigured();
  if (configured) {
    try {
      await detectClosedTabs(wsWindows);
    } catch (e) {
      console.warn('[Tabsy] Closed-tab detection error:', e.message);
    }
  }

  let anyChanged = false;

  // Step 2: For each workspace window, re-capture and compare
  for (const { windowId, workspaceId, workspaceName, workspaceColor } of wsWindows) {
    try {
      const stored = await getById(workspaceId);
      if (!stored) continue;
      // Skip workspaces in conflict — don't overwrite with captured state
      if (stored.syncStatus === 'conflict') continue;
      // Skip workspaces with a deferred update awaiting manual apply. Their
      // window is intentionally stale (shows the old state) until the user
      // applies; re-capturing here would clobber the pending server update.
      if (stored.pendingApply) continue;

      const captured = await captureWindow(windowId, workspaceName, workspaceColor, workspaceId);

      if (hasWorkspaceChanged(stored, captured)) {
        // Preserve syncStatus logic: synced → pending, others stay as-is
        if (stored.syncStatus === 'synced') {
          captured.syncStatus = 'pending';
        } else {
          captured.syncStatus = stored.syncStatus || 'pending';
        }
        // Preserve syncedSnapshot from stored workspace
        captured.syncedSnapshot = stored.syncedSnapshot || null;
        await save(captured);
        anyChanged = true;
        console.log(`[Tabsy] Workspace "${workspaceName}" updated (change detected)`);
      }
    } catch (e) {
      // Window may have closed between detection and capture
      console.warn(`[Tabsy] Could not capture window ${windowId}:`, e.message);
    }
  }

  // Step 3: Sync with server if configured
  if (!configured) return;

  const result = await performSync(wsWindows);
  if (result.error) {
    console.warn('[Tabsy] Sync failed:', result.error);
  } else {
    if (result.pulled > 0 || result.pushed > 0 || result.liveUpdates > 0) {
      console.log(`[Tabsy] Sync: ${result.pulled} pulled, ${result.pushed} pushed, ${result.liveUpdates} live updates`);
    }
    if (result.conflicts > 0) {
      console.log(`[Tabsy] ${result.conflicts} conflict(s) detected`);
    }
  }

  // Step 3b: Refresh closed-tab snapshots AFTER sync, reading the real
  // post-sync browser state, so sync-driven tab closures are absorbed into the
  // snapshot and never counted as user closes next cycle.
  try {
    await refreshSnapshots(wsWindows);
  } catch (e) {
    console.warn('[Tabsy] Closed-tab snapshot refresh error:', e.message);
  }

  // Step 4: Update conflict badge
  await updateConflictBadge();

  // Step 5: Refresh each workspace window's badge so a deferred update (↓)
  // surfaces on the extension icon as soon as sync flags it.
  for (const { windowId } of wsWindows) {
    await updateBadge(windowId);
  }
}

// --- Manual apply / ignore of a deferred sync update ---

/**
 * Apply the pending (server-side) update to the workspace's open window.
 * Storage already holds the target state, so we just replay it to the window.
 */
async function applyPendingUpdate(workspaceId) {
  const ws = await getById(workspaceId);
  if (!ws || !ws.pendingApply) return { ok: false };
  const wsWindows = await detectWorkspaceWindows();
  const win = wsWindows.find(w => w.workspaceId === workspaceId);
  if (win) {
    try {
      await applyMergedState(win.windowId, ws.tabs, ws.groups);
      // Reset closed-tab baselines so this sync-driven change isn't counted
      // as user-closed tabs on the next cycle.
      await refreshSnapshots(wsWindows);
    } catch (e) {
      console.warn('[Tabsy] Apply pending update failed:', e.message);
    }
  }
  const fresh = await getById(workspaceId);
  if (fresh) { delete fresh.pendingApply; await save(fresh); }
  if (win) await updateBadge(win.windowId);
  return { ok: true };
}

/**
 * Discard the pending update and keep the current window. We re-capture the
 * live window as the new local truth and rebase its snapshot onto the rejected
 * server state, so the next push makes the local version win (no re-prompt).
 */
async function ignorePendingUpdate(workspaceId) {
  const ws = await getById(workspaceId);
  if (!ws) return { ok: false };
  const wsWindows = await detectWorkspaceWindows();
  const win = wsWindows.find(w => w.workspaceId === workspaceId);
  if (win) {
    try {
      const recaptured = await captureWindow(win.windowId, win.workspaceName, win.workspaceColor, workspaceId);
      recaptured.syncStatus = 'pending';
      // Rebase snapshot onto the rejected server state so local counts as the
      // only change and wins the next merge/push instead of re-deferring.
      recaptured.syncedSnapshot = { tabs: ws.tabs, groups: ws.groups };
      recaptured.flows = ws.flows || [];
      recaptured.notes = ws.notes || [];
      recaptured.lastSyncAt = ws.lastSyncAt || null;
      await save(recaptured);
    } catch (e) {
      console.warn('[Tabsy] Ignore pending update re-capture failed:', e.message);
      delete ws.pendingApply;
      await save(ws);
    }
    await updateBadge(win.windowId);
  } else {
    delete ws.pendingApply;
    await save(ws);
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'resolvePendingApply') {
    const handler = msg.action === 'ignore' ? ignorePendingUpdate : applyPendingUpdate;
    handler(msg.workspaceId).then(sendResponse).catch(e => {
      console.warn('[Tabsy] resolvePendingApply error:', e.message);
      sendResponse({ ok: false, error: e.message });
    });
    return true; // async response
  }
});

// --- Open side panel when clicking the extension icon ---
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// --- Badge updates ---

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  await updateBadge(windowId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateBadge(tab.windowId);
  }

  // --- Flow auto-trigger ---
  if (changeInfo.status === 'complete' && tab.url) {
    await checkFlowTriggers(tabId, tab.url, 'page_load');
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) {
    await updateBadge(removeInfo.windowId);
  }
});

async function updateBadge(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const markerTab = tabs.find(t => isMarkerUrl(t.url));

    if (!markerTab) {
      await chrome.action.setBadgeText({ text: '', windowId });
      await chrome.action.setTitle({ title: 'Tabsy', windowId });
      return;
    }

    const { workspaces = [] } = await chrome.storage.local.get('workspaces');

    let wsName = '';
    let wsColor = '#0078d4';
    if (markerTab.groupId && markerTab.groupId !== -1) {
      try {
        const group = await chrome.tabGroups.get(markerTab.groupId);
        wsName = group.title?.replace(/^📂\s*/, '') || '';
      } catch (e) { /* group may not exist */ }
    }

    const ws = workspaces.find(w => w.name === wsName);
    const idx = ws ? workspaces.indexOf(ws) + 1 : 0;

    if (ws) {
      wsColor = ws.color;
    }

    // Badge priority: conflict (!) > pending update (↓) > workspace index
    const hasConflict = ws && ws.syncStatus === 'conflict';
    const hasPending = ws && ws.pendingApply;
    let badgeColor = wsColor;
    let badgeText = idx ? String(idx) : '';
    let titleSuffix = '';
    if (hasConflict) {
      badgeColor = '#d13438';
      badgeText = '!';
      titleSuffix = ' (conflict)';
    } else if (hasPending) {
      badgeColor = '#0078d4';
      badgeText = '↓';
      titleSuffix = ' (update available)';
    }

    await chrome.action.setBadgeText({ text: badgeText, windowId });
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor, windowId });
    await chrome.action.setTitle({
      title: wsName ? `📂 #${idx} ${wsName}${titleSuffix}` : 'Tabsy',
      windowId
    });
  } catch (e) {
    // Window may have closed during async operations
  }
}

// --- Flow auto-trigger ---

/** Match URL against one or more glob-style patterns (newline-separated, # for comments) */
function matchUrlPattern(pattern, url) {
  if (!pattern) return false;
  const lines = pattern.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const line of lines) {
    const escaped = line.replace(/([.+?^${}()|[\]\\])/g, '\\$1');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    if (regex.test(url)) return true;
  }
  return false;
}

/** Check all flows for auto-triggers matching the given tab */
async function checkFlowTriggers(tabId, url, triggerType) {
  try {
    const allWorkspaces = await getAll();
    for (const ws of allWorkspaces) {
      if (!ws.flows || ws.flows.length === 0) continue;
      for (const flow of ws.flows) {
        if (!flow.enabled) continue;
        if (flow.trigger !== triggerType) continue;
        if (!flow.match) continue;
        if (!matchUrlPattern(flow.match, url)) continue;

        // Block auto-trigger of untrusted flows with dangerous code
        if (hasDangerousBlocks(flow) && !flow.codeTrusted) {
          console.warn(`[Tabsy Flow] Skipped untrusted flow "${flow.name}" — contains dangerous blocks without code trust approval`);
          continue;
        }

        console.log(`[Tabsy Flow] Auto-trigger "${flow.name}" on ${url}`);
        try {
          const runner = new FlowRunner(flow, tabId);
          runner.onLog = (entry) => console.log(`[Flow ${flow.name}]`, entry.message);
          runner.onError = (err) => console.error(`[Flow ${flow.name}] Error:`, err.message);
          await runner.run();
        } catch (e) {
          console.error(`[Tabsy Flow] Failed to run "${flow.name}":`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[Tabsy Flow] Trigger check error:', e);
  }
}

// --- Conflict badge ---

async function updateConflictBadge() {
  try {
    const conflicts = await getConflicts();
    if (conflicts.length === 0) return;

    // For non-workspace windows, show "!" badge to alert user
    const allWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const wsWindows = await detectWorkspaceWindows();
    const wsWindowIds = new Set(wsWindows.map(w => w.windowId));

    for (const win of allWindows) {
      if (!wsWindowIds.has(win.id)) {
        await chrome.action.setBadgeText({ text: '!', windowId: win.id });
        await chrome.action.setBadgeBackgroundColor({ color: '#d13438', windowId: win.id });
        await chrome.action.setTitle({ title: `Tabsy — ${conflicts.length} conflict(s)`, windowId: win.id });
      }
    }

    // For workspace windows with conflicts, updateBadge already handles the "!" badge
    for (const wsWin of wsWindows) {
      await updateBadge(wsWin.windowId);
    }
  } catch (e) {
    // Ignore errors during badge update
  }
}
