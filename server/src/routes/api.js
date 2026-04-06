const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// --- Validation helpers ---

const MAX_SYNC_UPSERT = 100;
const MAX_SYNC_DELETE = 100;
const MAX_ID_LENGTH = 64;
const ID_PATTERN = /^[a-zA-Z0-9\-_]+$/;

function isValidId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}

function safeJsonParse(str, fallback = []) {
  try { return JSON.parse(str); }
  catch { return fallback; }
}

/** Ensure SQLite datetime strings are proper ISO 8601 with UTC indicator */
function utc(dt) {
  if (!dt) return dt;
  // Already has timezone info (Z or +/-offset)
  if (/[Z+\-]\d{0,4}$/.test(dt)) return dt;
  // SQLite datetime('now') format: "2026-04-04 08:45:00" → append Z
  return dt.replace(' ', 'T') + 'Z';
}

// All /api/workspaces routes require auth
router.use('/workspaces', requireAuth);

// Prepared statements
const listWorkspaces = db.prepare(
  'SELECT id, name, color, saved_at, updated_at, last_synced_by, groups, tabs, flows, notes FROM workspaces WHERE user_id = ? ORDER BY saved_at DESC'
);
const getWorkspace = db.prepare(
  'SELECT * FROM workspaces WHERE id = ? AND user_id = ?'
);
const insertWorkspace = db.prepare(
  'INSERT INTO workspaces (id, user_id, name, color, saved_at, groups, tabs, flows, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const updateWorkspace = db.prepare(
  "UPDATE workspaces SET name = ?, color = ?, saved_at = ?, groups = ?, tabs = ?, flows = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?"
);
const deleteWorkspace = db.prepare(
  'DELETE FROM workspaces WHERE id = ? AND user_id = ?'
);
const recordDeletion = db.prepare(
  "INSERT OR REPLACE INTO deleted_workspaces (id, user_id, deleted_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
);

// Sync prepared statements
const getWorkspacesSince = db.prepare(
  'SELECT * FROM workspaces WHERE user_id = ? AND updated_at > ?'
);
const getDeletedSince = db.prepare(
  'SELECT id FROM deleted_workspaces WHERE user_id = ? AND deleted_at > ?'
);
const upsertWorkspace = db.prepare(`
  INSERT INTO workspaces (id, user_id, name, color, saved_at, groups, tabs, flows, notes, updated_at, last_synced_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    color = excluded.color,
    saved_at = excluded.saved_at,
    groups = excluded.groups,
    tabs = excluded.tabs,
    flows = excluded.flows,
    notes = excluded.notes,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_synced_by = excluded.last_synced_by
  WHERE excluded.saved_at >= workspaces.saved_at
`);
const insertSyncLog = db.prepare(
  'INSERT INTO sync_logs (user_id, client_id, action, workspace_count, details) VALUES (?, ?, ?, ?, ?)'
);
const insertSyncChange = db.prepare(
  'INSERT INTO sync_changes (sync_log_id, user_id, workspace_id, workspace_name, change_type, changes) VALUES (?, ?, ?, ?, ?, ?)'
);

