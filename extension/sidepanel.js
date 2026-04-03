import {
  COLORS, hexToChromeColor, generateId,
  getAll, save, remove, clearAll,
  getSettings, saveSettings
} from './lib/storage.js';
import { performSync, isSyncConfigured } from './lib/sync.js';

const MARKER_URL = 'about:blank#ws-marker';

// --- DOM refs ---
const nameInput = document.getElementById('ws-name');
const colorPicker = document.getElementById('color-picker');
const saveBtn = document.getElementById('save-btn');
const saveAllBtn = document.getElementById('save-all-btn');
const wsList = document.getElementById('ws-list');
const clearAllBtn = document.getElementById('clear-all-btn');
const currentWsLabel = document.getElementById('current-ws-label');

let selectedColor = COLORS[0].hex;

// --- Color picker ---
function initColorPicker() {
  colorPicker.innerHTML = COLORS.map(c =>
    `<div class="color-dot ${c.hex === selectedColor ? 'selected' : ''}"
          style="background:${c.hex}" data-hex="${c.hex}" title="${c.name}"></div>`
  ).join('');

  colorPicker.addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    selectedColor = dot.dataset.hex;
    colorPicker.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
    dot.classList.add('selected');
  });
}

// --- Save current window ---
async function saveCurrentWindow() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }

  saveBtn.disabled = true;
  try {
    const win = await chrome.windows.getCurrent();
    const workspace = await captureWindow(win.id, name, selectedColor);
    await save(workspace);
    nameInput.value = '';
    await renderList();
    triggerAutoSync();
  } finally {
    saveBtn.disabled = false;
  }
}

// --- Save all windows ---
async function saveAllWindows() {
  saveAllBtn.disabled = true;
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (let i = 0; i < windows.length; i++) {
      const win = windows[i];
      const tabs = await chrome.tabs.query({ windowId: win.id });
      const realTabs = tabs.filter(t => t.url !== MARKER_URL);
      if (realTabs.length === 0) continue;

      const name = `Window ${i + 1}`;
      const color = COLORS[i % COLORS.length].hex;
      const workspace = await captureWindow(win.id, name, color);
      await save(workspace);
    }
    await renderList();
    triggerAutoSync();
  } finally {
    saveAllBtn.disabled = false;
  }
}

// --- Capture window tabs & groups into workspace object ---
async function captureWindow(windowId, name, color) {
  const allTabs = await chrome.tabs.query({ windowId });

  // Find marker tab and its group
  const markerTab = allTabs.find(t => t.url === MARKER_URL);
  const markerGroupId = markerTab?.groupId ?? -1;

  // Filter out marker tab and all tabs in the marker group
  const tabs = allTabs.filter(t =>
    t.url !== MARKER_URL && (markerGroupId === -1 || t.groupId !== markerGroupId)
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

  return {
    id: generateId(),
    name,
    color,
    savedAt: new Date().toISOString(),
    groups,
    tabs: workspaceTabs,
    syncStatus: 'local_only'
  };
}

// --- Restore workspace ---
async function restoreWorkspace(workspace) {
  const chromeColor = hexToChromeColor(workspace.color);

  // Create new window with a blank tab (will be removed later)
  const newWin = await chrome.windows.create({ focused: true });
  const defaultTabId = newWin.tabs[0].id;

  // Create marker tab first
  const markerTab = await chrome.tabs.create({
    windowId: newWin.id,
    url: MARKER_URL,
    active: false,
    index: 0
  });

  // Create all tabs
  const createdTabs = [];
  const pinnedTabs = workspace.tabs.filter(t => t.pinned);
  const normalTabs = workspace.tabs.filter(t => !t.pinned);
  const orderedTabs = [...pinnedTabs, ...normalTabs];

  for (const tab of orderedTabs) {
    const created = await chrome.tabs.create({
      windowId: newWin.id,
      url: tab.url,
      pinned: tab.pinned,
      active: false
    });
    createdTabs.push({ spec: tab, tabId: created.id });
  }

  // Create tab groups
  const groupMap = {}; // workspace groupId → chrome groupId
  for (const group of workspace.groups) {
    const tabIds = createdTabs
      .filter(ct => ct.spec.groupId === group.groupId)
      .map(ct => ct.tabId);
    if (tabIds.length === 0) continue;

    const chromeGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: newWin.id } });
    await chrome.tabGroups.update(chromeGroupId, {
      title: group.title,
      color: group.color,
      collapsed: group.collapsed
    });
    groupMap[group.groupId] = chromeGroupId;
  }

  // Create marker group (collapsed, with workspace name)
  const markerGroupId = await chrome.tabs.group({
    tabIds: [markerTab.id],
    createProperties: { windowId: newWin.id }
  });
  await chrome.tabGroups.update(markerGroupId, {
    title: `📂 ${workspace.name}`,
    color: chromeColor,
    collapsed: true
  });

  // Move marker group to the front
  await chrome.tabGroups.move(markerGroupId, { index: 0 });

  // Remove the default blank tab
  try { await chrome.tabs.remove(defaultTabId); } catch { /* may already be closed */ }

  // Activate first non-marker tab
  if (createdTabs.length > 0) {
    await chrome.tabs.update(createdTabs[0].tabId, { active: true });
  }
}

