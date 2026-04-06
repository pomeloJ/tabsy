import { getAll, getById, save, remove, getSettings, getPendingDeletions, clearPendingDeletions } from './storage.js';
import { syncPull, syncPush, serverNow } from './api-client.js';
import { threeWayMerge } from './merge.js';
import { applyMergedState } from './live-sync.js';
import { hasWorkspaceChanged } from './capture.js';
import { hasDangerousBlocks } from './flow-schema.js';

/**
 * Strip codeTrusted from synced flows that contain dangerous blocks.
 * Locally-created flows are trusted by default, but flows arriving from
 * the server must be re-approved if they contain executable code.
 */
function sanitizeSyncedFlows(flows) {
  if (!flows) return [];
  return flows.map(f => {
    if (hasDangerousBlocks(f)) {
      const { codeTrusted, ...rest } = f;
      return rest; // remove codeTrusted — user must re-approve
    }
    return f;
  });
}

/**
 * Merge notes arrays using per-note LWW based on updatedAt.
 * Notes have unique IDs, so we can union them and pick the newest version.
 */
function mergeNotes(localNotes, remoteNotes) {
  const local = localNotes || [];
  const remote = remoteNotes || [];
  const byId = new Map();

  // Add all local notes
  for (const n of local) byId.set(n.id, n);

  // Merge remote: if same ID, pick newer; if new ID, add
  for (const rn of remote) {
    const ln = byId.get(rn.id);
    if (!ln) {
      byId.set(rn.id, rn); // new from remote
    } else {
      // Both have it — pick newer updatedAt
      const lt = new Date(ln.updatedAt || ln.createdAt || 0).getTime();
      const rt = new Date(rn.updatedAt || rn.createdAt || 0).getTime();
      if (rt > lt) byId.set(rn.id, rn);
    }
  }

  return Array.from(byId.values());
}

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
 * Check if a workspace's tabs/groups match its syncedSnapshot (no local changes).
 */
function matchesSnapshot(ws) {
  if (!ws.syncedSnapshot) return false;
  return !hasWorkspaceChanged(ws.syncedSnapshot, { tabs: ws.tabs, groups: ws.groups });
}

/**
 * Full sync: pull with three-way merge, then push.
 * @param {Array} openWorkspaceWindows - [{ windowId, workspaceId, workspaceName, workspaceColor }]
 * @returns {{ pulled, pushed, conflicts, liveUpdates, error }}
 */
