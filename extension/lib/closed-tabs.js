/**
 * Closed-tab history detection.
 *
 * Detects genuinely user-closed tabs in open workspace windows and uploads them
 * to the server so the Web UI can show a "recently closed" list (7-day retention).
 *
 * Design (fully decoupled from the sync engine — touches no sync/live-sync code):
 *  - Each open window has a "live snapshot" of its open tabs, keyed by the
 *    browser windowId (so the same workspace restored into two windows is
 *    tracked independently). Tabs are identified by the browser's persistent
 *    Chrome tab id, so changing a tab's URL is NOT a close.
 *  - detectClosedTabs() runs at the START of each auto-sync cycle and compares
 *    the previous (end-of-last-cycle) snapshot against the current browser state.
 *    A chrome tab id present before but gone now = a real close by the user.
 *  - refreshSnapshots() runs at the END of each cycle, AFTER sync has applied any
 *    remote-driven tab closures. Because the snapshot is taken post-sync, those
 *    sync-driven closes are absorbed and never counted as user closes next cycle.
 *  - Whole-window closes record nothing: the window disappears from
 *    detectWorkspaceWindows(), so there is nothing to compare against, and its
 *    snapshot is dropped (re-restoring later starts fresh via a windowId check).
 */

import { serverNow } from './api-client.js';
import { pushClosedTabs } from './api-client.js';

const MARKER_BASE = chrome.runtime.getURL('marker.html');
function isMarkerUrl(url) { return url?.startsWith(MARKER_BASE); }

const SNAPSHOT_KEY = 'closedTabSnapshots';
const BUFFER_KEY = 'closedTabBuffer';
const MAX_BUFFER = 500;

/** Only http(s) URLs are recordable (skip chrome://, about:, extension pages, blanks). */
function isRecordableUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/** Capture the current open http(s) tabs of a window (array of {chromeTabId,url,title}). */
async function captureLiveSnapshot(windowId) {
  const allTabs = await chrome.tabs.query({ windowId });
  const markerTab = allTabs.find(t => isMarkerUrl(t.url));
  const markerGroupId = markerTab?.groupId ?? -1;

  const tabs = [];
  for (const t of allTabs) {
    if (isMarkerUrl(t.url)) continue;
    if (markerGroupId !== -1 && t.groupId === markerGroupId) continue;
    if (!isRecordableUrl(t.url)) continue;
    tabs.push({ chromeTabId: t.id, url: t.url, title: t.title || '' });
  }
  return tabs;
}

async function getSnapshots() {
  const { [SNAPSHOT_KEY]: snaps } = await chrome.storage.local.get(SNAPSHOT_KEY);
  return snaps || {};
}

async function setSnapshots(snaps) {
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: snaps });
}

async function getBuffer() {
  const { [BUFFER_KEY]: buf } = await chrome.storage.local.get(BUFFER_KEY);
  return Array.isArray(buf) ? buf : [];
}

async function setBuffer(buf) {
  // Cap buffer size — drop oldest if it overflows (offline for a long time)
  const trimmed = buf.length > MAX_BUFFER ? buf.slice(buf.length - MAX_BUFFER) : buf;
  await chrome.storage.local.set({ [BUFFER_KEY]: trimmed });
}

/**
 * Detect tabs closed since the previous cycle and queue/upload them.
 * Does NOT persist snapshots (refreshSnapshots does that after sync).
 * @param {Array} wsWindows - [{ windowId, workspaceId }]
 */
export async function detectClosedTabs(wsWindows) {
  const snaps = await getSnapshots();
  const events = [];

  for (const { windowId, workspaceId } of wsWindows) {
    let tabs;
    try {
      tabs = await captureLiveSnapshot(windowId);
    } catch {
      continue; // window may have closed between detection and capture
    }

    const prev = snaps[windowId];
    // Need a prior snapshot for THIS window that belonged to the SAME workspace.
    // No prior snapshot = freshly restored window (don't flag every tab as
    // closed); workspaceId mismatch = Chrome reused this windowId for a
    // different window. Either way, skip detection this cycle.
    if (!prev || prev.workspaceId !== workspaceId || !Array.isArray(prev.tabs)) continue;

    const currentIds = new Set(tabs.map(t => t.chromeTabId));
    for (const old of prev.tabs) {
      if (!currentIds.has(old.chromeTabId) && isRecordableUrl(old.url)) {
        events.push({
          workspaceId,
          url: old.url,
          title: old.title || '',
          closedAt: serverNow()
        });
      }
    }
  }

  if (events.length > 0) {
    const buffer = await getBuffer();
    buffer.push(...events);
    await setBuffer(buffer);
  }

  await flushBuffer();
}

/** Try to upload any buffered closed-tab events to the server. */
async function flushBuffer() {
  let buffer = await getBuffer();
  if (buffer.length === 0) return;
  try {
    await pushClosedTabs(buffer);
    await setBuffer([]); // sent — clear
  } catch (e) {
    // Keep buffer for next cycle (offline / server unreachable)
    console.warn('[Tabsy] Closed-tab upload failed, will retry:', e.message);
  }
}

/**
 * Re-capture each open workspace window and store as the new snapshot, keyed by
 * windowId. Called at the END of the sync cycle so sync-driven tab closures are
 * baked into the snapshot (by reading the real post-sync browser state) and are
 * never mistaken for user closes next cycle. Only current windows are kept, so a
 * closed window's stale snapshot is dropped automatically.
 * @param {Array} wsWindows - [{ windowId, workspaceId }]
 */
export async function refreshSnapshots(wsWindows) {
  const snaps = {};
  for (const { windowId, workspaceId } of wsWindows) {
    try {
      snaps[windowId] = { workspaceId, tabs: await captureLiveSnapshot(windowId) };
    } catch {
      // window gone — leave it out
    }
  }
  await setSnapshots(snaps);
}
