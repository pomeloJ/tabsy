const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Resolve DB_PATH relative to server/ root (parent of src/)
const dbPath = process.env.DB_PATH || './data/tabsy.db';
const resolvedPath = path.resolve(__dirname, '..', dbPath);

// Auto-create the directory if it doesn't exist
const dbDir = path.dirname(resolvedPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(resolvedPath);

// WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Foreign key enforcement (SQLite has them OFF by default)
db.pragma('foreign_keys = ON');

// Schema initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sync_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    groups TEXT NOT NULL DEFAULT '[]',
    tabs TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS deleted_workspaces (
    id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    deleted_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Add flows column if not present (migration-safe)
  -- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we handle this in JS below

  CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);
  CREATE INDEX IF NOT EXISTS idx_tokens_user ON sync_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_tokens_token ON sync_tokens(token);
  CREATE INDEX IF NOT EXISTS idx_deleted_ws_user ON deleted_workspaces(user_id);
`);

// Migration: add flows column if it doesn't exist
const wsColumns = db.prepare("PRAGMA table_info(workspaces)").all();
if (!wsColumns.find(c => c.name === 'flows')) {
  db.exec("ALTER TABLE workspaces ADD COLUMN flows TEXT NOT NULL DEFAULT '[]'");
}

// Migration: add role column if it doesn't exist
const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.find(c => c.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  // Promote the first user (lowest id) to admin
  db.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)");
}

// Migration: add last_synced_by column to workspaces
const wsColumns2 = db.prepare("PRAGMA table_info(workspaces)").all();
if (!wsColumns2.find(c => c.name === 'last_synced_by')) {
  db.exec("ALTER TABLE workspaces ADD COLUMN last_synced_by TEXT DEFAULT NULL");
}

// Migration: sync_logs table
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    action TEXT NOT NULL,
    workspace_count INTEGER NOT NULL DEFAULT 0,
    details TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sync_logs_user ON sync_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_client ON sync_logs(client_id);
`);

// Migration: backups table (per-user)
db.exec(`
  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'manual',
    filename TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    workspace_count INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_backups_user ON backups(user_id);
`);

// Migration: add user_id to backups if missing (upgrade from global to per-user)
const backupCols = db.prepare("PRAGMA table_info(backups)").all();
if (!backupCols.find(c => c.name === 'user_id')) {
  db.exec("ALTER TABLE backups ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE INDEX IF NOT EXISTS idx_backups_user ON backups(user_id)");
}

// Migration: backup_settings table (per-user)
// Check if old global backup_settings exists (key TEXT PRIMARY KEY without user_id)
const bsColumns = db.prepare("PRAGMA table_info(backup_settings)").all();
if (bsColumns.length > 0 && !bsColumns.find(c => c.name === 'user_id')) {
  // Old schema — drop and recreate with per-user schema
  db.exec("DROP TABLE backup_settings");
}
db.exec(`
  CREATE TABLE IF NOT EXISTS backup_settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Migration: add notes column to workspaces
const wsColumns3 = db.prepare("PRAGMA table_info(workspaces)").all();
if (!wsColumns3.find(c => c.name === 'notes')) {
  db.exec("ALTER TABLE workspaces ADD COLUMN notes TEXT NOT NULL DEFAULT '[]'");
}

// Migration: convert notes from plain text / embedded format to JSON array
{
  const rows = db.prepare("SELECT id, notes, groups, tabs FROM workspaces WHERE notes != '[]'").all();
  const updateStmt = db.prepare("UPDATE workspaces SET notes = ?, groups = ?, tabs = ? WHERE id = ?");
  for (const row of rows) {
    // Skip already-migrated rows
    if (row.notes && row.notes.trim().startsWith('[')) continue;

    const noteObjs = [];
    const now = new Date().toISOString();

    // Convert workspace-level plain text notes
    if (row.notes && row.notes.trim()) {
      noteObjs.push({
        id: `n-migrated-ws-${row.id}`,
        content: row.notes,
        links: [{ type: 'workspace' }],
        createdAt: now,
        updatedAt: now
      });
    }

    // Convert group-level notes
    let groups = [];
    try { groups = JSON.parse(row.groups || '[]'); } catch {}
    for (const g of groups) {
      if (g.notes) {
        noteObjs.push({
          id: `n-migrated-g-${g.groupId}`,
          content: g.notes,
          links: [{ type: 'group', groupId: g.groupId }],
          createdAt: now,
          updatedAt: now
        });
        delete g.notes;
      }
    }

    // Convert tab-level notes
    let tabs = [];
    try { tabs = JSON.parse(row.tabs || '[]'); } catch {}
    for (const t of tabs) {
      if (t.notes) {
        noteObjs.push({
          id: `n-migrated-t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          content: t.notes,
          links: [{ type: 'tab', url: t.url }],
          createdAt: now,
          updatedAt: now
        });
        delete t.notes;
      }
    }

    updateStmt.run(
      JSON.stringify(noteObjs.length > 0 ? noteObjs : []),
      JSON.stringify(groups),
      JSON.stringify(tabs),
      row.id
    );
  }
}

// Migration: convert datetime('now') format ("YYYY-MM-DD HH:MM:SS") to ISO 8601 ("YYYY-MM-DDTHH:MM:SS.SSSZ")
// so that string comparisons in pull queries work correctly
db.exec(`
  UPDATE workspaces SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z'
    WHERE updated_at LIKE '____-__-__ __:__:__' AND updated_at NOT LIKE '%T%';
  UPDATE deleted_workspaces SET deleted_at = REPLACE(deleted_at, ' ', 'T') || 'Z'
    WHERE deleted_at LIKE '____-__-__ __:__:__' AND deleted_at NOT LIKE '%T%';
`);

module.exports = db;
