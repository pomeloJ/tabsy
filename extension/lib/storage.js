// 10-color system (shared with server/Web UI)
export const COLORS = [
  { name: '藍', hex: '#0078d4', chrome: 'blue' },
  { name: '綠', hex: '#107c10', chrome: 'green' },
  { name: '紅', hex: '#d13438', chrome: 'red' },
  { name: '橘', hex: '#ca5010', chrome: 'orange' },
  { name: '紫', hex: '#881798', chrome: 'purple' },
  { name: '青', hex: '#038387', chrome: 'cyan' },
  { name: '粉', hex: '#e3008c', chrome: 'pink' },
  { name: '灰', hex: '#69797e', chrome: 'grey' },
  { name: '深藍', hex: '#003966', chrome: 'blue' },
  { name: '深綠', hex: '#0b6a0b', chrome: 'green' }
];

// Find chrome tabGroups color name for a hex color
export function hexToChromeColor(hex) {
  const entry = COLORS.find(c => c.hex === hex);
  return entry ? entry.chrome : 'blue';
}

export function generateId() {
  return crypto.randomUUID();
}

// --- In-memory cache (survives page navigation via sessionStorage) ---
const _CACHE_KEY = '_tabsy_ws';
let _cache = null; // null = not loaded yet

// On module load: try to restore from sessionStorage (synchronous, instant)
try {
  const stored = sessionStorage.getItem(_CACHE_KEY);
  if (stored) _cache = JSON.parse(stored);
} catch { /* ignore parse errors */ }

function _persistCache() {
  try { sessionStorage.setItem(_CACHE_KEY, JSON.stringify(_cache)); } catch {}
}

async function _ensureCache() {
  if (_cache !== null) return _cache;
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  _cache = workspaces;
  _persistCache();
  return _cache;
}

// If cache was restored from sessionStorage, validate against chrome.storage in background
if (_cache !== null) {
  chrome.storage.local.get('workspaces').then(({ workspaces = [] }) => {
    // Compare by length + IDs + savedAt timestamps (cheap check)
    const stale = _cache.length !== workspaces.length ||
      _cache.some((w, i) => w.id !== workspaces[i]?.id || w.savedAt !== workspaces[i]?.savedAt);
    if (stale) {
      _cache = workspaces;
      _persistCache();
    }
  });
}

// Invalidate cache when storage changes from another context (background, other tab)
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.workspaces) {
      _cache = changes.workspaces.newValue || [];
      _persistCache();
    }
  });
}

// --- Workspace CRUD ---

export async function getAll() {
  const all = await _ensureCache();
  return all;
}

export async function getById(id) {
  const all = await _ensureCache();
  return all.find(w => w.id === id) || null;
}

export async function save(workspace) {
  const all = await _ensureCache();
  const idx = all.findIndex(w => w.id === workspace.id);
  if (idx >= 0) {
    all[idx] = workspace;
  } else {
    all.push(workspace);
  }
  _cache = all;
  _persistCache();
  await chrome.storage.local.set({ workspaces: all });
  return workspace;
}

export async function remove(id) {
  const all = await _ensureCache();
  const ws = all.find(w => w.id === id);
  const filtered = all.filter(w => w.id !== id);
  _cache = filtered;
  _persistCache();
  await chrome.storage.local.set({ workspaces: filtered });
  // Track deletion for sync (only if it was a synced workspace)
  if (ws && ws.syncStatus === 'synced') {
    await addPendingDeletion(id);
  }
}

export async function clearAll() {
  const all = await _ensureCache();
  const syncedIds = all.filter(w => w.syncStatus === 'synced').map(w => w.id);
  _cache = [];
  _persistCache();
  await chrome.storage.local.set({ workspaces: [] });
  // Track all synced workspace deletions
  for (const id of syncedIds) {
    await addPendingDeletion(id);
  }
}

// --- Pending Deletions (for sync push) ---

export async function getPendingDeletions() {
  const { pendingDeletions = [] } = await chrome.storage.local.get('pendingDeletions');
  return pendingDeletions;
}

async function addPendingDeletion(id) {
  const deletions = await getPendingDeletions();
  if (!deletions.includes(id)) {
    deletions.push(id);
    await chrome.storage.local.set({ pendingDeletions: deletions });
  }
}

export async function clearPendingDeletions() {
  await chrome.storage.local.set({ pendingDeletions: [] });
}

