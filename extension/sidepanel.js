import {
  COLORS, hexToChromeColor,
  getAll, getById, save, remove, clearAll,
  getSettings, saveSettings, getConflicts,
  getAutoSync, setAutoSync,
  getFlows, getFlowById, saveFlow, removeFlow
} from './lib/storage.js';
import { performSync, isSyncConfigured } from './lib/sync.js';
import { captureWindow } from './lib/capture.js';
import { threeWayMerge } from './lib/merge.js';
import { FlowRunner, RunState } from './lib/flow-runner.js';
import { createFlow, createBlock, BLOCK_TYPES, BLOCK_CATEGORIES } from './lib/flow-schema.js';

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

  // Load flows for all workspaces
  const allFlows = await getFlows();

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
      ${renderFlowChips(w.id, allFlows[w.id])}
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

  // Flow buttons — click to edit, dblclick to rename
  wsList.querySelectorAll('[data-edit-flow]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openFlowEditor(el.dataset.ws, el.dataset.editFlow);
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRenameFlow(el, el.dataset.ws, el.dataset.editFlow);
    });
  });

  wsList.querySelectorAll('[data-run-flow]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      runFlowOnActiveTab(el.dataset.ws, el.dataset.runFlow);
    });
  });

  wsList.querySelectorAll('[data-del-flow]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this flow?')) return;
      await removeFlow(el.dataset.ws, el.dataset.delFlow);
      await renderList();
    });
  });

  wsList.querySelectorAll('[data-add-flow]').forEach(btn => {
    btn.addEventListener('click', () => addNewFlow(btn.dataset.addFlow));
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

// --- Flow execution ---

const flowLogPanel = document.getElementById('flow-log-panel');
const flowLogName = document.getElementById('flow-log-name');
const flowLogState = document.getElementById('flow-log-state');
const flowLogBody = document.getElementById('flow-log-body');
const flowLogClose = document.getElementById('flow-log-close');

let activeRunner = null;

flowLogClose.addEventListener('click', () => {
  flowLogPanel.classList.remove('open');
  if (activeRunner && activeRunner.state === RunState.RUNNING) {
    activeRunner.stop();
  }
  activeRunner = null;
});

function showFlowLog(flowName) {
  flowLogName.textContent = flowName;
  flowLogBody.innerHTML = '';
  flowLogState.textContent = '';
  flowLogState.className = 'flow-state';
  flowLogPanel.classList.add('open');
}

function appendFlowLog(entry) {
  const div = document.createElement('div');
  div.className = 'flow-log-entry';
  const time = new Date(entry.time).toLocaleTimeString();
  div.innerHTML = `<span class="flow-log-time">${time}</span> <span class="flow-log-msg">${escapeHtml(entry.message)}</span>`;
  flowLogBody.appendChild(div);
  flowLogBody.scrollTop = flowLogBody.scrollHeight;
}

function showFlowResult(result) {
  flowLogState.textContent = result.state;
  flowLogState.className = `flow-state ${result.state === RunState.DONE ? 'done' : result.state === RunState.ERROR ? 'error' : ''}`;

  if (result.error) {
    const div = document.createElement('div');
    div.className = 'flow-log-entry';
    div.innerHTML = `<span class="flow-log-err">Error: ${escapeHtml(result.error)}</span>`;
    flowLogBody.appendChild(div);
  }

  // Show final variables
  const vars = Object.entries(result.variables).filter(([k]) => !k.startsWith('_'));
  if (vars.length > 0) {
    const div = document.createElement('div');
    div.className = 'flow-log-vars';
    div.innerHTML = vars.map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`).join('<br>');
    flowLogBody.appendChild(div);
  }
  flowLogBody.scrollTop = flowLogBody.scrollHeight;
}

async function runFlowOnActiveTab(workspaceId, flowId) {
  const flow = await (async () => {
    const wsFlows = await getFlows(workspaceId);
    return wsFlows.find(f => f.id === flowId);
  })();
  if (!flow) return;

  // Stop existing runner
  if (activeRunner && activeRunner.state === RunState.RUNNING) {
    activeRunner.stop();
  }

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  showFlowLog(flow.name);
  flowLogState.textContent = 'running';
  flowLogState.className = 'flow-state running';

  const runner = new FlowRunner(flow, tab.id);
  activeRunner = runner;

  runner.onLog = appendFlowLog;
  runner.onBlockStart = (block, i) => {
    const def = BLOCK_TYPES[block.type];
    appendFlowLog({ time: new Date().toISOString(), message: `▶ ${def?.label || block.type}` });
  };

  const result = await runner.run();
  showFlowResult(result);
}

// Render flow chips for a workspace card
function renderFlowChips(workspaceId, flows) {
  if (!flows || flows.length === 0) {
    return `
      <div class="ws-flow-section">
        <div class="ws-flow-header">
          <span>Flows</span>
          <button class="btn btn-sm btn-secondary" data-add-flow="${workspaceId}">+ New</button>
        </div>
      </div>`;
  }

  const chips = flows.map(f => `
    <span class="flow-chip ${f.enabled ? '' : 'disabled'}">
      <span class="flow-edit" data-edit-flow="${f.id}" data-ws="${workspaceId}" title="Edit">${escapeHtml(f.name)}</span>
      <span class="flow-run" data-run-flow="${f.id}" data-ws="${workspaceId}" title="Run">&#9654;</span>
      <span class="flow-delete" data-del-flow="${f.id}" data-ws="${workspaceId}" title="Delete">&times;</span>
    </span>
  `).join('');

  return `
    <div class="ws-flow-section">
      <div class="ws-flow-header">
        <span>Flows (${flows.length})</span>
        <button class="btn btn-sm btn-secondary" data-add-flow="${workspaceId}">+ New</button>
      </div>
      <div>${chips}</div>
    </div>`;
}

async function startRenameFlow(el, workspaceId, flowId) {
  const chip = el.closest('.flow-chip');
  const oldName = el.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.style.cssText = 'width:80px;font-size:11px;padding:0 4px;border:1px solid var(--primary);border-radius:3px;outline:none;';
  el.replaceWith(input);
  input.focus();
  input.select();

  const finish = async () => {
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      const flow = await getFlowById(workspaceId, flowId);
      if (flow) {
        flow.name = newName;
        await saveFlow(workspaceId, flow);
      }
    }
    await renderList();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  });
}

function openFlowEditor(workspaceId, flowId) {
  location.href = `flow-editor.html?ws=${workspaceId}&flow=${flowId}`;
}

async function addNewFlow(workspaceId) {
  const flow = createFlow('New Flow');
  await saveFlow(workspaceId, flow);
  openFlowEditor(workspaceId, flow.id);
  await renderList();
}

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
