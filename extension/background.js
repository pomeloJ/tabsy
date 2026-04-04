import { getAll, getById, save, getConflicts, getAutoSync } from './lib/storage.js';
import { performSync, isSyncConfigured } from './lib/sync.js';
import { captureWindow, detectWorkspaceWindows, hasWorkspaceChanged } from './lib/capture.js';
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

  let anyChanged = false;

  // Step 2: For each workspace window, re-capture and compare
  for (const { windowId, workspaceId, workspaceName, workspaceColor } of wsWindows) {
    try {
      const stored = await getById(workspaceId);
      if (!stored) continue;
      // Skip workspaces in conflict — don't overwrite with captured state
      if (stored.syncStatus === 'conflict') continue;

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
  const configured = await isSyncConfigured();
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

  // Step 4: Update conflict badge
  await updateConflictBadge();
}

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

    // Check if this specific workspace has a conflict
    const hasConflict = ws && ws.syncStatus === 'conflict';
    const badgeColor = hasConflict ? '#d13438' : wsColor;
    const badgeText = hasConflict ? '!' : (idx ? String(idx) : '');

    await chrome.action.setBadgeText({ text: badgeText, windowId });
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor, windowId });
    await chrome.action.setTitle({
      title: wsName ? `📂 #${idx} ${wsName}${hasConflict ? ' (conflict)' : ''}` : 'Tabsy',
      windowId
    });
  } catch (e) {
    // Window may have closed during async operations
  }
}

// --- Flow auto-trigger ---

/** Convert glob-style URL pattern (with * wildcards) to RegExp */
function matchUrlPattern(pattern, url) {
  if (!pattern) return false;
  // Escape regex special chars except *, then replace * with .*
  const escaped = pattern.replace(/([.+?^${}()|[\]\\])/g, '\\$1');
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
  return regex.test(url);
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
