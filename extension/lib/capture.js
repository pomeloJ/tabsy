import { generateId, getAll, getById } from './storage.js';
import { serverNow } from './api-client.js';

const MARKER_BASE = chrome.runtime.getURL('marker.html');
function isMarkerUrl(url) { return url?.startsWith(MARKER_BASE); }

/**
 * Capture a window's tabs and groups into a workspace object.
 * If existingId is provided, reuses that ID (for updating an existing workspace).
 */
export async function captureWindow(windowId, name, color, existingId = null) {
  const allTabs = await chrome.tabs.query({ windowId });

  // Find marker tab and its group
  const markerTab = allTabs.find(t => isMarkerUrl(t.url));
  const markerGroupId = markerTab?.groupId ?? -1;

  // Filter out marker tab and all tabs in the marker group
  const tabs = allTabs.filter(t =>
    !isMarkerUrl(t.url) && (markerGroupId === -1 || t.groupId !== markerGroupId)
  );

  // Collect unique chrome group IDs (excluding ungrouped and marker group)
  const chromeGroupIds = [...new Set(
    tabs.map(t => t.groupId).filter(gid => gid !== -1 && gid !== chrome.tabGroups.TAB_GROUP_ID_NONE)
  )];

  // Map chrome groupId → stable string groupId
  const groupIdMap = {};
  const groups = [];
  for (const cgid of chromeGroupIds) {
    const stableId = `g-${groups.length + 1}`;
    groupIdMap[cgid] = stableId;
    try {
      const g = await chrome.tabGroups.get(cgid);
      groups.push({
        groupId: stableId,
        title: g.title || '',
        color: g.color || 'blue',
        collapsed: g.collapsed || false
      });
    } catch {
      groups.push({ groupId: stableId, title: '', color: 'blue', collapsed: false });
    }
  }

  // Preserve existing data when recapturing
  let existingFlows = [];
  let existingNotes = [];
  let existingTabs = [];
  if (existingId) {
    const existing = await getById(existingId);
    if (existing?.flows) existingFlows = existing.flows;
    if (existing?.notes) existingNotes = existing.notes;
    if (existing?.tabs) existingTabs = existing.tabs;
  }

  // Build maps to preserve tab IDs on recapture
  // 1. Chrome tab ID → workspace tab ID (most reliable, survives URL changes)
  const chromeIdToWsTabId = {};
  // 2. URL → workspace tab ID (fallback for new tabs)
  const urlToTabId = {};
  for (const t of existingTabs) {
    if (t.id && t._chromeTabId) chromeIdToWsTabId[t._chromeTabId] = t.id;
    if (t.id) urlToTabId[t.url] = t.id;
  }

  const usedIds = new Set();
  const workspaceTabs = tabs.map((t, i) => {
    // Prefer matching by Chrome tab ID (survives navigation), then by URL
    let tabId = chromeIdToWsTabId[t.id];
    if (!tabId || usedIds.has(tabId)) {
      tabId = urlToTabId[t.url];
    }
    if (!tabId || usedIds.has(tabId)) {
      tabId = 't-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-' + i;
    }
    usedIds.add(tabId);
    return {
      id: tabId,
      _chromeTabId: t.id, // Store Chrome tab ID for next recapture
      url: t.url,
      title: t.title || '',
      pinned: t.pinned || false,
      groupId: t.groupId !== -1 ? (groupIdMap[t.groupId] || null) : null,
      index: i
    };
  });

  return {
    id: existingId || generateId(),
    name,
    color,
    savedAt: serverNow(),
    groups,
    tabs: workspaceTabs,
    flows: existingFlows,
    notes: existingNotes,
    syncStatus: existingId ? 'pending' : 'local_only'
  };
}

/**
 * Scan all open windows and find ones that are workspace windows (have a marker tab).
 * Returns array of { windowId, workspaceId, workspaceName, workspaceColor }.
 */
export async function detectWorkspaceWindows() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const workspaces = await getAll();
  const wsById = new Map(workspaces.map(w => [w.id, w]));
  const results = [];

  for (const win of windows) {
    const tabs = await chrome.tabs.query({ windowId: win.id });
    const markerTab = tabs.find(t => isMarkerUrl(t.url));
    if (!markerTab) continue;

    // Parse workspace ID directly from marker URL query params
    try {
      const markerParams = new URL(markerTab.url).searchParams;
      const wsId = markerParams.get('id');
      const ws = wsId ? wsById.get(wsId) : null;

      // Fallback: match by group title if URL has no id param (legacy markers)
      if (!ws && markerTab.groupId !== -1) {
        const group = await chrome.tabGroups.get(markerTab.groupId);
        const wsName = group.title?.replace(/^📂\s*/, '') || '';
        const matched = workspaces.find(w => w.name === wsName);
        if (matched) {
          results.push({
            windowId: win.id,
            workspaceId: matched.id,
            workspaceName: matched.name,
            workspaceColor: matched.color
          });
        }
        continue;
      }

      if (ws) {
        results.push({
          windowId: win.id,
          workspaceId: ws.id,
          workspaceName: ws.name,
          workspaceColor: ws.color
        });
      }
    } catch { /* marker URL parse or group fetch failed */ }
  }

  return results;
}

/**
 * Compare two workspace states to detect meaningful changes.
 * Does NOT compare tab.title (too noisy — changes with notifications etc).
 * Returns true if workspace has changed.
 */
export function hasWorkspaceChanged(stored, captured) {
  // Tab count
  if (stored.tabs.length !== captured.tabs.length) return true;
  // Group count
  if (stored.groups.length !== captured.groups.length) return true;

  // Compare tabs (url, pinned, groupId)
  for (let i = 0; i < stored.tabs.length; i++) {
    const s = stored.tabs[i];
    const c = captured.tabs[i];
    if (s.url !== c.url) return true;
    if (s.pinned !== c.pinned) return true;
    if (s.groupId !== c.groupId) return true;
  }

  // Compare groups (title, color, collapsed)
  for (let i = 0; i < stored.groups.length; i++) {
    const s = stored.groups[i];
    const c = captured.groups[i];
    if (s.title !== c.title) return true;
    if (s.color !== c.color) return true;
    if (s.collapsed !== c.collapsed) return true;
  }

  return false;
}
