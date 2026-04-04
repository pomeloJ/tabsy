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
  'SELECT id, name, color, saved_at, updated_at, last_synced_by, groups, tabs, flows FROM workspaces WHERE user_id = ? ORDER BY saved_at DESC'
);
const getWorkspace = db.prepare(
  'SELECT * FROM workspaces WHERE id = ? AND user_id = ?'
);
const insertWorkspace = db.prepare(
  'INSERT INTO workspaces (id, user_id, name, color, saved_at, groups, tabs, flows) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const updateWorkspace = db.prepare(
  'UPDATE workspaces SET name = ?, color = ?, saved_at = ?, groups = ?, tabs = ?, flows = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?'
);
const deleteWorkspace = db.prepare(
  'DELETE FROM workspaces WHERE id = ? AND user_id = ?'
);
const recordDeletion = db.prepare(
  'INSERT OR REPLACE INTO deleted_workspaces (id, user_id, deleted_at) VALUES (?, ?, datetime(\'now\'))'
);

// Sync prepared statements
const getWorkspacesSince = db.prepare(
  'SELECT * FROM workspaces WHERE user_id = ? AND updated_at > ?'
);
const getDeletedSince = db.prepare(
  'SELECT id FROM deleted_workspaces WHERE user_id = ? AND deleted_at > ?'
);
const upsertWorkspace = db.prepare(`
  INSERT INTO workspaces (id, user_id, name, color, saved_at, groups, tabs, flows, updated_at, last_synced_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    color = excluded.color,
    saved_at = excluded.saved_at,
    groups = excluded.groups,
    tabs = excluded.tabs,
    flows = excluded.flows,
    updated_at = datetime('now'),
    last_synced_by = excluded.last_synced_by
  WHERE excluded.saved_at >= workspaces.saved_at
`);
const insertSyncLog = db.prepare(
  'INSERT INTO sync_logs (user_id, client_id, action, workspace_count, details) VALUES (?, ?, ?, ?, ?)'
);

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
        groupSummary: groups.slice(0, 4).map(g => ({ title: g.title, color: g.color }))
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
    flows: safeJsonParse(row.flows || '[]')
  });
});

// POST /api/workspaces
router.post('/workspaces', (req, res) => {
  const { id, name, color, savedAt, groups, tabs, flows } = req.body;

  if (!id || !name || !color || !savedAt) {
    return res.status(400).json({ error: 'id, name, color, and savedAt are required' });
  }
  if (!isValidId(id)) {
    return res.status(400).json({ error: 'Invalid workspace ID format' });
  }

  try {
    insertWorkspace.run(
      id, req.userId, name, color, savedAt,
      JSON.stringify(groups || []),
      JSON.stringify(tabs || []),
      JSON.stringify(flows || [])
    );
    res.status(201).json({
      id, name, color, savedAt,
      groups: groups || [],
      tabs: tabs || [],
      flows: flows || []
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
  const { name, color, savedAt, groups, tabs, flows } = req.body;

  if (!name || !color || !savedAt) {
    return res.status(400).json({ error: 'name, color, and savedAt are required' });
  }

  const result = updateWorkspace.run(
    name, color, savedAt,
    JSON.stringify(groups || []),
    JSON.stringify(tabs || []),
    JSON.stringify(flows || []),
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
    flows: safeJsonParse(row.flows || '[]')
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
    flows: safeJsonParse(r.flows || '[]')
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
            flows: safeJsonParse(existing.flows || '[]')
          },
          resolution: 'server_wins'
        });
        continue;
      }

      upsertWorkspace.run(
        ws.id, req.userId, ws.name, ws.color, ws.savedAt,
        JSON.stringify(ws.groups || []),
        JSON.stringify(ws.tabs || []),
        JSON.stringify(ws.flows || []),
        clientId || null
      );
    }

    // Process deletes
    for (const id of toDelete) {
      if (!isValidId(id)) continue;
      deleteWorkspace.run(id, req.userId);
      recordDeletion.run(id, req.userId);
    }
  });

  pushTransaction();

  // Log this push event (only when there are actual changes)
  if (clientId && (upsert.length > 0 || toDelete.length > 0)) {
    const wsIds = [...upsert.filter(w => w.id).map(w => w.id), ...toDelete];
    insertSyncLog.run(req.userId, clientId, 'push', upsert.length + toDelete.length, JSON.stringify(wsIds));
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

module.exports = router;