// --- Detect current workspace ---
async function detectCurrentWorkspace() {
  try {
    const win = await chrome.windows.getCurrent();
    const tabs = await chrome.tabs.query({ windowId: win.id });
    const markerTab = tabs.find(t => t.url === MARKER_URL);

    if (!markerTab || markerTab.groupId === -1) {
      currentWsLabel.textContent = 'No workspace detected';
      return;
    }

    const group = await chrome.tabGroups.get(markerTab.groupId);
    const wsName = group.title?.replace(/^📂\s*/, '') || 'Unknown';
    currentWsLabel.innerHTML = `<span style="color:${group.color}">📂</span> ${escapeHtml(wsName)}`;
  } catch {
    currentWsLabel.textContent = 'No workspace detected';
  }
}

// --- Render workspace list ---
async function renderList() {
  const workspaces = await getAll();

  if (workspaces.length === 0) {
    wsList.innerHTML = '<div class="empty-state">No saved workspaces.</div>';
    return;
  }

  // Sort by savedAt descending
  workspaces.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

  wsList.innerHTML = workspaces.map(w => `
    <div class="ws-card" style="border-left-color:${w.color}" data-id="${w.id}">
      <div class="ws-card-header">
        <div class="ws-card-dot" style="background:${w.color}"></div>
        <div class="ws-card-name">${escapeHtml(w.name)}</div>
        ${syncBadge(w.syncStatus)}
      </div>
      <div class="ws-card-meta">
        ${w.tabs.length} tab${w.tabs.length !== 1 ? 's' : ''} · ${w.groups.length} group${w.groups.length !== 1 ? 's' : ''} · ${formatTime(w.savedAt)}
      </div>
      <div class="ws-card-actions">
        <button class="btn btn-primary btn-sm" data-restore="${w.id}">Restore</button>
        <button class="btn btn-danger btn-sm" data-delete="${w.id}">Delete</button>
      </div>
    </div>
  `).join('');

  // Event delegation
  wsList.querySelectorAll('[data-restore]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const ws = workspaces.find(w => w.id === btn.dataset.restore);
      if (ws) await restoreWorkspace(ws);
      btn.disabled = false;
    });
  });

  wsList.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ws = workspaces.find(w => w.id === btn.dataset.delete);
      if (!confirm(`Delete "${ws?.name}"?`)) return;
      await remove(btn.dataset.delete);
      await renderList();
      triggerAutoSync();
    });
  });
}

// --- Helpers ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const SYNC_LABELS = {
  synced: '&#x2713; Synced',
  local_only: '&#x25cf; Local',
  pending: '&#x21bb; Pending',
  conflict: '&#x26a0; Conflict'
};

function syncBadge(status) {
  if (!status) return '';
  const label = SYNC_LABELS[status];
  if (!label) return '';
  return `<span class="ws-card-sync ${status}">${label}</span>`;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- Event listeners ---
saveBtn.addEventListener('click', saveCurrentWindow);
saveAllBtn.addEventListener('click', saveAllWindows);
clearAllBtn.addEventListener('click', async () => {
  if (!confirm('Delete all saved workspaces?')) return;
  await clearAll();
  await renderList();
  triggerAutoSync();
});

// Allow Enter key to save
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveCurrentWindow();
});

