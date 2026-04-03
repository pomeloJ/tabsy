import {
  COLORS, hexToChromeColor,
  getAll, getById, save, remove, clearAll,
  getSettings, saveSettings, getConflicts,
  getAutoSync, setAutoSync
} from './lib/storage.js';
import { performSync, isSyncConfigured } from './lib/sync.js';
import { captureWindow } from './lib/capture.js';
import { threeWayMerge } from './lib/merge.js';

const MARKER_URL = 'about:blank#ws-marker';

// --- DOM refs ---
const nameInput = document.getElementById('ws-name');
const colorPicker = document.getElementById('color-picker');
const saveBtn = document.getElementById('save-btn');
const saveAllBtn = document.getElementById('save-all-btn');
const wsList = document.getElementById('ws-list');
const clearAllBtn = document.getElementById('clear-all-btn');
const currentWsLabel = document.getElementById('current-ws-label');
const currentWsMeta = document.getElementById('current-ws-meta');
const currentWsActions = document.getElementById('current-ws-actions');
const quickSaveBtn = document.getElementById('quick-save-btn');
const quickDeleteBtn = document.getElementById('quick-delete-btn');
const saveNewToggle = document.getElementById('save-new-toggle');
const saveNewArrow = document.getElementById('save-new-arrow');
const saveSection = document.getElementById('save-section');

let selectedColor = COLORS[0].hex;
let currentWorkspaceData = null; // { id, name, color } of detected workspace

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
    // If this window is an existing workspace, reuse its ID (update instead of create)
    const existingId = await detectCurrentWorkspaceId(win.id);
    const workspace = await captureWindow(win.id, name, selectedColor, existingId);
    await save(workspace);
    nameInput.value = '';
    await renderList();
    triggerAutoSync();
  } finally {
    saveBtn.disabled = false;
  }
}

// Detect the workspace ID for a given window (via marker tab)
async function detectCurrentWorkspaceId(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const markerTab = tabs.find(t => t.url === MARKER_URL);
  if (!markerTab || markerTab.groupId === -1) return null;

  try {
    const group = await chrome.tabGroups.get(markerTab.groupId);
    const wsName = group.title?.replace(/^📂\s*/, '') || '';
    const workspaces = await getAll();
    const ws = workspaces.find(w => w.name === wsName);
    return ws ? ws.id : null;
  } catch {
    return null;
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
      currentWorkspaceData = null;
      currentWsLabel.textContent = 'No workspace detected';
      currentWsMeta.style.display = 'none';
      currentWsActions.style.display = 'none';
      // No workspace — show save section directly, hide toggle
      saveNewToggle.style.display = 'none';
      saveSection.classList.remove('collapsed');
      return;
    }

    const group = await chrome.tabGroups.get(markerTab.groupId);
    const wsName = group.title?.replace(/^📂\s*/, '') || 'Unknown';
    const workspaces = await getAll();
    const ws = workspaces.find(w => w.name === wsName);

    currentWsLabel.innerHTML = `<span style="color:${group.color}">📂</span> ${escapeHtml(wsName)}`;

    if (ws) {
      currentWorkspaceData = { id: ws.id, name: ws.name, color: ws.color };
      const realTabs = tabs.filter(t => t.url !== MARKER_URL && (markerTab.groupId === -1 || t.groupId !== markerTab.groupId));
      currentWsMeta.textContent = `${realTabs.length} tabs · ${formatTime(ws.savedAt)}`;
      currentWsMeta.style.display = 'block';
      currentWsActions.style.display = 'flex';
      // In a workspace — show collapsible toggle, collapse save section by default
      saveNewToggle.style.display = 'flex';
      saveSection.classList.add('collapsed');
      saveNewArrow.classList.remove('open');
    } else {
      currentWorkspaceData = null;
      currentWsMeta.style.display = 'none';
      currentWsActions.style.display = 'none';
      saveNewToggle.style.display = 'none';
      saveSection.classList.remove('collapsed');
    }
  } catch {
    currentWorkspaceData = null;
    currentWsLabel.textContent = 'No workspace detected';
    currentWsMeta.style.display = 'none';
    currentWsActions.style.display = 'none';
    saveNewToggle.style.display = 'none';
    saveSection.classList.remove('collapsed');
  }
}

// --- Quick save current workspace ---
async function quickSaveCurrentWorkspace() {
  if (!currentWorkspaceData) return;
  quickSaveBtn.disabled = true;
  try {
    const win = await chrome.windows.getCurrent();
    const workspace = await captureWindow(win.id, currentWorkspaceData.name, currentWorkspaceData.color, currentWorkspaceData.id);
    await save(workspace);
    await renderList();
    await detectCurrentWorkspace();
    triggerAutoSync();
  } finally {
    quickSaveBtn.disabled = false;
  }
}