// --- Conflict helpers ---

export async function getConflicts() {
  const all = await getAll();
  return all.filter(w => w.syncStatus === 'conflict');
}

// --- Sync Settings ---

export async function getSettings() {
  const { syncSettings = { serverUrl: '', token: '' } } = await chrome.storage.local.get('syncSettings');
  return syncSettings;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ syncSettings: settings });
}

// --- Flow CRUD (flows 存在 workspace.flows 陣列中，跟著 sync 一起同步) ---

export async function getFlows(workspaceId) {
  if (workspaceId) {
    const ws = await getById(workspaceId);
    return ws?.flows || [];
  }
  // 回傳所有 workspace 的 flows map: { wsId: [...] }
  const all = await getAll();
  const map = {};
  for (const ws of all) {
    if (ws.flows && ws.flows.length > 0) {
      map[ws.id] = ws.flows;
    }
  }
  return map;
}

export async function getFlowById(workspaceId, flowId) {
  const flows = await getFlows(workspaceId);
  return flows.find(f => f.id === flowId) || null;
}

export async function saveFlow(workspaceId, flow) {
  const ws = await getById(workspaceId);
  if (!ws) return flow;
  if (!ws.flows) ws.flows = [];
  const idx = ws.flows.findIndex(f => f.id === flow.id);
  if (idx >= 0) {
    ws.flows[idx] = flow;
  } else {
    ws.flows.push(flow);
  }
  ws.savedAt = new Date().toISOString();
  if (ws.syncStatus === 'synced') ws.syncStatus = 'pending';
  await save(ws);
  return flow;
}

export async function removeFlow(workspaceId, flowId) {
  const ws = await getById(workspaceId);
  if (!ws || !ws.flows) return;
  ws.flows = ws.flows.filter(f => f.id !== flowId);
  ws.savedAt = new Date().toISOString();
  if (ws.syncStatus === 'synced') ws.syncStatus = 'pending';
  await save(ws);
}

// --- Client ID (persistent browser instance identifier) ---

export async function getClientId() {
  let { clientId } = await chrome.storage.local.get('clientId');
  if (!clientId) {
    clientId = crypto.randomUUID();
    await chrome.storage.local.set({ clientId });
  }
  return clientId;
}

// --- Timezone setting (auto-detect from browser, allow override) ---

const _detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function getTimezone() {
  const { tabsyTimezone } = await chrome.storage.local.get('tabsyTimezone');
  return tabsyTimezone || _detectedTimezone;
}

export async function setTimezone(tz) {
  await chrome.storage.local.set({ tabsyTimezone: tz || '' });
}

export function getDetectedTimezone() {
  return _detectedTimezone;
}

/**
 * Format an ISO date string using the saved timezone.
 * @param {string} iso - ISO 8601 date string
 * @param {string} tz - IANA timezone (e.g. 'Asia/Taipei')
 * @param {object} [opts] - extra Intl.DateTimeFormat options
 * @returns {string}
 */
export function formatDateTime(iso, tz, opts = {}) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleString(undefined, {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
    ...opts
  });
}

export function formatDateTimeShort(iso, tz) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleString(undefined, {
    timeZone: tz,
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false
  });
}

export function formatTimeOnly(iso, tz) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleString(undefined, {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
}

// --- Auto-sync setting (default: enabled) ---

export async function getAutoSync() {
  const { autoSyncEnabled } = await chrome.storage.local.get('autoSyncEnabled');
  return autoSyncEnabled !== false; // default true
}

export async function setAutoSync(enabled) {
  await chrome.storage.local.set({ autoSyncEnabled: !!enabled });
}

// --- Migration: 把舊的獨立 flows key 搬到 workspace.flows ---
async function migrateFlows() {
  const { flows, _flowsMigrated } = await chrome.storage.local.get(['flows', '_flowsMigrated']);
  if (_flowsMigrated || !flows || Object.keys(flows).length === 0) return;

  const all = await getAll();
  let changed = false;
  for (const ws of all) {
    const wsFlows = flows[ws.id];
    if (wsFlows && wsFlows.length > 0) {
      ws.flows = wsFlows;
      if (ws.syncStatus === 'synced') ws.syncStatus = 'pending';
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ workspaces: all });
  }
  // 標記已遷移，刪除舊 key
  await chrome.storage.local.set({ _flowsMigrated: true });
  await chrome.storage.local.remove('flows');
}
migrateFlows();