// --- Settings ---
const settingsToggle = document.getElementById('settings-toggle');
const settingsArrow = document.getElementById('settings-arrow');
const settingsPanel = document.getElementById('settings-panel');
const serverUrlInput = document.getElementById('server-url');
const syncTokenInput = document.getElementById('sync-token');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const testConnBtn = document.getElementById('test-conn-btn');
const settingsStatus = document.getElementById('settings-status');

settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  settingsArrow.classList.toggle('open');
});

saveSettingsBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
  const token = syncTokenInput.value.trim();
  await saveSettings({ serverUrl, token });
  settingsStatus.textContent = 'Settings saved.';
  settingsStatus.className = 'settings-status ok';
});

testConnBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
  const token = syncTokenInput.value.trim();

  if (!serverUrl) {
    settingsStatus.textContent = 'Enter a server URL first.';
    settingsStatus.className = 'settings-status err';
    return;
  }

  testConnBtn.disabled = true;
  settingsStatus.textContent = 'Testing...';
  settingsStatus.className = 'settings-status';

  try {
    // Test health endpoint
    const healthRes = await fetch(`${serverUrl}/api/health`);
    if (!healthRes.ok) throw new Error('Server not reachable');

    // Test token auth
    if (token) {
      const meRes = await fetch(`${serverUrl}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!meRes.ok) throw new Error('Invalid token');
      const me = await meRes.json();
      settingsStatus.textContent = `Connected as "${me.username}".`;
      settingsStatus.className = 'settings-status ok';
    } else {
      settingsStatus.textContent = 'Server reachable. Enter a token for sync.';
      settingsStatus.className = 'settings-status ok';
    }
  } catch (e) {
    const msg = e.message === 'Failed to fetch'
      ? 'Cannot reach server. Check URL and ensure server is running.'
      : (e.message || 'Connection failed.');
    settingsStatus.textContent = msg;
    settingsStatus.className = 'settings-status err';
    console.error('Sync test error:', e);
  } finally {
    testConnBtn.disabled = false;
  }
});

// Load saved settings
async function loadSettings() {
  const settings = await getSettings();
  serverUrlInput.value = settings.serverUrl || '';
  syncTokenInput.value = settings.token || '';
}

// --- Auto-sync helper ---
function triggerAutoSync() {
  // Fire-and-forget: sync in background after local operations
  isSyncConfigured().then(configured => {
    if (configured) {
      performSync().then(result => {
        if (!result.error) renderList();
      }).catch(() => {});
    }
  });
}

// --- Sync ---
const syncBar = document.getElementById('sync-bar');
const syncBtn = document.getElementById('sync-btn');
const syncStatus = document.getElementById('sync-status');

async function updateSyncBar() {
  const configured = await isSyncConfigured();
  syncBar.style.display = configured ? 'flex' : 'none';
}

async function doSync() {
  syncBtn.disabled = true;
  syncStatus.innerHTML = '<span class="sync-spinner"></span> Syncing...';
  syncStatus.className = 'sync-status';

  const result = await performSync();

  if (result.error) {
    syncStatus.textContent = result.error;
    syncStatus.className = 'sync-status err';
  } else {
    const parts = [];
    if (result.pulled > 0) parts.push(`${result.pulled} pulled`);
    if (result.pushed > 0) parts.push(`${result.pushed} pushed`);
    if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} conflicts`);
    syncStatus.textContent = parts.length > 0 ? parts.join(', ') : 'Up to date';
    syncStatus.className = 'sync-status ok';
    await renderList();
  }

  syncBtn.disabled = false;
}

syncBtn.addEventListener('click', doSync);

// Update sync bar after save settings
saveSettingsBtn.addEventListener('click', async () => {
  // Wait for settings to be saved, then update sync bar visibility
  setTimeout(async () => {
    await updateSyncBar();
  }, 100);
});

// --- Init ---
initColorPicker();
detectCurrentWorkspace();
renderList();
loadSettings();
updateSyncBar();

// Auto-sync on panel open
isSyncConfigured().then(configured => {
  if (configured) doSync();
});