// --- Quick delete current workspace ---
async function quickDeleteCurrentWorkspace() {
  if (!currentWorkspaceData) return;
  if (!confirm(`Delete "${currentWorkspaceData.name}"?`)) return;
  quickDeleteBtn.disabled = true;
  try {
    await remove(currentWorkspaceData.id);
    currentWorkspaceData = null;
    await renderList();
    await detectCurrentWorkspace();
    triggerAutoSync();
  } finally {
    quickDeleteBtn.disabled = false;
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
      ${renderConflictSection(w)}
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

  // Conflict resolution buttons
  wsList.querySelectorAll('[data-resolve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await resolveConflict(btn.dataset.resolve, btn.dataset.action);
      btn.disabled = false;
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

// --- Conflict UI ---

function renderConflictSection(workspace) {
  if (workspace.syncStatus !== 'conflict' || !workspace.conflictData) return '';
  const cd = workspace.conflictData;
  const localTabCount = cd.localVersion.tabs.length;
  const remoteTabCount = cd.remoteVersion.tabs.length;
  const conflictCount = cd.conflicts ? cd.conflicts.length : 0;

  return `
    <div class="ws-conflict-section">
      <div class="conflict-summary">
        <span class="conflict-label">Sync conflict</span>
        <span class="conflict-detail">
          Local: ${localTabCount} tabs · Remote: ${remoteTabCount} tabs${conflictCount > 0 ? ` · ${conflictCount} tab conflict${conflictCount > 1 ? 's' : ''}` : ''}
        </span>
      </div>
      <div class="conflict-actions">
        <button class="btn btn-sm btn-secondary" data-resolve="${workspace.id}" data-action="local">Keep Local</button>
        <button class="btn btn-sm btn-secondary" data-resolve="${workspace.id}" data-action="remote">Keep Remote</button>
        <button class="btn btn-sm btn-primary" data-resolve="${workspace.id}" data-action="merge">Merge All</button>
      </div>
    </div>
  `;
}

async function resolveConflict(workspaceId, action) {
  const ws = await getById(workspaceId);
  if (!ws || !ws.conflictData) return;

  const cd = ws.conflictData;

  switch (action) {
    case 'local':
      ws.tabs = cd.localVersion.tabs;
      ws.groups = cd.localVersion.groups;
      ws.savedAt = new Date().toISOString();
      ws.syncStatus = 'pending';
      delete ws.conflictData;
      break;
    case 'remote':
      ws.tabs = cd.remoteVersion.tabs;
      ws.groups = cd.remoteVersion.groups;
      ws.savedAt = cd.remoteVersion.savedAt;
      ws.syncStatus = 'pending';
      delete ws.conflictData;
      break;
    case 'merge': {
      const base = ws.syncedSnapshot || { tabs: [], groups: [] };
      const result = threeWayMerge(base, cd.localVersion, cd.remoteVersion);
      ws.tabs = result.merged.tabs;
      ws.groups = result.merged.groups;
      ws.savedAt = new Date().toISOString();
      ws.syncStatus = 'pending';
      ws.syncedSnapshot = { tabs: result.merged.tabs, groups: result.merged.groups };
      delete ws.conflictData;
      break;
    }
  }

  await save(ws);
  await renderList();
  renderConflictBanner();
  triggerAutoSync();
}

const conflictBanner = document.getElementById('conflict-banner');

async function renderConflictBanner() {
  const conflicts = await getConflicts();
  if (conflicts.length === 0) {
    conflictBanner.style.display = 'none';
    return;
  }
  conflictBanner.style.display = 'flex';
  conflictBanner.innerHTML = `&#x26a0; ${conflicts.length} workspace${conflicts.length > 1 ? 's' : ''} with sync conflicts`;
}

// --- Event listeners ---
saveBtn.addEventListener('click', saveCurrentWindow);
saveAllBtn.addEventListener('click', saveAllWindows);
quickSaveBtn.addEventListener('click', quickSaveCurrentWorkspace);
quickDeleteBtn.addEventListener('click', quickDeleteCurrentWorkspace);
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

// Collapsible save-new section
saveNewToggle.addEventListener('click', () => {
  saveSection.classList.toggle('collapsed');
  saveNewArrow.classList.toggle('open');
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
    if (result.conflicts > 0) parts.push(`${result.conflicts} conflicts`);
    syncStatus.textContent = parts.length > 0 ? parts.join(', ') : 'Up to date';
    syncStatus.className = 'sync-status ok';
    await renderList();
    renderConflictBanner();
  }

  syncBtn.disabled = false;
}

syncBtn.addEventListener('click', doSync);

// Auto-sync toggle
const autoSyncCheckbox = document.getElementById('auto-sync-checkbox');
getAutoSync().then(enabled => { autoSyncCheckbox.checked = enabled; });
autoSyncCheckbox.addEventListener('change', () => {
  setAutoSync(autoSyncCheckbox.checked);
});

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
renderConflictBanner();
loadSettings();
updateSyncBar();

// Auto-sync on panel open
isSyncConfigured().then(configured => {
  if (configured) doSync();
});

// Re-render when background auto-sync updates workspaces
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.workspaces) {
    renderList();
    renderConflictBanner();
    detectCurrentWorkspace();
  }
});
