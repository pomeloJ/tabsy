/**
 * Three-way merge for workspace tabs and groups.
 * Pure logic — no Chrome API dependencies.
 *
 * @param {Object} base   - { tabs: [], groups: [] } from syncedSnapshot
 * @param {Object} local  - { tabs: [], groups: [] } current captured state
 * @param {Object} remote - { tabs: [], groups: [] } pulled from server
 * @returns {{ merged: { tabs, groups }, conflicts: [], hasConflicts: boolean }}
 */
export function threeWayMerge(base, local, remote) {
  const baseTabs = base.tabs || [];
  const localTabs = local.tabs || [];
  const remoteTabs = remote.tabs || [];

  const baseUrls = new Set(baseTabs.map(t => t.url));
  const localUrls = new Set(localTabs.map(t => t.url));
  const remoteUrls = new Set(remoteTabs.map(t => t.url));

  // Compute diffs
  const localAdded = new Set([...localUrls].filter(u => !baseUrls.has(u)));
  const localRemoved = new Set([...baseUrls].filter(u => !localUrls.has(u)));
  const remoteAdded = new Set([...remoteUrls].filter(u => !baseUrls.has(u)));
  const remoteRemoved = new Set([...baseUrls].filter(u => !remoteUrls.has(u)));

  // Detect conflicts: one side removed, the other added (same URL)
  const conflicts = [];
  for (const url of localRemoved) {
    if (remoteAdded.has(url)) {
      conflicts.push({
        url,
        type: 'local_removed_remote_added',
        localTab: null,
        remoteTab: remoteTabs.find(t => t.url === url) || null
      });
    }
  }
  for (const url of remoteRemoved) {
    if (localAdded.has(url)) {
      conflicts.push({
        url,
        type: 'remote_removed_local_added',
        localTab: localTabs.find(t => t.url === url) || null,
        remoteTab: null
      });
    }
  }

  // Build merged URL set: additions win for conflicts (keep the tab)
  const mergedUrls = new Set(baseUrls);

  for (const url of localAdded) mergedUrls.add(url);
  for (const url of remoteAdded) mergedUrls.add(url);

  const conflictUrls = new Set(conflicts.map(c => c.url));
  for (const url of localRemoved) {
    if (!conflictUrls.has(url)) mergedUrls.delete(url);
  }
  for (const url of remoteRemoved) {
    if (!conflictUrls.has(url)) mergedUrls.delete(url);
  }

  // Build tab lookup maps (URL → tab object)
  const localByUrl = new Map(localTabs.map(t => [t.url, t]));
  const remoteByUrl = new Map(remoteTabs.map(t => [t.url, t]));
  const baseByUrl = new Map(baseTabs.map(t => [t.url, t]));

  // Assemble merged tabs — priority: local > remote > base
  const mergedTabs = [];
  let idx = 0;
  for (const url of mergedUrls) {
    const tab = localByUrl.get(url) || remoteByUrl.get(url) || baseByUrl.get(url);
    if (tab) {
      mergedTabs.push({ ...tab, index: idx++ });
    }
  }

  // Order: keep local order for local tabs, append remote-only tabs at end
  const orderedTabs = [];
  const added = new Set();

  // First: tabs from local in their local order
  for (const lt of localTabs) {
    if (mergedUrls.has(lt.url) && !added.has(lt.url)) {
      orderedTabs.push({ ...lt, index: orderedTabs.length });
      added.add(lt.url);
    }
  }
  // Then: remote-only tabs (remoteAdded that aren't in local)
  for (const rt of remoteTabs) {
    if (mergedUrls.has(rt.url) && !added.has(rt.url)) {
      orderedTabs.push({ ...rt, index: orderedTabs.length });
      added.add(rt.url);
    }
  }
  // Finally: any base tabs still in merged but not yet added
  for (const bt of baseTabs) {
    if (mergedUrls.has(bt.url) && !added.has(bt.url)) {
      orderedTabs.push({ ...bt, index: orderedTabs.length });
      added.add(bt.url);
    }
  }

  // --- Group merge ---
  const mergedGroups = mergeGroups(base.groups || [], local.groups || [], remote.groups || [], orderedTabs);

  return {
    merged: { tabs: orderedTabs, groups: mergedGroups },
    conflicts,
    hasConflicts: conflicts.length > 0
  };
}

/**
 * Merge groups based on merged tabs' groupId references.
 * Uses title+color as a content-based identity when groupId strings differ.
 */
function mergeGroups(baseGroups, localGroups, remoteGroups, mergedTabs) {
  // Collect all groupIds referenced by merged tabs
  const neededGroupIds = new Set(
    mergedTabs.map(t => t.groupId).filter(Boolean)
  );

  // Build lookup maps
  const localById = new Map(localGroups.map(g => [g.groupId, g]));
  const remoteById = new Map(remoteGroups.map(g => [g.groupId, g]));
  const baseById = new Map(baseGroups.map(g => [g.groupId, g]));

  // Also build content-based lookup (title|color → group) for cross-device matching
  const remoteByContent = new Map(
    remoteGroups.map(g => [`${g.title}|${g.color}`, g])
  );
  const localByContent = new Map(
    localGroups.map(g => [`${g.title}|${g.color}`, g])
  );

  const result = [];
  const seen = new Set();

  for (const gid of neededGroupIds) {
    if (seen.has(gid)) continue;
    seen.add(gid);

    // Try direct ID match first, then content-based match
    let group = localById.get(gid) || remoteById.get(gid) || baseById.get(gid);

    if (!group) {
      // Try content-based match from remote groups
      for (const [, rg] of remoteByContent) {
        if (!seen.has(rg.groupId)) {
          // Check if any merged tab references this remote group's ID
          // (which may differ from gid)
          group = rg;
          break;
        }
      }
    }

    if (group) {
      result.push({ ...group, groupId: gid });
    } else {
      // Fallback: create a minimal group
      result.push({ groupId: gid, title: '', color: 'blue', collapsed: false });
    }
  }

  return result;
}