/** Compare old and new workspace, return a changes summary object */
function diffWorkspace(existing, ws) {
  const changes = {};
  if (existing.name !== ws.name) changes.name = [existing.name, ws.name];
  if (existing.color !== ws.color) changes.color = [existing.color, ws.color];
  if (existing.saved_at !== ws.savedAt) changes.savedAt = [existing.saved_at, ws.savedAt];

  // --- Tabs: by URL ---
  const oldTabs = safeJsonParse(existing.tabs);
  const newTabs = ws.tabs || [];
  if (oldTabs.length !== newTabs.length) changes.tabCount = [oldTabs.length, newTabs.length];
  const oldTabMap = new Map(oldTabs.map(t => [t.url, t]));
  const tabsAdded = [];
  const tabsModified = [];
  for (const t of newTabs) {
    const old = oldTabMap.get(t.url);
    if (!old) {
      tabsAdded.push({ url: t.url, title: t.title });
    } else {
      if (old.title !== t.title) tabsModified.push({ url: t.url, title: `${old.title} → ${t.title}` });
      oldTabMap.delete(t.url);
    }
  }
  const tabsRemoved = [...oldTabMap.values()].map(t => ({ url: t.url, title: t.title }));
  if (tabsAdded.length) changes.tabsAdded = tabsAdded.slice(0, 20);
  if (tabsRemoved.length) changes.tabsRemoved = tabsRemoved.slice(0, 20);
  if (tabsModified.length) changes.tabsModified = tabsModified.slice(0, 20);

  // --- Groups: by groupId ---
  const oldGroups = safeJsonParse(existing.groups);
  const newGroups = ws.groups || [];
  if (oldGroups.length !== newGroups.length) changes.groupCount = [oldGroups.length, newGroups.length];
  const oldGroupMap = new Map(oldGroups.map(g => [g.groupId, g]));
  const groupsAdded = [];
  const groupsModified = [];
  for (const g of newGroups) {
    const old = oldGroupMap.get(g.groupId);
    if (!old) {
      groupsAdded.push(g.title || g.groupId);
    } else {
      const diffs = [];
      if (old.title !== g.title) diffs.push(`${old.title} → ${g.title}`);
      if (old.color !== g.color) diffs.push(`${old.color} → ${g.color}`);
      if (old.collapsed !== g.collapsed) diffs.push(g.collapsed ? 'collapsed' : 'expanded');
      if (diffs.length) groupsModified.push({ name: g.title || g.groupId, diffs });
      oldGroupMap.delete(g.groupId);
    }
  }
  const groupsRemoved = [...oldGroupMap.values()].map(g => g.title || g.groupId);
  if (groupsAdded.length) changes.groupsAdded = groupsAdded;
  if (groupsRemoved.length) changes.groupsRemoved = groupsRemoved;
  if (groupsModified.length) changes.groupsModified = groupsModified;

  // --- Flows: by id ---
  const oldFlows = safeJsonParse(existing.flows || '[]');
  const newFlows = ws.flows || [];
  if (oldFlows.length !== newFlows.length) changes.flowCount = [oldFlows.length, newFlows.length];
  const oldFlowMap = new Map(oldFlows.map(f => [f.id, f]));
  const flowsAdded = [];
  const flowsModified = [];
  for (const f of newFlows) {
    const old = oldFlowMap.get(f.id);
    if (!old) {
      flowsAdded.push(f.name || f.id);
    } else {
      const diffs = [];
      if (old.name !== f.name) diffs.push(`${old.name} → ${f.name}`);
      const oldBlockCount = (old.blocks || []).length;
      const newBlockCount = (f.blocks || []).length;
      if (oldBlockCount !== newBlockCount) diffs.push(`blocks: ${oldBlockCount} → ${newBlockCount}`);
      else if (JSON.stringify(old.blocks) !== JSON.stringify(f.blocks)) diffs.push('blocks changed');
      if (old.autoRun !== f.autoRun) diffs.push(f.autoRun ? 'auto-run on' : 'auto-run off');
      if (diffs.length) flowsModified.push({ name: f.name || f.id, diffs });
      oldFlowMap.delete(f.id);
    }
  }
  const flowsRemoved = [...oldFlowMap.values()].map(f => f.name || f.id);
  if (flowsAdded.length) changes.flowsAdded = flowsAdded;
  if (flowsRemoved.length) changes.flowsRemoved = flowsRemoved;
  if (flowsModified.length) changes.flowsModified = flowsModified;

  // --- Notes: by id ---
  const oldNotes = safeJsonParse(existing.notes || '[]');
  const newNotes = ws.notes || [];
  if (oldNotes.length !== newNotes.length) changes.noteCount = [oldNotes.length, newNotes.length];
  const oldNoteMap = new Map(oldNotes.map(n => [n.id, n]));
  const notesAdded = [];
  const notesModified = [];
  for (const n of newNotes) {
    const old = oldNoteMap.get(n.id);
    if (!old) {
      notesAdded.push(n.content ? n.content.substring(0, 60) : n.id);
    } else if (old.content !== n.content || old.updatedAt !== n.updatedAt) {
      notesModified.push(n.content ? n.content.substring(0, 60) : n.id);
    }
    oldNoteMap.delete(n.id);
  }
  const notesRemoved = [...oldNoteMap.values()].map(n => n.content ? n.content.substring(0, 60) : n.id);
  if (notesAdded.length) changes.notesAdded = notesAdded;
  if (notesModified.length) changes.notesModified = notesModified;
  if (notesRemoved.length) changes.notesRemoved = notesRemoved;

  return changes;
}

// GET /api/workspaces
router.get('/workspaces', (req, res) => {
  const rows = listWorkspaces.all(req.userId);
  res.json({
    workspaces: rows.map(r => {
      const groups = safeJsonParse(r.groups);
      const flows = safeJsonParse(r.flows || '[]');
      return {
        id: r.id,
        name: r.name,
        color: r.color,
        savedAt: utc(r.saved_at),
        updatedAt: utc(r.updated_at),
        lastSyncedBy: r.last_synced_by || null,
        tabCount: safeJsonParse(r.tabs).length,
        groupCount: groups.length,
        flowCount: flows.length,
        groupSummary: groups.slice(0, 4).map(g => ({ title: g.title, color: g.color })),
        hasNotes: safeJsonParse(r.notes, []).length > 0
      };
    })
  });
});

