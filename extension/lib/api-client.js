import { getSettings } from './storage.js';

/**
 * Fetch wrapper that auto-injects Bearer token and server URL.
 * Returns { ok, status, data } or throws on network error.
 */
async function request(path, options = {}) {
  const { serverUrl, token } = await getSettings();
  if (!serverUrl) throw new Error('Server URL not configured');
  if (!token) throw new Error('Sync token not configured');

  const url = `${serverUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };

  const res = await fetch(url, { ...options, headers });
  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : null;

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  return data;
}

export async function syncPull(lastSyncAt) {
  return request('/api/sync/pull', {
    method: 'POST',
    body: JSON.stringify({ lastSyncAt: lastSyncAt || null })
  });
}

export async function syncPush(upsert, toDelete) {
  return request('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ upsert, delete: toDelete })
  });
}
