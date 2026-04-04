const path = require('path');
const fs = require('fs');
const db = require('../db');

const BACKUP_DIR = path.resolve(__dirname, '../../data/backups');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Get per-user backup directory, auto-create if needed */
function userDir(userId) {
  const dir = path.join(BACKUP_DIR, `user-${userId}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// --- Per-user Settings ---

const DEFAULT_SETTINGS = { enabled: false, time: '03:00', retentionDays: 30 };

function getSettings(userId) {
  const rows = db.prepare(
    'SELECT key, value FROM backup_settings WHERE user_id = ?'
  ).all(userId);
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return {
    enabled: map.enabled === 'true',
    time: map.time || DEFAULT_SETTINGS.time,
    retentionDays: parseInt(map.retention_days) || DEFAULT_SETTINGS.retentionDays
  };
}

function updateSettings(userId, { enabled, time, retentionDays }) {
  const upsert = db.prepare(
    'INSERT INTO backup_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value'
  );
  const txn = db.transaction(() => {
    if (enabled !== undefined) upsert.run(userId, 'enabled', String(enabled));
    if (time !== undefined) upsert.run(userId, 'time', time);
    if (retentionDays !== undefined) upsert.run(userId, 'retention_days', String(retentionDays));
  });
  txn();
  return getSettings(userId);
}

// --- Create Backup (per-user) ---

function createBackup(userId, type = 'manual', note = '') {
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  const username = user?.username || 'unknown';

  // Gather this user's workspaces
  const workspaces = db.prepare(
    'SELECT id, name, color, saved_at, groups, tabs, flows, created_at, updated_at FROM workspaces WHERE user_id = ?'
  ).all(userId).map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    savedAt: r.saved_at,
    groups: safeJsonParse(r.groups),
    tabs: safeJsonParse(r.tabs),
    flows: safeJsonParse(r.flows || '[]'),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));

  const backupData = {
    version: 2,
    type: 'portable',
    createdAt: new Date().toISOString(),
    source: { username },
    workspaces
  };

  const jsonStr = JSON.stringify(backupData, null, 2);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.json`;
  const dir = userDir(userId);
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, jsonStr, 'utf8');
  const stat = fs.statSync(filePath);

  const result = db.prepare(
    'INSERT INTO backups (user_id, type, filename, size, workspace_count, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, type, filename, stat.size, workspaces.length, note);

  return {
    id: result.lastInsertRowid,
    userId,
    type,
    filename,
    size: stat.size,
    workspaceCount: workspaces.length,
    note,
    createdAt: new Date().toISOString()
  };
}

// --- List Backups ---

function listBackups(userId) {
  const rows = db.prepare(
    'SELECT id, user_id, type, filename, size, workspace_count, note, created_at FROM backups WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
  return rows.map(mapBackupRow);
}

function listAllBackups() {
  const rows = db.prepare(
    'SELECT b.id, b.user_id, b.type, b.filename, b.size, b.workspace_count, b.note, b.created_at, u.username FROM backups b LEFT JOIN users u ON b.user_id = u.id ORDER BY b.created_at DESC'
  ).all();
  return rows.map(r => ({ ...mapBackupRow(r), username: r.username || 'unknown' }));
}

function mapBackupRow(r) {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    filename: r.filename,
    size: r.size,
    workspaceCount: r.workspace_count,
    note: r.note,
    createdAt: r.created_at
  };
}

// --- Get Backup Data ---

function getBackupData(id, userId) {
  const query = userId != null
    ? db.prepare('SELECT user_id, filename FROM backups WHERE id = ? AND user_id = ?')
    : db.prepare('SELECT user_id, filename FROM backups WHERE id = ?');
  const row = userId != null ? query.get(id, userId) : query.get(id);
  if (!row) return null;

  const filePath = path.join(userDir(row.user_id), row.filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

// --- Delete Backup ---

function deleteBackup(id, userId) {
  const query = userId != null
    ? db.prepare('SELECT user_id, filename FROM backups WHERE id = ? AND user_id = ?')
    : db.prepare('SELECT user_id, filename FROM backups WHERE id = ?');
  const row = userId != null ? query.get(id, userId) : query.get(id);
  if (!row) return false;

  const filePath = path.join(userDir(row.user_id), row.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM backups WHERE id = ?').run(id);
  return true;
}

// --- Restore Backup ---

function restoreBackup(backupJson, userId, mode = 'merge') {
  let data;
  if (typeof backupJson === 'string') {
    data = JSON.parse(backupJson);
  } else {
    data = backupJson;
  }

  const workspaces = data.workspaces || [];
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return { imported: 0, skipped: 0 };
  }

  const getWs = db.prepare('SELECT id FROM workspaces WHERE id = ? AND user_id = ?');
  const upsertWs = db.prepare(`
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
  `);
  const insertWs = db.prepare(
    'INSERT INTO workspaces (id, user_id, name, color, saved_at, groups, tabs, flows) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  let imported = 0;
  let skipped = 0;

  const txn = db.transaction(() => {
    for (const ws of workspaces) {
      if (!ws.id || !ws.name || !ws.color) { skipped++; continue; }

      const existing = getWs.get(ws.id, userId);
      const savedAt = ws.savedAt || ws.saved_at || new Date().toISOString();
      const groups = JSON.stringify(ws.groups || []);
      const tabs = JSON.stringify(ws.tabs || []);
      const flows = JSON.stringify(ws.flows || []);

      if (mode === 'overwrite') {
        upsertWs.run(ws.id, userId, ws.name, ws.color, savedAt, groups, tabs, flows);
        imported++;
      } else if (mode === 'duplicate') {
        if (existing) {
          const newId = require('crypto').randomUUID();
          insertWs.run(newId, userId, ws.name, ws.color, savedAt, groups, tabs, flows);
        } else {
          insertWs.run(ws.id, userId, ws.name, ws.color, savedAt, groups, tabs, flows);
        }
        imported++;
      } else {
        // merge: skip existing
        if (existing) { skipped++; continue; }
        try {
          insertWs.run(ws.id, userId, ws.name, ws.color, savedAt, groups, tabs, flows);
          imported++;
        } catch {
          skipped++;
        }
      }
    }
  });
  txn();

  return { imported, skipped };
}

// --- Cleanup old auto-backups for a user ---

function cleanupOldBackups(userId) {
  const settings = getSettings(userId);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - settings.retentionDays);
  const cutoffStr = cutoff.toISOString();

  const old = db.prepare(
    "SELECT id, filename FROM backups WHERE user_id = ? AND type = 'auto' AND created_at < ?"
  ).all(userId, cutoffStr);

  const dir = userDir(userId);
  for (const row of old) {
    const filePath = path.join(dir, row.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    db.prepare('DELETE FROM backups WHERE id = ?').run(row.id);
  }

  return old.length;
}

// --- Export workspaces for a specific user (portable format) ---

function exportUserWorkspaces(userId, username) {
  const rows = db.prepare(
    'SELECT id, name, color, saved_at, groups, tabs, flows FROM workspaces WHERE user_id = ?'
  ).all(userId);

  return {
    version: 2,
    type: 'portable',
    createdAt: new Date().toISOString(),
    source: { username },
    workspaces: rows.map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      savedAt: r.saved_at,
      groups: safeJsonParse(r.groups),
      tabs: safeJsonParse(r.tabs),
      flows: safeJsonParse(r.flows || '[]')
    }))
  };
}

// --- Scheduler (per-user) ---

let _schedulerInterval = null;

function startScheduler() {
  stopScheduler();

  // Check every minute
  _schedulerInterval = setInterval(() => {
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const today = now.toISOString().slice(0, 10);

    // Get all users who have backup enabled
    const users = db.prepare('SELECT id FROM users').all();

    for (const user of users) {
      const settings = getSettings(user.id);
      if (!settings.enabled) continue;
      if (hhmm !== settings.time) continue;

      // Check if already backed up today for this user
      const existing = db.prepare(
        "SELECT id FROM backups WHERE user_id = ? AND type = 'auto' AND created_at LIKE ? LIMIT 1"
      ).get(user.id, today + '%');

      if (!existing) {
        console.log(`[Backup] Auto backup for user ${user.id} at ${hhmm}`);
        createBackup(user.id, 'auto', 'Scheduled daily backup');
        cleanupOldBackups(user.id);
      }
    }
  }, 60 * 1000);
}

function stopScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
  }
}

function safeJsonParse(str, fallback = []) {
  try { return JSON.parse(str); }
  catch { return fallback; }
}

module.exports = {
  getSettings,
  updateSettings,
  createBackup,
  listBackups,
  listAllBackups,
  getBackupData,
  deleteBackup,
  restoreBackup,
  cleanupOldBackups,
  exportUserWorkspaces,
  startScheduler,
  stopScheduler
};