// GET /api/workspaces/:id
router.get('/workspaces/:id', (req, res) => {
  const row = getWorkspace.get(req.params.id, req.userId);
  if (!row) {
    return res.status(404).json({ error: 'Workspace not found' });
  }
  res.json({
    id: row.id,
    name: row.name,
    color: row.color,
    savedAt: utc(row.saved_at),
    updatedAt: utc(row.updated_at),
    lastSyncedBy: row.last_synced_by || null,
    groups: safeJsonParse(row.groups),
    tabs: safeJsonParse(row.tabs),
    flows: safeJsonParse(row.flows || '[]'),
    notes: safeJsonParse(row.notes, [])
  });
});

// POST /api/workspaces
router.post('/workspaces', (req, res) => {
  const { id, name, color, savedAt, groups, tabs, flows, notes } = req.body;

  if (!id || !name || !color || !savedAt) {
    return res.status(400).json({ error: 'id, name, color, and savedAt are required' });
  }
  if (!isValidId(id)) {
    return res.status(400).json({ error: 'Invalid workspace ID format' });
  }
  const wsNotes = JSON.stringify(notes || []);

  try {
    insertWorkspace.run(
      id, req.userId, name, color, savedAt,
      JSON.stringify(groups || []),
      JSON.stringify(tabs || []),
      JSON.stringify(flows || []),
      wsNotes
    );
    res.status(201).json({
      id, name, color, savedAt,
      groups: groups || [],
      tabs: tabs || [],
      flows: flows || [],
      notes: notes || []
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return res.status(409).json({ error: 'Workspace ID already exists' });
    }
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

// PUT /api/workspaces/:id
router.put('/workspaces/:id', (req, res) => {
  const { name, color, savedAt, groups, tabs, flows, notes } = req.body;

  if (!name || !color || !savedAt) {
    return res.status(400).json({ error: 'name, color, and savedAt are required' });
  }

  const result = updateWorkspace.run(
    name, color, savedAt,
    JSON.stringify(groups || []),
    JSON.stringify(tabs || []),
    JSON.stringify(flows || []),
    JSON.stringify(notes || []),
    req.params.id, req.userId
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  const row = getWorkspace.get(req.params.id, req.userId);
  res.json({
    id: row.id,
    name: row.name,
    color: row.color,
    savedAt: utc(row.saved_at),
    updatedAt: utc(row.updated_at),
    groups: safeJsonParse(row.groups),
    tabs: safeJsonParse(row.tabs),
    flows: safeJsonParse(row.flows || '[]'),
    notes: safeJsonParse(row.notes, [])
  });
});

// DELETE /api/workspaces/:id
router.delete('/workspaces/:id', (req, res) => {
  const result = deleteWorkspace.run(req.params.id, req.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Workspace not found' });
  }
  recordDeletion.run(req.params.id, req.userId);
  res.json({ message: 'Workspace deleted' });
});

// --- Sync routes ---
router.use('/sync', requireAuth);

// POST /api/sync/pull
router.post('/sync/pull', (req, res) => {
  const { lastSyncAt, clientId } = req.body;
  const since = lastSyncAt || '1970-01-01T00:00:00.000Z';

  const rows = getWorkspacesSince.all(req.userId, since);
  const workspaces = rows.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    savedAt: utc(r.saved_at),
    lastSyncedBy: r.last_synced_by || null,
    groups: safeJsonParse(r.groups),
    tabs: safeJsonParse(r.tabs),
    flows: safeJsonParse(r.flows || '[]'),
    notes: safeJsonParse(r.notes, [])
  }));

  const deletedRows = getDeletedSince.all(req.userId, since);
  const deleted = deletedRows.map(r => r.id);

  // Log this pull event (only when there are actual changes)
  if (clientId && (workspaces.length > 0 || deleted.length > 0)) {
    const wsIds = [...workspaces.map(w => w.id), ...deleted];
    insertSyncLog.run(req.userId, clientId, 'pull', workspaces.length + deleted.length, JSON.stringify(wsIds));
  }

  res.json({
    workspaces,
    deleted,
    serverTime: new Date().toISOString()
  });
});

// POST /api/sync/push
router.post('/sync/push', (req, res) => {
  const { upsert = [], delete: toDelete = [], clientId } = req.body;

  if (!Array.isArray(upsert) || !Array.isArray(toDelete)) {
    return res.status(400).json({ error: 'upsert and delete must be arrays' });
  }
  if (upsert.length > MAX_SYNC_UPSERT) {
    return res.status(400).json({ error: `upsert array too large (max ${MAX_SYNC_UPSERT})` });
  }
  if (toDelete.length > MAX_SYNC_DELETE) {
    return res.status(400).json({ error: `delete array too large (max ${MAX_SYNC_DELETE})` });
  }

  const conflicts = [];
  const changeRecords = []; // collect change details to insert after transaction

  const pushTransaction = db.transaction(() => {
    // Process upserts
    for (const ws of upsert) {
      if (!ws.id || !ws.name || !ws.color || !ws.savedAt) continue;
      if (!isValidId(ws.id)) continue;

      // Check for conflict: if server version is newer, report it
      const existing = getWorkspace.get(ws.id, req.userId);
      if (existing && existing.saved_at > ws.savedAt) {
        conflicts.push({
          id: ws.id,
          serverVersion: {
            id: existing.id,
            name: existing.name,
            color: existing.color,
            savedAt: utc(existing.saved_at),
            groups: safeJsonParse(existing.groups),
            tabs: safeJsonParse(existing.tabs),
            flows: safeJsonParse(existing.flows || '[]'),
            notes: safeJsonParse(existing.notes, [])
          },
          resolution: 'server_wins'
        });
        continue;
      }

      // Record change details — always record if push happens
      if (existing) {
        const changes = diffWorkspace(existing, ws);
        changeRecords.push({ wsId: ws.id, wsName: ws.name, type: 'updated', changes });
      } else {
        const tabCount = (ws.tabs || []).length;
        changeRecords.push({ wsId: ws.id, wsName: ws.name, type: 'created', changes: { tabCount: [0, tabCount] } });
      }

      upsertWorkspace.run(
        ws.id, req.userId, ws.name, ws.color, ws.savedAt,
        JSON.stringify(ws.groups || []),
        JSON.stringify(ws.tabs || []),
        JSON.stringify(ws.flows || []),
        JSON.stringify(ws.notes || []),
        clientId || null
      );
    }

    // Process deletes
    for (const id of toDelete) {
      if (!isValidId(id)) continue;
      // Capture name before deletion
      const existing = getWorkspace.get(id, req.userId);
      const wsName = existing ? existing.name : id;
      changeRecords.push({ wsId: id, wsName, type: 'deleted', changes: {} });
      deleteWorkspace.run(id, req.userId);
      recordDeletion.run(id, req.userId);
    }
  });

  pushTransaction();

  // Log this push event and record detailed changes
  let syncLogId = null;
  if (clientId && (upsert.length > 0 || toDelete.length > 0)) {
    const wsIds = [...upsert.filter(w => w.id).map(w => w.id), ...toDelete];
    const result = insertSyncLog.run(req.userId, clientId, 'push', upsert.length + toDelete.length, JSON.stringify(wsIds));
    syncLogId = result.lastInsertRowid;
  }

  // Insert change records
  for (const rec of changeRecords) {
    insertSyncChange.run(
      syncLogId, req.userId, rec.wsId, rec.wsName, rec.type, JSON.stringify(rec.changes)
    );
  }

  res.json({
    conflicts,
    serverTime: new Date().toISOString()
  });
});

// GET /api/sync/logs — retrieve sync history
const getSyncLogs = db.prepare(
  'SELECT id, client_id, action, workspace_count, details, created_at FROM sync_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
);

router.get('/sync/logs', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = getSyncLogs.all(req.userId, limit);
  res.json({
    logs: rows.map(r => ({
      id: r.id,
      clientId: r.client_id,
      action: r.action,
      workspaceCount: r.workspace_count,
      workspaceIds: safeJsonParse(r.details),
      createdAt: utc(r.created_at)
    }))
  });
});

// GET /api/sync/changes — retrieve detailed change history
const getSyncChanges = db.prepare(
  'SELECT id, sync_log_id, workspace_id, workspace_name, change_type, changes, created_at FROM sync_changes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
);
const getSyncChangesByLog = db.prepare(
  'SELECT id, workspace_id, workspace_name, change_type, changes, created_at FROM sync_changes WHERE sync_log_id = ? AND user_id = ? ORDER BY id'
);

router.get('/sync/changes', requireAuth, (req, res) => {
  const logId = req.query.logId;
  if (logId) {
    const rows = getSyncChangesByLog.all(parseInt(logId), req.userId);
    return res.json({
      changes: rows.map(r => ({
        id: r.id,
        workspaceId: r.workspace_id,
        workspaceName: r.workspace_name,
        changeType: r.change_type,
        changes: safeJsonParse(r.changes, {}),
        createdAt: utc(r.created_at)
      }))
    });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = getSyncChanges.all(req.userId, limit);
  res.json({
    changes: rows.map(r => ({
      id: r.id,
      syncLogId: r.sync_log_id,
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
      changeType: r.change_type,
      changes: safeJsonParse(r.changes, {}),
      createdAt: utc(r.created_at)
    }))
  });
});

module.exports = router;
