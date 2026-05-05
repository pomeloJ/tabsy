const MARKER_BASE = chrome.runtime.getURL('marker.html');
function isMarkerUrl(url) { return url?.startsWith(MARKER_BASE); }

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
  let win;
  try {
    win = await chrome.windows.get(windowId);
  } catch {
    return;
  }

  // Remember active tab so we can restore focus after sync operations
  const activeTabs = await chrome.tabs.query({ windowId, active: true });
  const activeTabId = activeTabs[0]?.id;

  // Get current browser tabs (excluding marker and its group)
  const allBrowserTabs = await chrome.tabs.query({ windowId });
  const markerTab = allBrowserTabs.find(t => isMarkerUrl(t.url));
  const markerGroupId = markerTab?.groupId ?? -1;
  const currentTabs = allBrowserTabs.filter(t =>
    !isMarkerUrl(t.url) && (markerGroupId === -1 || t.groupId !== markerGroupId)
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
      // URLs match — still check groups and tab order
      await syncGroups(windowId, mergedTabs, mergedGroups, markerGroupId);
      await syncTabOrder(windowId, mergedTabs, mergedGroups, markerGroupId);
      // Restore active tab focus
      if (activeTabId) {
        try { await chrome.tabs.update(activeTabId, { active: true }); } catch {}
      }
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

  // Open tabs that need to be added — track URL → tabId for newly created tabs
  const newTabMap = new Map();
  const toOpen = mergedTabs.filter(t => !currentUrlSet.has(t.url));
  for (const tab of toOpen) {
    try {
      const created = await chrome.tabs.create({
        windowId,
        url: tab.url,
        pinned: tab.pinned || false,
        active: false
      });
      newTabMap.set(tab.url, created.id);
    } catch (e) {
      console.warn(`[Tabsy] Error creating tab ${tab.url}:`, e.message);
    }
  }

  // Rebuild group structure after tab changes
  await syncGroups(windowId, mergedTabs, mergedGroups, markerGroupId, newTabMap);

  // Enforce correct tab order (new tabs are appended at end, groups may rearrange)
  await syncTabOrder(windowId, mergedTabs, mergedGroups, markerGroupId, newTabMap);

  // Update pinned state for existing tabs
  await syncPinnedState(windowId, mergedTabs, markerGroupId);

  // Restore active tab focus if it still exists (prevent tab jumping during sync)
  if (activeTabId) {
    try {
      await chrome.tabs.update(activeTabId, { active: true });
    } catch { /* tab was removed during sync */ }
  }
}

/**
 * Rebuild tab group structure to match merged state.
 */
async function syncGroups(windowId, mergedTabs, mergedGroups, markerGroupId, newTabMap = new Map()) {
  if (mergedGroups.length === 0) return;

  // Get fresh tab list after opens/closes
  const allTabs = await chrome.tabs.query({ windowId });
  const liveTabs = allTabs.filter(t =>
    !isMarkerUrl(t.url) && (markerGroupId === -1 || t.groupId !== markerGroupId)
  );

  // Build URL → tab ID map (first occurrence wins for duplicates)
  // Merge newTabMap first — new tabs may still be loading (url could be about:blank)
  const urlToTabId = new Map(newTabMap);
  for (const t of liveTabs) {
    if (!urlToTabId.has(t.url)) {
      urlToTabId.set(t.url, t.id);
    }
    // Also check pendingUrl for tabs still navigating
    if (t.pendingUrl && !urlToTabId.has(t.pendingUrl)) {
      urlToTabId.set(t.pendingUrl, t.id);
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
 * Reorder tabs to match the merged state order.
 * Moves grouped tabs within each group, then ungrouped tabs, to match mergedTabs array order.
 */
async function syncTabOrder(windowId, mergedTabs, mergedGroups, markerGroupId, newTabMap = new Map()) {
  const allTabs = await chrome.tabs.query({ windowId });
  const liveTabs = allTabs.filter(t =>
    !isMarkerUrl(t.url) && (markerGroupId === -1 || t.groupId !== markerGroupId)
  );

  // Build URL → tab ID map, merge newTabMap for tabs still loading
  const urlToTabId = new Map(newTabMap);
  for (const t of liveTabs) {
    if (!urlToTabId.has(t.url)) urlToTabId.set(t.url, t.id);
    if (t.pendingUrl && !urlToTabId.has(t.pendingUrl)) urlToTabId.set(t.pendingUrl, t.id);
  }

  const groupOrder = new Map(mergedGroups.map((g, i) => [g.groupId, i]));

  // Enforce order within each group
  for (const group of mergedGroups) {
    const groupTabUrls = mergedTabs
      .filter(t => t.groupId === group.groupId)
      .map(t => t.url);

    if (groupTabUrls.length <= 1) continue;

    for (let i = 1; i < groupTabUrls.length; i++) {
      const prevId = urlToTabId.get(groupTabUrls[i - 1]);
      const currId = urlToTabId.get(groupTabUrls[i]);
      if (!prevId || !currId) continue;
      try {
        const prevTab = await chrome.tabs.get(prevId);
        await chrome.tabs.move(currId, { index: prevTab.index + 1 });
      } catch (e) { /* tab may have been removed */ }
    }
  }

  // Enforce order for ungrouped tabs
  const ungroupedUrls = mergedTabs
    .filter(t => !t.pinned && (!t.groupId || !groupOrder.has(t.groupId)))
    .map(t => t.url);

  if (ungroupedUrls.length > 1) {
    for (let i = 1; i < ungroupedUrls.length; i++) {
      const prevId = urlToTabId.get(ungroupedUrls[i - 1]);
      const currId = urlToTabId.get(ungroupedUrls[i]);
      if (!prevId || !currId) continue;
      try {
        const prevTab = await chrome.tabs.get(prevId);
        await chrome.tabs.move(currId, { index: prevTab.index + 1 });
      } catch (e) { /* tab may have been removed */ }
    }
  }
}

/**
 * Update pinned state for tabs that differ from merged state.
 */
async function syncPinnedState(windowId, mergedTabs, markerGroupId) {
  const allTabs = await chrome.tabs.query({ windowId });
  const liveTabs = allTabs.filter(t =>
    !isMarkerUrl(t.url) && (markerGroupId === -1 || t.groupId !== markerGroupId)
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
