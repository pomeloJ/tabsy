import {
  COLORS, hexToChromeColor,
  getAll, getById, save, remove, clearAll,
  getSettings, saveSettings, getConflicts,
  getAutoSync, setAutoSync,
  getFlows, getFlowById, saveFlow, removeFlow,
  getClientId,
  getTimezone, setTimezone, getDetectedTimezone,
  formatDateTimeShort
} from './lib/storage.js';
import { performSync, isSyncConfigured } from './lib/sync.js';
import { serverNow, getClockOffset } from './lib/api-client.js';
import { captureWindow } from './lib/capture.js';
import { threeWayMerge } from './lib/merge.js';
import { FlowRunner, RunState } from './lib/flow-runner.js';
import { createFlow, createBlock, BLOCK_TYPES, BLOCK_CATEGORIES, TRIGGER_TYPES } from './lib/flow-schema.js';
import { mountFlowEditor, unmountFlowEditor } from './flow-editor.js';
import { t, initLocale, setLocale, getLocale } from './lib/i18n.js';

const MARKER_BASE = chrome.runtime.getURL('marker.html');
function isMarkerUrl(url) { return url?.startsWith(MARKER_BASE); }
function buildMarkerUrl(id, name, color) {
  const p = new URLSearchParams({ id, name, color });
  return `${MARKER_BASE}?${p}`;
}
const viewMain = document.getElementById('view-main');
const viewFlow = document.getElementById('view-flow');

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
const currentWsFlows = document.getElementById('current-ws-flows');
const otherWsToggle = document.getElementById('other-ws-toggle');
const otherWsArrow = document.getElementById('other-ws-arrow');
const otherWsBody = document.getElementById('other-ws-body');
const otherWsTitle = document.getElementById('other-ws-title');

let selectedColor = COLORS[0].hex;
let currentWorkspaceData = null; // { id, name, color } of detected workspace
let _activeTabUrl = '';

function matchUrlPattern(pattern, url) {
  if (!pattern) return false;
  const escaped = pattern.replace(/([.+?^${}()|[\]\\])/g, '\\$1');
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
  return regex.test(url);
}

