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

  const workspaceTabs = tabs.map((t, i) => ({
    url: t.url,
    title: t.title || '',
    pinned: t.pinned || false,
    groupId: t.groupId !== -1 ? (groupIdMap[t.groupId] || null) : null,
    index: i
  }));

  // Preserve existing flows when recapturing
  let existingFlows = [];
  if (existingId) {
    const existing = await getById(existingId);
    if (existing?.flows) existingFlows = existing.flows;
  }

  return {
    id: existingId || generateId(),
    name,
    color,
    savedAt: serverNow(),
    groups,
    tabs: workspaceTabs,
    flows: existingFlows,
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
  const results = [];

  for (const win of windows) {
    const tabs = await chrome.tabs.query({ windowId: win.id });
    const markerTab = tabs.find(t => isMarkerUrl(t.url));
    if (!markerTab || markerTab.groupId === -1) continue;

    try {
      const group = await chrome.tabGroups.get(markerTab.groupId);
      const wsName = group.title?.replace(/^📂\s*/, '') || '';
      const ws = workspaces.find(w => w.name === wsName);
      if (ws) {
        results.push({
          windowId: win.id,
          workspaceId: ws.id,
          workspaceName: ws.name,
          workspaceColor: ws.color
        });
      }
    } catch { /* group may not exist */ }
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
