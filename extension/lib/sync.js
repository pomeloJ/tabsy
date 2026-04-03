import { getAll, save, remove, getSettings, getPendingDeletions, clearPendingDeletions } from './storage.js';
import { syncPull, syncPush } from './api-client.js';

/**
 * Get/set lastSyncAt from chrome.storage.local
 */
async function getLastSyncAt() {
  const { lastSyncAt } = await chrome.storage.local.get('lastSyncAt');
  return lastSyncAt || null;
}

async function setLastSyncAt(time) {
  await chrome.storage.local.set({ lastSyncAt: time });
}

/**
 * Check if sync is configured (server URL + token present)
 */
export async function isSyncConfigured() {
  const { serverUrl, token } = await getSettings();
  return !!(serverUrl && token);
}

/**
 * Full sync: pull then push.
 * Returns { pulled, pushed, conflicts, error }
 */
export async function performSync() {
  const configured = await isSyncConfigured();
  if (!configured) {
    return { pulled: 0, pushed: 0, conflicts: [], error: 'Sync not configured' };
  }

  const lastSyncAt = await getLastSyncAt();
  let pulled = 0;
  let pushed = 0;
  let conflicts = [];

  try {
    // --- PULL ---
    const pullResult = await syncPull(lastSyncAt);

    // Apply pulled workspaces (server wins if server version is newer)
    const localWorkspaces = await getAll();
    for (const serverWs of pullResult.workspaces) {
      const local = localWorkspaces.find(w => w.id === serverWs.id);
      if (!local || new Date(serverWs.savedAt) >= new Date(local.savedAt)) {
        serverWs.syncStatus = 'synced';
        serverWs.lastSyncAt = pullResult.serverTime;
        await save(serverWs);
        pulled++;
      }
    }

    // Apply pulled deletions
    for (const deletedId of pullResult.deleted) {
      await remove(deletedId);
      pulled++;
    }

    // --- PUSH ---
    const allLocal = await getAll();
    const toPush = allLocal.filter(w =>
      w.syncStatus === 'local_only' ||
      w.syncStatus === 'pending' ||
      !w.syncStatus
    );
    const pendingDeletes = await getPendingDeletions();

    if (toPush.length > 0 || pendingDeletes.length > 0) {
      const pushResult = await syncPush(toPush, pendingDeletes);
      conflicts = pushResult.conflicts || [];

      // Mark pushed workspaces as synced
      for (const ws of toPush) {
        const conflicted = conflicts.find(c => c.id === ws.id);
        if (conflicted) {
          // Server wins — apply server version
          const serverVer = conflicted.serverVersion;
          serverVer.syncStatus = 'synced';
          serverVer.lastSyncAt = pushResult.serverTime;
          await save(serverVer);
        } else {
          ws.syncStatus = 'synced';
          ws.lastSyncAt = pushResult.serverTime;
          await save(ws);
          pushed++;
        }
      }

      // Clear pending deletions after successful push
      await clearPendingDeletions();
      await setLastSyncAt(pushResult.serverTime);
    } else {
      await setLastSyncAt(pullResult.serverTime);
    }

    return { pulled, pushed, conflicts, error: null };
  } catch (err) {
    console.error('Sync error:', err);
    return { pulled, pushed, conflicts, error: err.message };
  }
}
