const MARKER_URL = 'about:blank#ws-marker';

// Open side panel when clicking the extension icon
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Update badge when switching windows
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  await updateBadge(windowId);
});

// Also update badge when tabs change (marker created/removed)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateBadge(tab.windowId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) {
    await updateBadge(removeInfo.windowId);
  }
});

async function updateBadge(windowId) {
  try {
    // Find marker tab in this window
    const tabs = await chrome.tabs.query({ windowId });
    const markerTab = tabs.find(t => t.url === MARKER_URL);

    if (!markerTab) {
      // No workspace identified — clear badge
      await chrome.action.setBadgeText({ text: '', windowId });
      await chrome.action.setTitle({ title: 'Tabsy', windowId });
      return;
    }

    // Find workspace by matching marker group title
    const { workspaces = [] } = await chrome.storage.local.get('workspaces');

    // Get the marker's group to extract workspace name
    let wsName = '';
    let wsColor = '#0078d4';
    if (markerTab.groupId && markerTab.groupId !== -1) {
      try {
        const group = await chrome.tabGroups.get(markerTab.groupId);
        // Group title format: "📂 Workspace Name"
        wsName = group.title?.replace(/^📂\s*/, '') || '';
      } catch (e) { /* group may not exist */ }
    }

    // Find matching workspace by name (best effort)
    const ws = workspaces.find(w => w.name === wsName);
    const idx = ws ? workspaces.indexOf(ws) + 1 : 0;

    if (ws) {
      wsColor = ws.color;
    }

    await chrome.action.setBadgeText({ text: idx ? String(idx) : '', windowId });
    await chrome.action.setBadgeBackgroundColor({ color: wsColor, windowId });
    await chrome.action.setTitle({
      title: wsName ? `📂 #${idx} ${wsName}` : 'Tabsy',
      windowId
    });
  } catch (e) {
    // Window may have closed during async operations
  }
}
