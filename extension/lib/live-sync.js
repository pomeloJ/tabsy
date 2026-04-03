const MARKER_URL = 'about:blank#ws-marker';

/**
 * Apply merged workspace state to an open browser window.
 * Opens missing tabs, closes removed tabs, rebuilds group structure.
 *
 * @param {number} windowId - Chrome window ID
 * @param {Array} mergedTabs - Workspace tab objects from merge result
 * @param {Array} mergedGroups - Workspace group objects from merge result
 */
export async function applyMergedState(windowId, mergedTabs, mergedGroups) {
  // Verify window still exists
  try {
    await chrome.windows.get(windowId);
  } catch {
    return;
  }

  // Get current browser tabs (excluding marker and its group)
  const allBrowserTabs = await chrome.tabs.query({ windowId });
  const markerTab = allBrowserTabs.find(t => t.url === MARKER_URL);
  const markerGroupId = markerTab?.groupId ?? -1;
  const currentTabs = allBrowserTabs.filter(t =>
    t.url !== MARKER_URL && (markerGroupId === -1 || t.groupId !== markerGroupId)
  );

  const mergedUrlSet = new Set(mergedTabs.map(t => t.url));
  const currentUrlSet = new Set(currentTabs.map(t => t.url));

  // Nothing to do if state matches
  if (mergedUrlSet.size === currentUrlSet.size) {
    let same = true;
    for (const url of mergedUrlSet) {
      if (!currentUrlSet.has(url)) { same = false; break; }
    }
    if (same) {
      // URLs match — still check groups
      await syncGroups(windowId, mergedTabs, mergedGroups, markerGroupId);
      return;
    }
  }

  // Close tabs that should not exist
  const toCloseIds = currentTabs
    .filter(t => !mergedUrlSet.has(t.url))
    .map(t => t.id);

  if (toCloseIds.length > 0) {
    try {
      await chrome.tabs.remove(toCloseIds);
    } catch (e) {
      console.warn('[Tabsy] Error closing tabs:', e.message);
    }
  }

  // Open tabs that need to be added
  const toOpen = mergedTabs.filter(t => !currentUrlSet.has(t.url));
  for (const tab of toOpen) {
    try {
      await chrome.tabs.create({
        windowId,
        url: tab.url,
        pinned: tab.pinned || false,
        active: false
      });
    } catch (e) {
      console.warn(`[Tabsy] Error creating tab ${tab.url}:`, e.message);
    }
  }

  // Rebuild group structure after tab changes
  await syncGroups(windowId, mergedTabs, mergedGroups, markerGroupId);

  // Update pinned state for existing tabs
  await syncPinnedState(windowId, mergedTabs, markerGroupId);
}

/**
 * Rebuild tab group structure to match merged state.
 */
async function syncGroups(windowId, mergedTabs, mergedGroups, markerGroupId) {
  if (mergedGroups.length === 0) return;

  // Get fresh tab list after opens/closes
  const allTabs = await chrome.tabs.query({ windowId });
  const liveTabs = allTabs.filter(t =>
    t.url !== MARKER_URL && (markerGroupId === -1 || t.groupId !== markerGroupId)
  );

  // Build URL → tab ID map (first occurrence wins for duplicates)
  const urlToTabId = new Map();
  for (const t of liveTabs) {
    if (!urlToTabId.has(t.url)) {
      urlToTabId.set(t.url, t.id);
    }
  }

  // Build merged groupId → list of tab URLs
  const groupTabUrls = new Map();
  for (const tab of mergedTabs) {
    if (tab.groupId) {
      if (!groupTabUrls.has(tab.groupId)) groupTabUrls.set(tab.groupId, []);
      groupTabUrls.get(tab.groupId).push(tab.url);
    }
  }

  // Ungroup all non-marker tabs first (to start clean)
  const groupedIds = liveTabs
    .filter(t => t.groupId !== -1 && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
    .map(t => t.id);

  if (groupedIds.length > 0) {
    try {
      await chrome.tabs.ungroup(groupedIds);
    } catch (e) {
      console.warn('[Tabsy] Error ungrouping tabs:', e.message);
    }
  }

  // Create groups from merged state
  for (const group of mergedGroups) {
    const urls = groupTabUrls.get(group.groupId) || [];
    const tabIds = urls
      .map(url => urlToTabId.get(url))
      .filter(Boolean);

    if (tabIds.length === 0) continue;

    try {
      const chromeGroupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId }
      });
      await chrome.tabGroups.update(chromeGroupId, {
        title: group.title || '',
        color: group.color || 'blue',
        collapsed: group.collapsed || false
      });
    } catch (e) {
      console.warn(`[Tabsy] Error creating group "${group.title}":`, e.message);
    }
  }
}

/**
 * Update pinned state for tabs that differ from merged state.
 */
async function syncPinnedState(windowId, mergedTabs, markerGroupId) {
  const allTabs = await chrome.tabs.query({ windowId });
  const liveTabs = allTabs.filter(t =>
    t.url !== MARKER_URL && (markerGroupId === -1 || t.groupId !== markerGroupId)
  );

  const mergedByUrl = new Map(mergedTabs.map(t => [t.url, t]));

  for (const liveTab of liveTabs) {
    const mergedTab = mergedByUrl.get(liveTab.url);
    if (mergedTab && liveTab.pinned !== (mergedTab.pinned || false)) {
      try {
        await chrome.tabs.update(liveTab.id, { pinned: mergedTab.pinned || false });
      } catch (e) { /* tab may have been removed */ }
    }
  }
}
