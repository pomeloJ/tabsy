const MARKER_BASE = chrome.runtime.getURL('marker.html');
function isMarkerUrl(url) { return url?.startsWith(MARKER_BASE); }

/**
 * Apply merged workspace state to an open browser window.
 * Opens missing tabs, closes removed tabs, rebuilds group structure.
 * Carefully preserves the user's active tab focus to avoid disruption.
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

  // Remember active tab so we can restore focus after sync operations
  const activeTabs = await chrome.tabs.query({ windowId, active: true });
  const activeTabId = activeTabs[0]?.id;

  // Helper: restore active tab focus (best-effort)
  const restoreFocus = async () => {
    if (!activeTabId) return;
    try { await chrome.tabs.update(activeTabId, { active: true }); } catch {}
  };

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
      // URLs match — only touch groups/order if they actually differ
      await syncGroupsIfNeeded(windowId, mergedTabs, mergedGroups, markerGroupId, currentTabs);
      await syncTabOrderIfNeeded(windowId, mergedTabs, mergedGroups, markerGroupId);
      await restoreFocus();
      return;
    }
  }

  // Close tabs that should not exist — but never close the active tab
  // if it's being removed, close it last after restoring focus to another tab
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
  await syncGroupsIfNeeded(windowId, mergedTabs, mergedGroups, markerGroupId, null, newTabMap);

  // Enforce correct tab order (new tabs are appended at end, groups may rearrange)
  await syncTabOrderIfNeeded(windowId, mergedTabs, mergedGroups, markerGroupId, newTabMap);

  // Update pinned state for existing tabs
  await syncPinnedState(windowId, mergedTabs, markerGroupId);

  // Restore active tab focus if it still exists (prevent tab jumping during sync)
  await restoreFocus();
}

/**
 * Build a snapshot of current group state for comparison.
 * Returns { tabGroupMap: Map<tabId, chromeGroupId>, groupProps: Map<chromeGroupId, {title,color,collapsed}> }
 */
async function getGroupSnapshot(liveTabs, windowId, markerGroupId) {
  const tabGroupMap = new Map(); // tabId → chromeGroupId
  const groupProps = new Map();  // chromeGroupId → {title, color, collapsed}
  const seenGroups = new Set();

  for (const t of liveTabs) {
    if (t.groupId !== -1 && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      tabGroupMap.set(t.id, t.groupId);
      if (!seenGroups.has(t.groupId)) {
        seenGroups.add(t.groupId);
        try {
          const g = await chrome.tabGroups.get(t.groupId);
          groupProps.set(t.groupId, { title: g.title || '', color: g.color || 'blue', collapsed: g.collapsed || false });
        } catch {
          groupProps.set(t.groupId, { title: '', color: 'blue', collapsed: false });
        }
      }
    }
  }
  return { tabGroupMap, groupProps };
}

/**
 * Only rebuild groups if the current state differs from merged state.
 */
