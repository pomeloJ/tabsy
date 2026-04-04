const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// All /api/workspaces routes require auth
router.use('/workspaces', requireAuth);

// Prepared statements
const listWorkspaces = db.prepare(
  'SELECT id, name, color, saved_at, updated_at, groups, tabs, flows FROM workspaces WHERE user_id = ? ORDER BY saved_at DESC'
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
  INSERT INTO workspaces (id, user_id, name, color, saved_at, groups, tabs, flows, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    color = excluded.color,
    saved_at = excluded.saved_at,
    groups = excluded.groups,
    tabs = excluded.tabs,
    flows = excluded.flows,
    updated_at = datetime('now')
  WHERE excluded.saved_at >= workspaces.saved_at
`);

// GET /api/workspaces
router.get('/workspaces', (req, res) => {
  const rows = listWorkspaces.all(req.userId);
  res.json({
    workspaces: rows.map(r => {
      const groups = JSON.parse(r.groups);
      const flows = JSON.parse(r.flows || '[]');
      return {
        id: r.id,
        name: r.name,
        color: r.color,
        savedAt: r.saved_at,
        updatedAt: r.updated_at,
        tabCount: JSON.parse(r.tabs).length,
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
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
    groups: JSON.parse(row.groups),
    tabs: JSON.parse(row.tabs),
    flows: JSON.parse(row.flows || '[]')
  });
});

// POST /api/workspaces
router.post('/workspaces', (req, res) => {
  const { id, name, color, savedAt, groups, tabs, flows } = req.body;

  if (!id || !name || !color || !savedAt) {
    return res.status(400).json({ error: 'id, name, color, and savedAt are required' });
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
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
    groups: JSON.parse(row.groups),
    tabs: JSON.parse(row.tabs),
    flows: JSON.parse(row.flows || '[]')
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
  const { lastSyncAt } = req.body;
  const since = lastSyncAt || '1970-01-01T00:00:00.000Z';

  const rows = getWorkspacesSince.all(req.userId, since);
  const workspaces = rows.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    savedAt: r.saved_at,
    groups: JSON.parse(r.groups),
    tabs: JSON.parse(r.tabs),
    flows: JSON.parse(r.flows || '[]')
  }));

  const deletedRows = getDeletedSince.all(req.userId, since);
  const deleted = deletedRows.map(r => r.id);

  res.json({
    workspaces,
    deleted,
    serverTime: new Date().toISOString()
  });
});

// POST /api/sync/push
router.post('/sync/push', (req, res) => {
  const { upsert = [], delete: toDelete = [] } = req.body;
  const conflicts = [];

  const pushTransaction = db.transaction(() => {
    // Process upserts
    for (const ws of upsert) {
      if (!ws.id || !ws.name || !ws.color || !ws.savedAt) continue;

      // Check for conflict: if server version is newer, report it
      const existing = getWorkspace.get(ws.id, req.userId);
      if (existing && existing.saved_at > ws.savedAt) {
        conflicts.push({
          id: ws.id,
          serverVersion: {
            id: existing.id,
            name: existing.name,
            color: existing.color,
            savedAt: existing.saved_at,
            groups: JSON.parse(existing.groups),
            tabs: JSON.parse(existing.tabs),
            flows: JSON.parse(existing.flows || '[]')
          },
          resolution: 'server_wins'
        });
        continue;
      }

      upsertWorkspace.run(
        ws.id, req.userId, ws.name, ws.color, ws.savedAt,
        JSON.stringify(ws.groups || []),
        JSON.stringify(ws.tabs || []),
        JSON.stringify(ws.flows || [])
      );
    }

    // Process deletes
    for (const id of toDelete) {
      deleteWorkspace.run(id, req.userId);
      recordDeletion.run(id, req.userId);
    }
  });

  pushTransaction();

  res.json({
    conflicts,
    serverTime: new Date().toISOString()
  });
});

module.exports = router;
