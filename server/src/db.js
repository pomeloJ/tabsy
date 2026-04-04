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
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS deleted_workspaces (
    id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    deleted_at TEXT DEFAULT (datetime('now')),
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

module.exports = db;
