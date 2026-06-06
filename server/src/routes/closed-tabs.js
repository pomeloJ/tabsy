const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const { isValidId, safeJsonParse } = require('../util');

const router = express.Router();

// --- Config ---
const RETENTION_DAYS = 7;
const MAX_EVENTS = 200;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 512;

function isRecordableUrl(url) {
  if (typeof url !== 'string' || !url || url.length > MAX_URL_LENGTH) return false;
  // Only http(s) — skip chrome://, about:, extension pages, blank tabs
  return /^https?:\/\//i.test(url);
}

function retentionCutoff() {
  return new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// --- Prepared statements ---
const insertClosedTab = db.prepare(
  // OR IGNORE: a retried upload (same event re-sent after a dropped response)
  // is a no-op thanks to the unique index, so no duplicate rows accumulate.
  'INSERT OR IGNORE INTO closed_tabs (user_id, workspace_id, url, title, closed_at) VALUES (?, ?, ?, ?, ?)'
);
const pruneOld = db.prepare('DELETE FROM closed_tabs WHERE user_id = ? AND closed_at < ?');
const listForWorkspace = db.prepare(
  'SELECT id, url, title, closed_at FROM closed_tabs WHERE user_id = ? AND workspace_id = ? AND closed_at >= ? ORDER BY closed_at DESC'
);
const deleteByUrl = db.prepare(
  'DELETE FROM closed_tabs WHERE user_id = ? AND workspace_id = ? AND url = ?'
);
const getWorkspaceRow = db.prepare('SELECT * FROM workspaces WHERE id = ? AND user_id = ?');
const updateWorkspaceTabs = db.prepare(
  "UPDATE workspaces SET tabs = ?, saved_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?"
);

router.use(requireAuth);

// POST /api/closed-tabs — ingest closed-tab events from the extension
router.post('/', (req, res) => {
  const { events } = req.body;
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'events must be an array' });
  }
  if (events.length > MAX_EVENTS) {
    return res.status(400).json({ error: `events array too large (max ${MAX_EVENTS})` });
  }

  const nowIso = new Date().toISOString();
  let inserted = 0;

  const tx = db.transaction(() => {
    for (const ev of events) {
      if (!ev || !isValidId(ev.workspaceId) || !isRecordableUrl(ev.url)) continue;
      const title = typeof ev.title === 'string' ? ev.title.slice(0, MAX_TITLE_LENGTH) : '';
      let closedAt = typeof ev.closedAt === 'string' && ev.closedAt ? ev.closedAt : nowIso;
      if (closedAt.length > 40) closedAt = nowIso; // guard against junk
      const r = insertClosedTab.run(req.userId, ev.workspaceId, ev.url, title, closedAt);
      inserted += r.changes; // 0 when a duplicate was ignored
    }
    // Opportunistic retention cleanup
    pruneOld.run(req.userId, retentionCutoff());
  });
  tx();

  res.json({ inserted });
});

// GET /api/closed-tabs?workspaceId=... — list recent closed tabs (7 days),
// excluding URLs still present in the workspace, deduped by URL (latest wins)
router.get('/', (req, res) => {
  const workspaceId = req.query.workspaceId;
  if (!isValidId(workspaceId)) {
    return res.status(400).json({ error: 'Invalid workspaceId' });
  }

  const ws = getWorkspaceRow.get(workspaceId, req.userId);
  if (!ws) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  const openUrls = new Set(safeJsonParse(ws.tabs).map(t => t.url));
  const rows = listForWorkspace.all(req.userId, workspaceId, retentionCutoff());

  const seen = new Set();
  const closedTabs = [];
  for (const r of rows) {
    if (openUrls.has(r.url)) continue;   // still on the tab bar — don't show
    if (seen.has(r.url)) continue;       // dedupe, keep most recent (rows already DESC)
    seen.add(r.url);
    closedTabs.push({ id: r.id, url: r.url, title: r.title, closedAt: r.closed_at });
  }

  res.json({ closedTabs });
});

// POST /api/closed-tabs/recover — add a closed tab back into the workspace (ungrouped)
router.post('/recover', (req, res) => {
  const { workspaceId, url, title } = req.body;
  if (!isValidId(workspaceId)) {
    return res.status(400).json({ error: 'Invalid workspaceId' });
  }
  if (!isRecordableUrl(url)) {
    return res.status(400).json({ error: 'Invalid url' });
  }

  const ws = getWorkspaceRow.get(workspaceId, req.userId);
  if (!ws) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  const tabs = safeJsonParse(ws.tabs);
  const newTab = {
    id: 't-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    url,
    title: (typeof title === 'string' ? title.slice(0, MAX_TITLE_LENGTH) : '') || url,
    pinned: false,
    groupId: null,
    index: tabs.length
  };

  // Avoid duplicating a tab that is already open
  const already = tabs.find(t => t.url === url);
  const savedAt = new Date().toISOString();

  const tx = db.transaction(() => {
    if (!already) {
      tabs.push(newTab);
      updateWorkspaceTabs.run(JSON.stringify(tabs), savedAt, workspaceId, req.userId);
    }
    // Remove all history rows for this URL so it leaves the closed list
    deleteByUrl.run(req.userId, workspaceId, url);
  });
  tx();

  res.json({ tab: already || newTab, savedAt });
});

// POST /api/closed-tabs/dismiss — remove a URL from the closed list without recovering
router.post('/dismiss', (req, res) => {
  const { workspaceId, url } = req.body;
  if (!isValidId(workspaceId) || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid workspaceId or url' });
  }
  const result = deleteByUrl.run(req.userId, workspaceId, url);
  res.json({ removed: result.changes });
});

module.exports = router;
