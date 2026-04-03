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

// --- Workspace CRUD ---

export async function getAll() {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  return workspaces;
}

export async function getById(id) {
  const all = await getAll();
  return all.find(w => w.id === id) || null;
}

export async function save(workspace) {
  const all = await getAll();
  const idx = all.findIndex(w => w.id === workspace.id);
  if (idx >= 0) {
    all[idx] = workspace;
  } else {
    all.push(workspace);
  }
  await chrome.storage.local.set({ workspaces: all });
  return workspace;
}

export async function remove(id) {
  const all = await getAll();
  const ws = all.find(w => w.id === id);
  const filtered = all.filter(w => w.id !== id);
  await chrome.storage.local.set({ workspaces: filtered });
  // Track deletion for sync (only if it was a synced workspace)
  if (ws && ws.syncStatus === 'synced') {
    await addPendingDeletion(id);
  }
}

export async function clearAll() {
  const all = await getAll();
  const syncedIds = all.filter(w => w.syncStatus === 'synced').map(w => w.id);
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

// --- Sync Settings ---

export async function getSettings() {
  const { syncSettings = { serverUrl: '', token: '' } } = await chrome.storage.local.get('syncSettings');
  return syncSettings;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ syncSettings: settings });
}