async function refreshActiveTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    _activeTabUrl = tab?.url || '';
  } catch { _activeTabUrl = ''; }
}

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
  const markerTab = tabs.find(t => isMarkerUrl(t.url));
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
      const realTabs = tabs.filter(t => !isMarkerUrl(t.url));
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

  // Create marker tab first (with workspace info)
  const markerUrl = buildMarkerUrl(workspace.id, workspace.name, workspace.color);
  const markerTab = await chrome.tabs.create({
    windowId: newWin.id,
    url: markerUrl,
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
    const markerTab = tabs.find(t => isMarkerUrl(t.url));

    if (!markerTab || markerTab.groupId === -1) {
      currentWorkspaceData = null;
      currentWsLabel.textContent = t('noWorkspaceDetected');
      currentWsMeta.style.display = 'none';
      currentWsActions.style.display = 'none';
      currentWsFlows.style.display = 'none';
      // No workspace — show save section directly, hide toggle
      saveNewToggle.style.display = 'none';
      saveSection.classList.remove('collapsed');
      return;
    }

    const group = await chrome.tabGroups.get(markerTab.groupId);
    const wsName = group.title?.replace(/^📂\s*/, '') || 'Unknown';
    const workspaces = await getAll();
    const ws = workspaces.find(w => w.name === wsName);

    const groupColor = /^[a-z]+$/.test(group.color) ? group.color : 'grey';
    currentWsLabel.innerHTML = `<span style="color:${groupColor}">📂</span> ${escapeHtml(wsName)}`;

    if (ws) {
      currentWorkspaceData = { id: ws.id, name: ws.name, color: ws.color };
      const realTabs = tabs.filter(t => !isMarkerUrl(t.url) && (markerTab.groupId === -1 || t.groupId !== markerTab.groupId));
      currentWsMeta.textContent = `${realTabs.length} tabs · ${formatTime(ws.savedAt)}`;
      currentWsMeta.style.display = 'block';
      currentWsActions.style.display = 'flex';
      // In a workspace — show collapsible toggle, collapse save section by default
      saveNewToggle.style.display = 'flex';
      saveSection.classList.add('collapsed');
      saveNewArrow.classList.remove('open');
      // Render current workspace flows
      renderCurrentWsFlows(ws);
    } else {
      currentWorkspaceData = null;
      currentWsMeta.style.display = 'none';
      currentWsActions.style.display = 'none';
      currentWsFlows.style.display = 'none';
      saveNewToggle.style.display = 'none';
      saveSection.classList.remove('collapsed');
    }
  } catch {
    currentWorkspaceData = null;
    currentWsLabel.textContent = t('noWorkspaceDetected');
    currentWsMeta.style.display = 'none';
    currentWsActions.style.display = 'none';
    currentWsFlows.style.display = 'none';
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
  if (!confirm(t('deleteConfirm', { name: currentWorkspaceData.name }))) return;
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

// --- Render current workspace flows (expanded, prominent) ---

function renderCurrentWsFlows(ws) {
  const flows = ws.flows || [];
  const triggerLabel = (t) => TRIGGER_TYPES[t]?.label || t;

  let html = `<div class="flow-list-header">
    <span>${t('flows')}${flows.length ? ` (${flows.length})` : ''}</span>
    <button class="btn btn-sm btn-secondary" data-add-flow="${ws.id}">${t('newFlow')}</button>
  </div>`;

  if (flows.length > 0) {
    html += flows.map(f => {
      const urlMatched = f.enabled && f.trigger !== 'manual' && f.match && _activeTabUrl && matchUrlPattern(f.match, _activeTabUrl);
      return `
      <div class="flow-item ${f.enabled ? '' : 'disabled'}">
        <span class="flow-item-name" data-edit-flow="${f.id}" data-ws="${ws.id}">${escapeHtml(f.name)}</span>
        ${urlMatched ? `<span class="flow-match-badge" title="Matches current tab">&#9889; ${t('match')}</span>` : ''}
        <span class="flow-item-trigger ${f.trigger}">${triggerLabel(f.trigger)}</span>
        <span class="flow-item-actions">
          <button class="flow-item-btn run" data-run-flow="${f.id}" data-ws="${ws.id}" title="${t('run')}">&#9654;</button>
          <button class="flow-item-btn edit" data-edit-flow="${f.id}" data-ws="${ws.id}" title="${t('edit')}">&#9998;</button>
          <button class="flow-item-btn delete" data-del-flow="${f.id}" data-ws="${ws.id}" title="${t('delete')}">&times;</button>
        </span>
      </div>`;
    }).join('');
  }

  currentWsFlows.innerHTML = html;
  currentWsFlows.style.display = 'block';
}

// Event delegation for current-ws flows area
currentWsFlows.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-edit-flow], [data-run-flow], [data-del-flow], [data-add-flow]');
  if (!target) return;

  if (target.dataset.editFlow) {
    e.stopPropagation();
    openFlowEditor(target.dataset.ws, target.dataset.editFlow);
  } else if (target.dataset.runFlow) {
    e.stopPropagation();
    runFlowOnActiveTab(target.dataset.ws, target.dataset.runFlow);
  } else if (target.dataset.delFlow) {
    e.stopPropagation();
    if (!confirm(t('deleteFlowConfirm'))) return;
    await removeFlow(target.dataset.ws, target.dataset.delFlow);
    await renderList();
    await detectCurrentWorkspace();
  } else if (target.dataset.addFlow) {
    addNewFlow(target.dataset.addFlow);
  }
});

// Double-click rename for current-ws flows
currentWsFlows.addEventListener('dblclick', (e) => {
  const el = e.target.closest('[data-edit-flow]');
  if (!el) return;
  e.stopPropagation();
  startRenameFlow(el, el.dataset.ws, el.dataset.editFlow);
});

// --- Render workspace list (differential) ---

// Cache of last-rendered card HTML keyed by workspace id
let _renderedCards = new Map();
let _renderedOrder = []; // ordered workspace ids from last render

function buildCardHtml(w, wsFlows) {
  return `
      <div class="ws-card-header">
        <div class="ws-card-dot" style="background:${safeColor(w.color)}"></div>
        <div class="ws-card-name">${escapeHtml(w.name)}</div>
        ${syncBadge(w.syncStatus)}
      </div>
      <div class="ws-card-meta">
        ${w.tabs.length} tab${w.tabs.length !== 1 ? 's' : ''} · ${w.groups.length} group${w.groups.length !== 1 ? 's' : ''} · ${formatTime(w.savedAt)}
      </div>
      ${renderConflictSection(w)}
      ${renderFlowChips(w.id, wsFlows)}
      <div class="ws-card-actions">
        <button class="btn btn-primary btn-sm" data-restore="${w.id}">${t('restore')}</button>
        <button class="btn btn-danger btn-sm" data-delete="${w.id}">${t('delete')}</button>
      </div>`;
}

async function renderList() {
  const allWorkspaces = await getAll();

  // Separate current workspace from others
  const currentId = currentWorkspaceData?.id;
  const workspaces = allWorkspaces.filter(w => w.id !== currentId);

  // Update other-ws toggle title
  const sectionLabel = currentId ? t('otherWorkspaces') : t('savedWorkspaces');
  otherWsTitle.textContent = workspaces.length > 0
    ? `${sectionLabel} (${workspaces.length})`
    : sectionLabel;

  if (workspaces.length === 0) {
    wsList.innerHTML = currentId
      ? `<div class="empty-state">${t('noOtherWorkspaces')}</div>`
      : `<div class="empty-state">${t('noSavedWorkspaces')}</div>`;
    _renderedCards.clear();
    _renderedOrder = [];
    return;
  }

  // Sort by savedAt descending
  workspaces.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

  // Build flows map from cached data (getFlows uses cached getAll internally)
  const allFlows = await getFlows();

  const newOrder = workspaces.map(w => w.id);
  const orderChanged = newOrder.length !== _renderedOrder.length ||
    newOrder.some((id, i) => id !== _renderedOrder[i]);

  // Build new card HTML map
  const newCards = new Map();
  for (const w of workspaces) {
    newCards.set(w.id, { html: buildCardHtml(w, allFlows[w.id]), color: w.color });
  }

  if (orderChanged) {
    // Order changed (added, removed, reordered) — rebuild DOM but reuse unchanged nodes
    const fragment = document.createDocumentFragment();
    for (const w of workspaces) {
      const card = newCards.get(w.id);
      const existing = wsList.querySelector(`.ws-card[data-id="${w.id}"]`);
      if (existing && _renderedCards.get(w.id)?.html === card.html) {
        // Reuse unchanged DOM node
        fragment.appendChild(existing);
      } else {
        // Create new card
        const el = document.createElement('div');
        el.className = 'ws-card';
        el.style.borderLeftColor = card.color;
        el.dataset.id = w.id;
        el.innerHTML = card.html;
        fragment.appendChild(el);
      }
    }
    wsList.innerHTML = '';
    wsList.appendChild(fragment);
  } else {
    // Same order — only patch changed cards in-place
    for (const w of workspaces) {
      const card = newCards.get(w.id);
      if (_renderedCards.get(w.id)?.html === card.html) continue;
      const el = wsList.querySelector(`.ws-card[data-id="${w.id}"]`);
      if (el) {
        el.style.borderLeftColor = card.color;
        el.innerHTML = card.html;
      }
    }
  }

  _renderedCards = newCards;
  _renderedOrder = newOrder;
}

// --- Event delegation on wsList (single listener, never re-attached) ---
wsList.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-restore], [data-delete], [data-resolve], [data-edit-flow], [data-run-flow], [data-del-flow], [data-add-flow]');
  if (!target) return;

  if (target.dataset.restore) {
    target.disabled = true;
    const ws = await getById(target.dataset.restore);
    if (ws) await restoreWorkspace(ws);
    target.disabled = false;
  } else if (target.dataset.delete) {
    const ws = await getById(target.dataset.delete);
    if (!confirm(t('deleteConfirm', { name: ws?.name }))) return;
    await remove(target.dataset.delete);
    await renderList();
    triggerAutoSync();
  } else if (target.dataset.resolve) {
    target.disabled = true;
    await resolveConflict(target.dataset.resolve, target.dataset.action);
    target.disabled = false;
  } else if (target.dataset.editFlow) {
    e.stopPropagation();
    openFlowEditor(target.dataset.ws, target.dataset.editFlow);
  } else if (target.dataset.runFlow) {
    e.stopPropagation();
    runFlowOnActiveTab(target.dataset.ws, target.dataset.runFlow);
  } else if (target.dataset.delFlow) {
    e.stopPropagation();
    if (!confirm(t('deleteFlowConfirm'))) return;
    await removeFlow(target.dataset.ws, target.dataset.delFlow);
    await renderList();
  } else if (target.dataset.addFlow) {
    addNewFlow(target.dataset.addFlow);
  }
});

// Double-click for flow rename (separate listener since dblclick doesn't bubble the same way)
wsList.addEventListener('dblclick', (e) => {
  const el = e.target.closest('[data-edit-flow]');
  if (!el) return;
  e.stopPropagation();
  startRenameFlow(el, el.dataset.ws, el.dataset.editFlow);
});

// --- Helpers ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function safeColor(color) {
  return /^#[0-9a-fA-F]{3,6}$/.test(color) ? color : '#69797e';
}

function getSyncLabels() {
  return {
    synced: t('syncedBadge'),
    local_only: t('localBadge'),
    pending: t('pendingBadge'),
    conflict: t('conflictBadge')
  };
}

function syncBadge(status) {
  if (!status) return '';
  const labels = getSyncLabels();
  const label = labels[status];
  if (!label) return '';
  return `<span class="ws-card-sync ${status}">${label}</span>`;
}

function formatTime(iso) {
  return formatDateTimeShort(iso, _currentTz);
}

// --- Conflict UI ---

function renderConflictSection(workspace) {
  if (workspace.syncStatus !== 'conflict' || !workspace.conflictData) return '';
  const cd = workspace.conflictData;
  const localTabCount = cd.localVersion.tabs.length;
  const remoteTabCount = cd.remoteVersion.tabs.length;
  const conflictCount = cd.conflicts ? cd.conflicts.length : 0;

  const conflictDetail = conflictCount > 0
    ? (conflictCount > 1 ? t('tabConflictsPlural', { n: conflictCount }) : t('tabConflicts', { n: conflictCount }))
    : '';

  return `
    <div class="ws-conflict-section">
      <div class="conflict-summary">
        <span class="conflict-label">${t('syncConflict')}</span>
        <span class="conflict-detail">
          ${t('localLabel')}: ${localTabCount} tabs · ${t('remoteLabel')}: ${remoteTabCount} tabs${conflictDetail ? ` · ${conflictDetail}` : ''}
        </span>
      </div>
      <div class="conflict-actions">
        <button class="btn btn-sm btn-secondary" data-resolve="${workspace.id}" data-action="local">${t('keepLocal')}</button>
        <button class="btn btn-sm btn-secondary" data-resolve="${workspace.id}" data-action="remote">${t('keepRemote')}</button>
        <button class="btn btn-sm btn-primary" data-resolve="${workspace.id}" data-action="merge">${t('mergeAll')}</button>
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
      ws.savedAt = serverNow();
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
      ws.savedAt = serverNow();
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
  conflictBanner.innerHTML = conflicts.length > 1
    ? t('conflictBannerPlural', { n: conflicts.length })
    : t('conflictBanner', { n: conflicts.length });
}

// --- Event listeners ---
saveBtn.addEventListener('click', saveCurrentWindow);
saveAllBtn.addEventListener('click', saveAllWindows);
quickSaveBtn.addEventListener('click', quickSaveCurrentWorkspace);
quickDeleteBtn.addEventListener('click', quickDeleteCurrentWorkspace);
clearAllBtn.addEventListener('click', async () => {
  if (!confirm(t('deleteAllConfirm'))) return;
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

// Collapsible other-workspaces section
otherWsToggle.addEventListener('click', () => {
  otherWsBody.classList.toggle('collapsed');
  otherWsArrow.classList.toggle('open');
});

// --- Settings ---
const settingsToggle = document.getElementById('settings-toggle');
const settingsArrow = document.getElementById('settings-arrow');
const settingsPanel = document.getElementById('settings-panel');
const clientIdInput = document.getElementById('client-id');
const copyClientIdBtn = document.getElementById('copy-client-id-btn');
const serverUrlInput = document.getElementById('server-url');
const syncTokenInput = document.getElementById('sync-token');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const testConnBtn = document.getElementById('test-conn-btn');
const settingsStatus = document.getElementById('settings-status');

// Load and display client ID
getClientId().then(id => { clientIdInput.value = id; });
copyClientIdBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(clientIdInput.value).then(() => {
    const orig = copyClientIdBtn.textContent;
    copyClientIdBtn.textContent = t('copied') || 'Copied';
    setTimeout(() => { copyClientIdBtn.textContent = orig; }, 1500);
  });
});

settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  settingsArrow.classList.toggle('open');
});

saveSettingsBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
  const token = syncTokenInput.value.trim();
  await saveSettings({ serverUrl, token });
  settingsStatus.textContent = t('settingsSaved');
  settingsStatus.className = 'settings-status ok';
});

testConnBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
  const token = syncTokenInput.value.trim();

  if (!serverUrl) {
    settingsStatus.textContent = t('enterServerUrl');
    settingsStatus.className = 'settings-status err';
    return;
  }

  testConnBtn.disabled = true;
  settingsStatus.textContent = t('testing');
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
      settingsStatus.textContent = t('connectedAs', { username: me.username });
      settingsStatus.className = 'settings-status ok';
    } else {
      settingsStatus.textContent = t('serverReachableNoToken');
      settingsStatus.className = 'settings-status ok';
    }
  } catch (e) {
    const msg = e.message === 'Failed to fetch'
      ? t('cannotReachServer')
      : (e.message || t('connectionFailed'));
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
const clockOffsetEl = document.getElementById('clock-offset');

function updateClockOffsetDisplay() {
  const { offset, calibrated } = getClockOffset();
  if (!calibrated) {
    clockOffsetEl.textContent = '';
    clockOffsetEl.title = '';
    return;
  }
  const sec = (offset / 1000).toFixed(1);
  const sign = offset >= 0 ? '+' : '';
  clockOffsetEl.textContent = `${sign}${sec}s`;
  clockOffsetEl.title = `Clock offset: client ${offset >= 0 ? 'behind' : 'ahead of'} server by ${Math.abs(sec)}s`;
  // Color hint: green if <1s, yellow if 1-5s, red if >5s
  const abs = Math.abs(offset);
  if (abs < 1000) clockOffsetEl.style.color = '';
  else if (abs < 5000) clockOffsetEl.style.color = 'var(--ws-orange, #ca5010)';
  else clockOffsetEl.style.color = 'var(--ws-red, #d13438)';
}

async function updateSyncBar() {
  const configured = await isSyncConfigured();
  syncBar.style.display = configured ? 'flex' : 'none';
}

async function doSync() {
  syncBtn.disabled = true;
  syncStatus.innerHTML = `<span class="sync-spinner"></span> ${t('syncing')}`;
  syncStatus.className = 'sync-status';

  const result = await performSync();

  if (result.error) {
    syncStatus.textContent = result.error;
    syncStatus.className = 'sync-status err';
  } else {
    const parts = [];
    if (result.pulled > 0) parts.push(t('pulled', { n: result.pulled }));
    if (result.pushed > 0) parts.push(t('pushed', { n: result.pushed }));
    if (result.conflicts > 0) parts.push(t('conflicts', { n: result.conflicts }));
    syncStatus.textContent = parts.length > 0 ? parts.join(', ') : t('upToDate');
    syncStatus.className = 'sync-status ok';
    await renderList();
    renderConflictBanner();
  }

  updateClockOffsetDisplay();
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
  const time = new Date(entry.time).toLocaleTimeString(undefined, { timeZone: _currentTz });
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

// Render flow chips for a workspace card (compact for non-current workspaces)
function renderFlowChips(workspaceId, flows) {
  if (!flows || flows.length === 0) {
    return `
      <div class="ws-flow-section">
        <div class="ws-flow-header">
          <span>${t('flows')}</span>
          <button class="btn btn-sm btn-secondary" data-add-flow="${workspaceId}">${t('newFlow')}</button>
        </div>
      </div>`;
  }

  // Compact summary: show flow names as chips, minimal actions
  const chips = flows.map(f => {
    const urlMatched = f.enabled && f.trigger !== 'manual' && f.match && _activeTabUrl && matchUrlPattern(f.match, _activeTabUrl);
    return `
    <span class="flow-chip ${f.enabled ? '' : 'disabled'} ${urlMatched ? 'url-matched' : ''}">
      ${urlMatched ? '<span class="flow-match-dot" title="Matches current tab">&#9889;</span>' : ''}
      <span class="flow-edit" data-edit-flow="${f.id}" data-ws="${workspaceId}" title="${t('edit')}">${escapeHtml(f.name)}</span>
      <span class="flow-run" data-run-flow="${f.id}" data-ws="${workspaceId}" title="${t('run')}">&#9654;</span>
    </span>`;
  }).join('');

  return `
    <div class="ws-flow-section">
      <div class="ws-flow-header">
        <span>${t('flows')} (${flows.length})</span>
        <button class="btn btn-sm btn-secondary" data-add-flow="${workspaceId}">${t('newFlow')}</button>
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

function openFlowEditor(wsId, flowId) {
  viewMain.style.display = 'none';
  viewFlow.style.display = '';
  mountFlowEditor(wsId, flowId, () => {
    // Back button callback
    unmountFlowEditor();
    viewFlow.style.display = 'none';
    viewMain.style.display = '';
    renderList();
    detectCurrentWorkspace();
  });
}

async function addNewFlow(workspaceId) {
  const flow = createFlow();
  await saveFlow(workspaceId, flow);
  openFlowEditor(workspaceId, flow.id);
}

// --- i18n: apply translations to static HTML elements ---
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}

// --- Language selector ---
const langSelect = document.getElementById('lang-select');
langSelect.value = getLocale();
langSelect.addEventListener('change', async () => {
  await setLocale(langSelect.value);
  applyI18n();
  await detectCurrentWorkspace();
  await renderList();
  renderConflictBanner();
});

// --- Timezone selector ---
const tzSelect = document.getElementById('tz-select');
let _currentTz = getDetectedTimezone();

async function initTimezone() {
  _currentTz = await getTimezone();
  // Populate timezone options
  const detected = getDetectedTimezone();
  let zones;
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Fallback for older browsers
    zones = [detected];
  }
  // Add auto-detect option at top
  const autoLabel = `Auto (${detected})`;
  tzSelect.innerHTML = `<option value="">${autoLabel}</option>` +
    zones.map(z => `<option value="${z}" ${z === _currentTz && _currentTz !== detected ? 'selected' : ''}>${z}</option>`).join('');

  // If user has a saved timezone, select it; otherwise keep "Auto"
  const saved = (await chrome.storage.local.get('tabsyTimezone')).tabsyTimezone;
  if (saved) {
    tzSelect.value = saved;
  } else {
    tzSelect.value = '';
  }
}

tzSelect.addEventListener('change', async () => {
  await setTimezone(tzSelect.value);
  _currentTz = tzSelect.value || getDetectedTimezone();
  await detectCurrentWorkspace();
  await renderList();
});

// --- Init (progressive: show content fast, defer heavy work) ---
await initLocale();
langSelect.value = getLocale();
await initTimezone();
applyI18n();
initColorPicker();

// Phase 1: detect current workspace first (renderList depends on it)
Promise.all([detectCurrentWorkspace(), refreshActiveTabUrl()]).then(() => renderList()).then(() => {
  // Phase 2: non-critical UI + sync (deferred)
  renderConflictBanner();
  loadSettings();
  updateSyncBar();
  isSyncConfigured().then(configured => {
    if (configured) doSync();
  });
});

// Re-render when background auto-sync updates workspaces
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.workspaces) {
    detectCurrentWorkspace().then(() => renderList());
    renderConflictBanner();
  }
});

// Re-render flow match badges when active tab changes
chrome.tabs.onActivated.addListener(async () => {
  await refreshActiveTabUrl();
  renderList();
  if (currentWorkspaceData) {
    const ws = await getById(currentWorkspaceData.id);
    if (ws) renderCurrentWsFlows(ws);
  }
});
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
  if (!changeInfo.url) return;
  await refreshActiveTabUrl();
  renderList();
  if (currentWorkspaceData) {
    const ws = await getById(currentWorkspaceData.id);
    if (ws) renderCurrentWsFlows(ws);
  }
});
