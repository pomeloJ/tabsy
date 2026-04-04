import { getSettings, getClientId, setServerNowFn } from './storage.js';

// Wire up server-aligned clock for storage module
setServerNowFn(serverNow);

/**
 * Clock offset between client and server (milliseconds).
 * offset = serverTime - clientTime
 * Usage: new Date(Date.now() + offset) ≈ server's current time
 */
let _clockOffset = 0;
let _offsetCalibrated = false;

/**
 * Get current time aligned to server clock.
 * @returns {string} ISO 8601 timestamp
 */
export function serverNow() {
  return new Date(Date.now() + _clockOffset).toISOString();
}

/**
 * Whether the clock offset has been calibrated at least once.
 */
export function isClockCalibrated() {
  return _offsetCalibrated;
}

/**
 * Get the raw clock offset in milliseconds.
 * Positive = client is behind server. Negative = client is ahead.
 */
export function getClockOffset() {
  return { offset: _clockOffset, calibrated: _offsetCalibrated };
}

/**
 * Fetch wrapper that auto-injects Bearer token and server URL.
 * Also calibrates clock offset from serverTime in responses.
 * Returns { ok, status, data } or throws on network error.
 */
async function request(path, options = {}) {
  const { serverUrl, token, cfAccessClientId, cfAccessClientSecret } = await getSettings();
  if (!serverUrl) throw new Error('Server URL not configured');
  if (!token) throw new Error('Sync token not configured');

  const url = `${serverUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };

  // Cloudflare Access Service Token (optional)
  if (cfAccessClientId && cfAccessClientSecret) {
    headers['CF-Access-Client-Id'] = cfAccessClientId;
    headers['CF-Access-Client-Secret'] = cfAccessClientSecret;
  }

  const t1 = Date.now();
  const res = await fetch(url, { ...options, headers });
  const t2 = Date.now();

  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : null;

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  // Calibrate clock offset from serverTime in sync responses
  if (data && data.serverTime) {
    const serverMs = new Date(data.serverTime).getTime();
    const clientMid = (t1 + t2) / 2;
    _clockOffset = serverMs - clientMid;
    _offsetCalibrated = true;
  }

  return data;
}

export async function syncPull(lastSyncAt) {
  const clientId = await getClientId();
  return request('/api/sync/pull', {
    method: 'POST',
    body: JSON.stringify({ lastSyncAt: lastSyncAt || null, clientId })
  });
}

export async function syncPush(upsert, toDelete) {
  const clientId = await getClientId();
  return request('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ upsert, delete: toDelete, clientId })
  });
}