export async function performSync(openWorkspaceWindows = []) {
  const configured = await isSyncConfigured();
  if (!configured) {
    return { pulled: 0, pushed: 0, conflicts: 0, liveUpdates: 0, error: 'Sync not configured' };
  }

  const lastSyncAt = await getLastSyncAt();
  let pulled = 0;
  let pushed = 0;
  let conflictCount = 0;
  let liveUpdates = 0;

  try {
    // --- PULL ---
    const pullResult = await syncPull(lastSyncAt);
    console.log(`[Tabsy] Pull: ${pullResult.workspaces.length} workspaces returned, lastSyncAt=${lastSyncAt}`);

    for (const serverWs of pullResult.workspaces) {
      const localWs = await getById(serverWs.id);

      // Case 1: New workspace from remote — accept directly
      if (!localWs) {
        serverWs.syncStatus = 'synced';
        serverWs.lastSyncAt = pullResult.serverTime;
        serverWs.syncedSnapshot = { tabs: serverWs.tabs, groups: serverWs.groups };
        serverWs.flows = sanitizeSyncedFlows(serverWs.flows || []);
        await save(serverWs);
        pulled++;
        continue;
      }

      // Merge flows: server pull 不應該覆蓋 local 的 flows
      // 以 local flows 為主，server 有而 local 沒有的才加入
      // 從 server 來的新 flow 若含 dangerous blocks，strip codeTrusted
      const mergedFlows = [...(localWs.flows || [])];
      const sanitizedServerFlows = sanitizeSyncedFlows(serverWs.flows);
      for (const sf of sanitizedServerFlows) {
        if (!mergedFlows.find(f => f.id === sf.id)) {
          mergedFlows.push(sf);
        }
      }
      const flowsChanged = mergedFlows.length !== (localWs.flows || []).length;

      // Case 2: Already in conflict — update remote version in conflictData
      if (localWs.syncStatus === 'conflict' && localWs.conflictData) {
        localWs.conflictData.remoteVersion = {
          tabs: serverWs.tabs,
          groups: serverWs.groups,
          savedAt: serverWs.savedAt
        };
        await save(localWs);
        continue;
      }

      // Case 3: No syncedSnapshot (migration) — fall back to LWW, but always merge notes
      if (!localWs.syncedSnapshot) {
        if (new Date(serverWs.savedAt) >= new Date(localWs.savedAt)) {
          serverWs.flows = mergedFlows;
          serverWs.notes = mergeNotes(localWs.notes, serverWs.notes);
          serverWs.syncStatus = flowsChanged ? 'pending' : 'synced';
          serverWs.lastSyncAt = pullResult.serverTime;
          serverWs.syncedSnapshot = { tabs: serverWs.tabs, groups: serverWs.groups };
          await save(serverWs);
          pulled++;

          // Live sync to open window
          const openWin = openWorkspaceWindows.find(w => w.workspaceId === localWs.id);
          if (openWin) {
            try {
              await applyMergedState(openWin.windowId, serverWs.tabs, serverWs.groups);
              liveUpdates++;
            } catch (e) {
              console.warn('[Tabsy] Live sync failed:', e.message);
            }
          }
        }
        // Either way, snapshot is now set for future merges
        if (!localWs.syncedSnapshot) {
          localWs.syncedSnapshot = { tabs: localWs.tabs, groups: localWs.groups };
          await save(localWs);
        }
        continue;
      }

      const base = localWs.syncedSnapshot;
      const localState = { tabs: localWs.tabs, groups: localWs.groups };
      const remoteState = { tabs: serverWs.tabs, groups: serverWs.groups };

      const localChanged = hasWorkspaceChanged(base, localState);
      const remoteChanged = hasWorkspaceChanged(base, remoteState);

      console.log(`[Tabsy] Sync merge for "${localWs.name}": localChanged=${localChanged}, remoteChanged=${remoteChanged}, localTabs=${localState.tabs.length}, remoteTabs=${remoteState.tabs.length}, baseTabs=${base.tabs.length}`);

      // Case 4: Only remote changed — accept remote + live sync
      if (!localChanged && remoteChanged) {
        localWs.tabs = serverWs.tabs;
        localWs.groups = serverWs.groups;
        localWs.flows = mergedFlows;
        localWs.savedAt = serverWs.savedAt;
        localWs.name = serverWs.name;
        localWs.color = serverWs.color;
        localWs.notes = mergeNotes(localWs.notes, serverWs.notes);
        localWs.syncStatus = flowsChanged ? 'pending' : 'synced';
        localWs.lastSyncAt = pullResult.serverTime;
        localWs.syncedSnapshot = { tabs: serverWs.tabs, groups: serverWs.groups };
        await save(localWs);
        pulled++;

        // Live sync to open window
        const openWin = openWorkspaceWindows.find(w => w.workspaceId === localWs.id);
        if (openWin) {
          try {
            await applyMergedState(openWin.windowId, serverWs.tabs, serverWs.groups);
            liveUpdates++;
          } catch (e) {
            console.warn('[Tabsy] Live sync failed:', e.message);
          }
        }
        continue;
      }

      // Case 5: Only local changed — keep local, but still merge notes from remote
      if (localChanged && !remoteChanged) {
        const notesMerged = mergeNotes(localWs.notes, serverWs.notes);
        if (JSON.stringify(notesMerged) !== JSON.stringify(localWs.notes)) {
          localWs.notes = notesMerged;
          await save(localWs);
        }
        continue;
      }

      // Case 6: Neither changed — just update sync metadata + merge notes
      if (!localChanged && !remoteChanged) {
        localWs.flows = mergedFlows;
        localWs.notes = mergeNotes(localWs.notes, serverWs.notes);
        localWs.lastSyncAt = pullResult.serverTime;
        localWs.syncStatus = flowsChanged ? 'pending' : 'synced';
        await save(localWs);
        continue;
      }

      // Case 7: Both changed — three-way merge
      const mergeResult = threeWayMerge(base, localState, remoteState);

      // Always merge notes regardless of tab/group conflict status
      const mergedNotes = mergeNotes(localWs.notes, serverWs.notes);

      if (mergeResult.hasConflicts) {
        localWs.syncStatus = 'conflict';
        localWs.notes = mergedNotes;
        localWs.conflictData = {
          localVersion: { tabs: localWs.tabs, groups: localWs.groups, savedAt: localWs.savedAt },
          remoteVersion: { tabs: serverWs.tabs, groups: serverWs.groups, savedAt: serverWs.savedAt },
          conflicts: mergeResult.conflicts
        };
        await save(localWs);
        conflictCount++;
      } else {
        // Clean merge — apply and mark as pending for push
        localWs.tabs = mergeResult.merged.tabs;
        localWs.groups = mergeResult.merged.groups;
        localWs.notes = mergedNotes;
        localWs.savedAt = serverNow();
        localWs.syncStatus = 'pending';
        localWs.syncedSnapshot = { tabs: mergeResult.merged.tabs, groups: mergeResult.merged.groups };
        await save(localWs);
        pulled++;

        // Live sync to open window
        const openWin = openWorkspaceWindows.find(w => w.workspaceId === localWs.id);
        if (openWin) {
          try {
            await applyMergedState(openWin.windowId, mergeResult.merged.tabs, mergeResult.merged.groups);
            liveUpdates++;
          } catch (e) {
            console.warn('[Tabsy] Live sync failed:', e.message);
          }
        }
      }
    }

    // Apply pulled deletions
    for (const deletedId of pullResult.deleted) {
      const ws = await getById(deletedId);
      if (ws) {
        await remove(deletedId);
        pulled++;
      }
    }

    // --- PUSH ---
    const allLocal = await getAll();
    let toPush = allLocal.filter(w =>
      w.syncStatus === 'local_only' ||
      w.syncStatus === 'pending' ||
      !w.syncStatus
    );
    const pendingDeletes = await getPendingDeletions();
    if (toPush.length > 0) {
      console.log(`[Tabsy] Push: ${toPush.length} workspaces to push:`, toPush.map(w => `${w.name}(${w.tabs.length} tabs, ${w.syncStatus})`));
    }

    // --- Re-check: full inventory sync ---
    // When the normal pull returned nothing new (lastSyncAt was recent), do a
    // full pull (lastSyncAt=null) to get the complete server inventory and
    // reconcile differences:
    //   1. Server deleted a workspace → remove locally
    //   2. Server DB reset → local 'synced' missing on server → re-push
    //   3. Workspace created on server (Web UI) → pull in as new
    if (pulled === 0 && lastSyncAt) {
      const fullPull = await syncPull(null);
      const localIds = new Set(allLocal.map(w => w.id));
      const serverIds = new Set(fullPull.workspaces.map(w => w.id));
      const serverDeletedIds = new Set(fullPull.deleted || []);

      // Case 1 & 2: local synced but not on server
      for (const ws of allLocal) {
        if (ws.syncStatus !== 'synced') continue;
        if (serverIds.has(ws.id)) continue;

        if (serverDeletedIds.has(ws.id)) {
          // Case 1: deleted on server → remove locally
          await remove(ws.id);
          pulled++;
        } else {
          // Case 2: server doesn't know about it (DB reset) → re-push
          ws.syncStatus = 'pending';
          await save(ws);
          toPush.push(ws);
        }
      }

      // Case 3: on server but not local → pull in as new
      for (const serverWs of fullPull.workspaces) {
        if (!localIds.has(serverWs.id)) {
          serverWs.syncStatus = 'synced';
          serverWs.lastSyncAt = fullPull.serverTime;
          serverWs.syncedSnapshot = { tabs: serverWs.tabs, groups: serverWs.groups };
          serverWs.flows = sanitizeSyncedFlows(serverWs.flows || []);
          await save(serverWs);
          pulled++;
          continue;
        }

        // Case 4: both have it → check if server content differs
        const localWs = await getById(serverWs.id);
        if (!localWs || localWs.syncStatus === 'conflict') continue;

        const remoteState = { tabs: serverWs.tabs, groups: serverWs.groups };
        const localState = { tabs: localWs.tabs, groups: localWs.groups };

        if (!hasWorkspaceChanged(localState, remoteState)) continue;

        console.log(`[Tabsy] Full inventory: content differs for "${localWs.name}" (local=${localState.tabs.length} tabs, server=${remoteState.tabs.length} tabs)`);

        // Use three-way merge if snapshot exists
        if (localWs.syncedSnapshot) {
          const base = localWs.syncedSnapshot;
          const localChanged = hasWorkspaceChanged(base, localState);
          const remoteChanged = hasWorkspaceChanged(base, remoteState);

          if (!localChanged && remoteChanged) {
            // Only server changed — accept server
            localWs.tabs = serverWs.tabs;
            localWs.groups = serverWs.groups;
            localWs.savedAt = serverWs.savedAt;
            localWs.name = serverWs.name;
            localWs.color = serverWs.color;
            localWs.notes = mergeNotes(localWs.notes, serverWs.notes);
            localWs.syncStatus = 'synced';
            localWs.lastSyncAt = fullPull.serverTime;
            localWs.syncedSnapshot = { tabs: serverWs.tabs, groups: serverWs.groups };
            await save(localWs);
            pulled++;

            const openWin = openWorkspaceWindows.find(w => w.workspaceId === localWs.id);
            if (openWin) {
              try {
                await applyMergedState(openWin.windowId, serverWs.tabs, serverWs.groups);
                liveUpdates++;
              } catch (e) {
                console.warn('[Tabsy] Live sync failed:', e.message);
              }
            }
          } else if (localChanged && remoteChanged) {
            // Both changed — three-way merge
            const mergeResult = threeWayMerge(base, localState, remoteState);
            const notesMerged = mergeNotes(localWs.notes, serverWs.notes);
            if (mergeResult.hasConflicts) {
              localWs.syncStatus = 'conflict';
              localWs.notes = notesMerged;
              localWs.conflictData = {
                localVersion: { tabs: localWs.tabs, groups: localWs.groups, savedAt: localWs.savedAt },
                remoteVersion: { tabs: serverWs.tabs, groups: serverWs.groups, savedAt: serverWs.savedAt },
                conflicts: mergeResult.conflicts
              };
              await save(localWs);
              conflictCount++;
            } else {
              localWs.tabs = mergeResult.merged.tabs;
              localWs.groups = mergeResult.merged.groups;
              localWs.notes = notesMerged;
              localWs.savedAt = serverNow();
              localWs.syncStatus = 'pending';
              localWs.syncedSnapshot = { tabs: mergeResult.merged.tabs, groups: mergeResult.merged.groups };
              await save(localWs);
              pulled++;

              const openWin = openWorkspaceWindows.find(w => w.workspaceId === localWs.id);
              if (openWin) {
                try {
                  await applyMergedState(openWin.windowId, mergeResult.merged.tabs, mergeResult.merged.groups);
                  liveUpdates++;
                } catch (e) {
                  console.warn('[Tabsy] Live sync failed:', e.message);
                }
              }
            }
          }
        } else {
          // No snapshot — LWW, server wins if newer (but always merge notes)
          if (new Date(serverWs.savedAt) >= new Date(localWs.savedAt)) {
            localWs.tabs = serverWs.tabs;
            localWs.groups = serverWs.groups;
            localWs.savedAt = serverWs.savedAt;
            localWs.name = serverWs.name;
            localWs.color = serverWs.color;
            localWs.notes = mergeNotes(localWs.notes, serverWs.notes);
            localWs.syncStatus = 'synced';
            localWs.lastSyncAt = fullPull.serverTime;
            localWs.syncedSnapshot = { tabs: serverWs.tabs, groups: serverWs.groups };
            await save(localWs);
            pulled++;

            const openWin = openWorkspaceWindows.find(w => w.workspaceId === localWs.id);
            if (openWin) {
              try {
                await applyMergedState(openWin.windowId, serverWs.tabs, serverWs.groups);
                liveUpdates++;
              } catch (e) {
                console.warn('[Tabsy] Live sync failed:', e.message);
              }
            }
          }
        }
      }
    }

    if (toPush.length > 0 || pendingDeletes.length > 0) {
      // Strip client-only fields before sending to server
      const pushPayload = toPush.map(ws => ({
        id: ws.id,
        name: ws.name,
        color: ws.color,
        savedAt: ws.savedAt,
        groups: ws.groups,
        tabs: ws.tabs,
        flows: ws.flows || [],
        notes: ws.notes || []
      }));

      const pushResult = await syncPush(pushPayload, pendingDeletes);
      const serverConflicts = pushResult.conflicts || [];

      // Handle push conflicts with three-way merge
      for (const conflict of serverConflicts) {
        const localWs = await getById(conflict.id);
        if (!localWs) continue;

        if (localWs.syncedSnapshot) {
          const base = localWs.syncedSnapshot;
          const localState = { tabs: localWs.tabs, groups: localWs.groups };
          const remoteState = { tabs: conflict.serverVersion.tabs, groups: conflict.serverVersion.groups };
          const mergeResult = threeWayMerge(base, localState, remoteState);

          const notesMerged = mergeNotes(localWs.notes, conflict.serverVersion.notes);
          if (mergeResult.hasConflicts) {
            localWs.syncStatus = 'conflict';
            localWs.notes = notesMerged;
            localWs.conflictData = {
              localVersion: { tabs: localWs.tabs, groups: localWs.groups, savedAt: localWs.savedAt },
              remoteVersion: { tabs: conflict.serverVersion.tabs, groups: conflict.serverVersion.groups, savedAt: conflict.serverVersion.savedAt },
              conflicts: mergeResult.conflicts
            };
            await save(localWs);
            conflictCount++;
          } else {
            // Clean merge — save merged, will push next cycle
            localWs.tabs = mergeResult.merged.tabs;
            localWs.groups = mergeResult.merged.groups;
            localWs.notes = notesMerged;
            localWs.savedAt = serverNow();
            localWs.syncStatus = 'pending';
            localWs.syncedSnapshot = { tabs: mergeResult.merged.tabs, groups: mergeResult.merged.groups };
            await save(localWs);
          }
        } else {
          // No snapshot — LWW fallback, server wins, but preserve local flows + merge notes
          const serverVer = conflict.serverVersion;
          const localForFlows = await getById(conflict.id);
          serverVer.flows = localForFlows?.flows || serverVer.flows || [];
          serverVer.notes = mergeNotes(localForFlows?.notes, serverVer.notes);
          serverVer.syncStatus = (serverVer.flows.length > 0) ? 'pending' : 'synced';
          serverVer.lastSyncAt = pushResult.serverTime;
          serverVer.syncedSnapshot = { tabs: serverVer.tabs, groups: serverVer.groups };
          await save(serverVer);
        }
      }

      // Mark successful pushes as synced + store snapshot
      const conflictIds = new Set(serverConflicts.map(c => c.id));
      for (const ws of toPush) {
        if (conflictIds.has(ws.id)) continue;
        const fresh = await getById(ws.id);
        if (!fresh) continue;
        fresh.syncStatus = 'synced';
        fresh.lastSyncAt = pushResult.serverTime;
        fresh.syncedSnapshot = { tabs: fresh.tabs, groups: fresh.groups };
        await save(fresh);
        pushed++;
      }

      await clearPendingDeletions();
      await setLastSyncAt(pushResult.serverTime);
    } else {
      await setLastSyncAt(pullResult.serverTime);
    }

    // --- RECONCILE: ensure open browser windows match stored state ---
    // Background auto-sync may have already pulled changes but failed to
    // apply them to the browser, or applyMergedState was never called.
    // Compare each open workspace window's tabs against stored data.
    for (const openWin of openWorkspaceWindows) {
      try {
        const ws = await getById(openWin.workspaceId);
        if (!ws || ws.syncStatus === 'conflict') continue;

        const browserTabs = await chrome.tabs.query({ windowId: openWin.windowId });
        const markerBase = chrome.runtime.getURL('marker.html');
        const markerTab = browserTabs.find(t => t.url?.startsWith(markerBase));
        const markerGroupId = markerTab?.groupId ?? -1;
        const liveTabs = browserTabs.filter(t =>
          !t.url?.startsWith(markerBase) && (markerGroupId === -1 || t.groupId !== markerGroupId)
        );

        const storedUrls = new Set(ws.tabs.map(t => t.url));
        const browserUrls = new Set(liveTabs.map(t => t.url));

        console.log(`[Tabsy] Reconcile check "${ws.name}": stored=${storedUrls.size} tabs, browser=${browserUrls.size} tabs`);

        let needsReconcile = storedUrls.size !== browserUrls.size;
        if (!needsReconcile) {
          for (const url of storedUrls) {
            if (!browserUrls.has(url)) { needsReconcile = true; break; }
          }
        }

        if (needsReconcile) {
          console.log(`[Tabsy] Reconcile: applying stored state to browser for "${ws.name}"`);
          await applyMergedState(openWin.windowId, ws.tabs, ws.groups);
          liveUpdates++;
        } else {
          console.log(`[Tabsy] Reconcile: browser matches stored for "${ws.name}"`);
        }
      } catch (e) {
        console.warn('[Tabsy] Reconcile failed:', e.message);
      }
    }

    return { pulled, pushed, conflicts: conflictCount, liveUpdates, error: null };
  } catch (err) {
    console.error('Sync error:', err);
    return { pulled, pushed, conflicts: conflictCount, liveUpdates, error: err.message };
  }
}
