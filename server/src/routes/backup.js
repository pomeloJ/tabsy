const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');
const backup = require('../services/backup');

const router = express.Router();

// All backup routes require auth
router.use(requireAuth);

// --- Per-user: own backup settings ---

// GET /api/backups/settings — get my backup settings
router.get('/settings', (req, res) => {
  res.json(backup.getSettings(req.userId));
});

// PUT /api/backups/settings — update my backup settings
router.put('/settings', (req, res) => {
  const { enabled, time, retentionDays } = req.body;
  const settings = backup.updateSettings(req.userId, { enabled, time, retentionDays });
  res.json(settings);
});

// --- Per-user: own backups ---

// GET /api/backups — list my backups
router.get('/', (req, res) => {
  const backups = backup.listBackups(req.userId);
  res.json({ backups });
});

// POST /api/backups — create manual backup for myself
router.post('/', (req, res) => {
  const { note } = req.body || {};
  const result = backup.createBackup(req.userId, 'manual', note || '');
  res.status(201).json(result);
});

// GET /api/backups/all — admin: list all users' backups
router.get('/all', requireAdmin, (req, res) => {
  const backups = backup.listAllBackups();
  res.json({ backups });
});

// GET /api/backups/:id/download — download a backup (own or admin any)
router.get('/:id/download', (req, res) => {
  const id = parseInt(req.params.id);
  const userId = req.userRole === 'admin' ? null : req.userId;
  const data = backup.getBackupData(id, userId);
  if (!data) {
    return res.status(404).json({ error: 'Backup not found' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="tabsy-backup.json"');
  res.send(data);
});

// POST /api/backups/:id/restore — restore from a backup (own or admin any)
router.post('/:id/restore', (req, res) => {
  const id = parseInt(req.params.id);
  const { mode } = req.body || {};
  const userId = req.userRole === 'admin' ? null : req.userId;
  const data = backup.getBackupData(id, userId);
  if (!data) {
    return res.status(404).json({ error: 'Backup not found' });
  }

  // Create a safety backup before restoring
  backup.createBackup(req.userId, 'manual', 'Auto-created before restore');

  const result = backup.restoreBackup(data, req.userId, mode || 'merge');
  res.json(result);
});

// DELETE /api/backups/:id — delete a backup (own or admin any)
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const userId = req.userRole === 'admin' ? null : req.userId;
  const ok = backup.deleteBackup(id, userId);
  if (!ok) {
    return res.status(404).json({ error: 'Backup not found' });
  }
  res.json({ message: 'Backup deleted' });
});

// POST /api/backups/cleanup — manually trigger cleanup for my backups
router.post('/cleanup', (req, res) => {
  const removed = backup.cleanupOldBackups(req.userId);
  res.json({ removed });
});

// --- All users: Export/Import ---

// POST /api/backups/export — export current user's workspaces
router.post('/export', (req, res) => {
  const db = require('../db');
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
  const data = backup.exportUserWorkspaces(req.userId, user?.username || 'unknown');
  res.json(data);
});

// POST /api/backups/import — import workspaces for current user
router.post('/import', (req, res) => {
  const { workspaces, mode } = req.body;

  if (!workspaces || !Array.isArray(workspaces) || workspaces.length === 0) {
    return res.status(400).json({ error: 'No workspaces provided' });
  }

  const result = backup.restoreBackup(
    { workspaces },
    req.userId,
    mode || 'merge'
  );
  res.json(result);
});

module.exports = router;