async function syncGroupsIfNeeded(windowId, mergedTabs, mergedGroups, markerGroupId, existingLiveTabs = null, newTabMap = new Map()) {
  if (mergedGroups.length === 0) return;

  // Get fresh tab list
  const allTabs = await chrome.tabs.query({ windowId });
  const liveTabs = allTabs.filter(t =>
    !isMarkerUrl(t.url) && (markerGroupId === -1 || t.groupId !== markerGroupId)
  );

  // Build URL → tab ID map
  const urlToTabId = new Map(newTabMap);
  for (const t of liveTabs) {
    if (!urlToTabId.has(t.url)) urlToTabId.set(t.url, t.id);
    if (t.pendingUrl && !urlToTabId.has(t.pendingUrl)) urlToTabId.set(t.pendingUrl, t.id);
  }

  // Build desired group membership: mergedGroupId → [tabId]
  const desiredGroups = new Map();
  for (const tab of mergedTabs) {
    if (tab.groupId) {
      if (!desiredGroups.has(tab.groupId)) desiredGroups.set(tab.groupId, []);
      const tabId = urlToTabId.get(tab.url);
      if (tabId) desiredGroups.get(tab.groupId).push(tabId);
    }
  }

  // Build current group membership: chromeGroupId → Set<tabId>
  const currentGroups = new Map(); // chromeGroupId → Set<tabId>
  for (const t of liveTabs) {
    if (t.groupId !== -1 && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      if (!currentGroups.has(t.groupId)) currentGroups.set(t.groupId, new Set());
      currentGroups.get(t.groupId).add(t.id);
    }
  }

  // Build desired group props
  const desiredGroupProps = new Map();
  for (const g of mergedGroups) {
    desiredGroupProps.set(g.groupId, { title: g.title || '', color: g.color || 'blue', collapsed: g.collapsed || false });
  }

  // Quick check: can we match current chrome groups to desired groups?
  // If current group count and membership already match, just update props if needed
  const { groupProps: currentGroupProps } = await getGroupSnapshot(liveTabs, windowId, markerGroupId);

  // Try to match current chrome groups to desired groups by tab membership
  const chromeToMerged = new Map(); // chromeGroupId → mergedGroupId
  for (const [chromeGid, memberSet] of currentGroups) {
    for (const [mergedGid, desiredTabIds] of desiredGroups) {
      if (memberSet.size === desiredTabIds.length) {
        const allMatch = desiredTabIds.every(id => memberSet.has(id));
        if (allMatch && !chromeToMerged.has(chromeGid)) {
          chromeToMerged.set(chromeGid, mergedGid);
          break;
        }
      }
    }
  }

  // Check if all desired groups are matched
  const matchedMergedIds = new Set(chromeToMerged.values());
  const allGroupsMatched = mergedGroups.every(g => matchedMergedIds.has(g.groupId)) &&
    chromeToMerged.size === currentGroups.size;

  if (allGroupsMatched) {
    // Groups membership matches — just update props if needed
    for (const [chromeGid, mergedGid] of chromeToMerged) {
      const desired = desiredGroupProps.get(mergedGid);
      const current = currentGroupProps.get(chromeGid);
      if (!desired || !current) continue;
      if (desired.title !== current.title || desired.color !== current.color || desired.collapsed !== current.collapsed) {
        try {
          await chrome.tabGroups.update(chromeGid, {
            title: desired.title,
            color: desired.color,
            collapsed: desired.collapsed
          });
        } catch (e) {
          console.warn(`[Tabsy] Error updating group props:`, e.message);
        }
      }
    }
    // Also check for tabs that should be ungrouped but aren't
    const allDesiredTabIds = new Set();
    for (const ids of desiredGroups.values()) {
      for (const id of ids) allDesiredTabIds.add(id);
    }
    const wronglyGrouped = liveTabs.filter(t =>
      t.groupId !== -1 && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE &&
      !allDesiredTabIds.has(t.id)
    );
    if (wronglyGrouped.length > 0) {
      try { await chrome.tabs.ungroup(wronglyGrouped.map(t => t.id)); } catch {}
    }
    return;
  }

  // Groups don't match — do full rebuild (ungroup all, then regroup)
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
    const tabIds = (desiredGroups.get(group.groupId) || []).filter(Boolean);
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
 * Only reorder tabs if the current order differs from merged state.
 */
async function syncTabOrderIfNeeded(windowId, mergedTabs, mergedGroups, markerGroupId, newTabMap = new Map()) {
  const allTabs = await chrome.tabs.query({ windowId });
  const liveTabs = allTabs.filter(t =>
    !isMarkerUrl(t.url) && (markerGroupId === -1 || t.groupId !== markerGroupId)
  );

  // Build URL → tab ID map
  const urlToTabId = new Map(newTabMap);
  for (const t of liveTabs) {
    if (!urlToTabId.has(t.url)) urlToTabId.set(t.url, t.id);
    if (t.pendingUrl && !urlToTabId.has(t.pendingUrl)) urlToTabId.set(t.pendingUrl, t.id);
  }

  // Check if current URL order already matches merged order
  const currentUrlOrder = liveTabs
    .sort((a, b) => a.index - b.index)
    .map(t => t.url);
  const mergedUrlOrder = mergedTabs.map(t => t.url);

  // Quick check: if URL order already matches, skip all moves
  if (currentUrlOrder.length === mergedUrlOrder.length &&
      currentUrlOrder.every((url, i) => url === mergedUrlOrder[i])) {
    return;
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
