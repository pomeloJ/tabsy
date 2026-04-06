# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tabsy is a browser workspace management system with three components:
- **Chrome Extension** (`extension/`) — Manifest V3, manages tab saving/restoring with "one window = one workspace" concept
- **Sync Server** (`server/`) — Express + SQLite (better-sqlite3), REST API for cross-device sync
- **Web UI** (`server/public/`) — Vanilla HTML/CSS/JS served as static files by the same Express process

Full specification is in SPEC.md — always consult it for data models, API contracts, and sync protocol details.

## Current Status

v1.2.0 active development. Core sync complete, plus: Flow automation system, i18n (en/zh-TW), role-based auth with setup wizard, admin user management, sidebar Web UI redesign, extension download page, side panel SPA refactor, independent notes system with many-to-many linking, per-note sync merge, sync change tracking with diff history, per-user encrypted backups, Cloudflare Access support, drag-and-drop tab reordering, and live sync.

## Git Branching

- `main` — stable releases
- `dev` — active development

## Project Structure

```
tabsy/
├── extension/               — Chrome/Edge extension (Manifest V3, no build step)
│   ├── manifest.json
│   ├── background.js        — service worker: badge updates, side panel open
│   ├── sidepanel.html / .js — SPA main UI: save/restore/list/sync/flows
│   ├── flow-editor.html/.js — Visual flow block editor (iOS Shortcuts-style)
│   ├── marker.html          — Workspace info page shown in restored windows
│   ├── lib/
│   │   ├── storage.js       — chrome.storage.local CRUD + pending deletions
│   │   ├── sync.js          — pull/push sync logic (LWW) + change tracking
│   │   ├── live-sync.js     — real-time sync: tab state reconciliation + ordering
│   │   ├── capture.js       — workspace capture with persistent tab IDs
│   │   ├── merge.js         — sync merge logic
│   │   ├── api-client.js    — server API wrapper with Bearer token
│   │   ├── i18n.js          — i18n module (en, zh-TW) for extension UI
│   │   ├── flow-schema.js   — 40+ flow block type definitions
│   │   ├── flow-runner.js   — Flow execution engine (state machine)
│   │   ├── flow-executor.js — DOM manipulation via chrome.scripting
│   │   └── safe-eval.js     — sandboxed expression evaluation for flows
│   └── icons/
│
├── server/                  — Node.js sync server + Web UI
│   ├── package.json
│   ├── .env                 — PORT, SESSION_SECRET, DB_PATH
│   ├── src/
│   │   ├── index.js         — entry point, Express + CORS + static files
│   │   ├── db.js            — SQLite connection + schema init + migrations
│   │   ├── routes/
│   │   │   ├── api.js       — /api/workspaces CRUD + /api/sync/push & pull + sync changes
│   │   │   ├── auth.js      — login, register, setup wizard, admin user management
│   │   │   ├── backup.js    — per-user encrypted backup/restore
│   │   │   └── extension.js — /api/extension/version & /api/extension/download
│   │   ├── services/
│   │   │   └── backup.js    — backup encryption + file management
│   │   └── middleware/
│   │       └── auth.js      — requireAuth (session + token) + requireAdmin
│   └── public/              — Web UI static files
│       ├── index.html       — sidebar layout + responsive bottomnav
│       ├── css/style.css
│       └── js/
│           ├── app.js       — hash router + auth state + setup check
│           ├── api.js       — fetch wrapper
│           ├── i18n.js      — i18n module (en, zh-TW) for Web UI
│           ├── sync-change-render.js — shared sync change card renderer
│           └── components/  — setup, login, register, dashboard,
│                              workspace, settings, download, sync-logs
│
├── CLAUDE.md
├── SPEC.md
└── README.md
```

## Commands

```bash
# Server development (includes Web UI)
cd server && npm run dev       # nodemon auto-restart

# Server production
cd server && node src/index.js

# Extension — no build step, load extension/ folder in edge://extensions/ or chrome://extensions/

# Extension packaging
cd extension && zip -r tabsy-extension.zip manifest.json background.js sidepanel.html sidepanel.js lib/ icons/
```

## Architecture

### Dual auth system with roles
The server supports two auth modes on every `/api/*` route:
1. **Bearer token** (`Authorization: Bearer tb_<hex>`) — used by the extension
2. **Session cookie** — used by the Web UI after username/password login

The auth middleware (`requireAuth`) checks token first, then falls back to session. Admin-only routes use `requireAdmin`. Sync tokens are created/managed through the Web UI settings page.

**Roles**: `user` | `admin`. The first registered user is auto-promoted to admin. Registration is only open during initial setup (no users exist); afterwards, admins create users via the settings page.

**Setup wizard**: On first launch, `GET /api/auth/setup-status` returns `needsSetup: true`, and the Web UI redirects to a setup page to create the initial admin account.

### Data flow
- Extension stores workspaces in `chrome.storage.local` and syncs to server via `/api/sync/push` and `/api/sync/pull`
- Workspace UUIDs are generated client-side (extension or Web UI), not by the server
- Sync uses Last-Write-Wins based on `savedAt` timestamps
- `groups`, `tabs`, and `notes` are stored as JSON text columns in SQLite (not normalized)

### Sync protocol
- **Pull**: POST `/api/sync/pull` with `lastSyncAt` → returns updated workspaces + deleted IDs + `serverTime`
- **Push**: POST `/api/sync/push` with `upsert[]` + `delete[]` → returns conflicts + `serverTime`
- Extension tracks `syncStatus` per workspace: `synced | local_only | pending | conflict`
- Extension tracks `pendingDeletions` in chrome.storage.local for deleted synced workspaces
- Server tracks deletions in `deleted_workspaces` table for pull reporting

### Web UI routing & layout
Hash-based routing (`#/login`, `#/workspace/:id`, `#/settings`, `#/sync-logs`, `#/download`) — no server-side routing needed. ES Modules loaded directly by the browser, no build tools. Sidebar layout (220px fixed left nav) with responsive mobile bottomnav.

### Extension marker mechanism
Restored workspaces get a collapsed tab group with a `marker.html` tab at the front. The marker URL is `chrome-extension://<id>/marker.html?name=...&color=...&tabs=...&savedAt=...` and displays workspace info. Detection uses `url.startsWith(chrome.runtime.getURL('marker.html'))`. This marker is auto-excluded when saving. Any code touching save/restore must preserve this behavior.

### Flow automation system
Visual block-based automation (iOS Shortcuts-style) attached to workspaces. Flows are stored in the `flows` JSON column of the `workspaces` table.

- **Block schema** (`flow-schema.js`): 40+ block types — click, fill, select, wait_element, loop, if/else, try/catch, etc.
- **Editor** (`flow-editor.html/.js`): Card-based drag-and-drop UI with variable inspector and execution timeline
- **Runtime** (`flow-runner.js`): State machine (IDLE → RUNNING → PAUSED/STOPPED/DONE/ERROR) with step-by-step execution
- **Executor** (`flow-executor.js`): Runs DOM actions in target tabs via `chrome.scripting` API
- **Auto-trigger**: Flows can auto-run when a workspace is restored

Side panel uses SPA navigation to switch between main view and flow editor without page reloads.

### Notes system
Independent notes with many-to-many linking to workspaces, groups, and tabs. Notes are stored as a JSON array in the workspace `notes` column. Each note has a unique ID, content, timestamps, and a `links[]` array referencing multiple entities. Sync uses per-note LWW merge based on `updatedAt`. Tabs are linked by persistent `tabId` (not URL), so notes survive tab navigation and recapture.

### Sync change tracking
Sync push tracks per-field changes (tabs, groups, flows, notes) in a `sync_changes` table with diff details. Web UI has a dedicated `#/sync-logs` page with action/date filters and expandable detail rows. Shared renderer in `sync-change-render.js`.

### Backup system
Per-user encrypted backup/restore via `server/src/services/backup.js` and `server/src/routes/backup.js`. Backups are encrypted and managed per user.

### Live sync
Extension supports real-time sync via `live-sync.js` — reconciles tab state, reorders tabs after sync, and tracks newly created tabs during loading.

### Cloudflare Access support
Optional Cloudflare Access Service Token headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) can be configured in extension settings for deployments behind Cloudflare Access.

### i18n
Both extension and Web UI have separate i18n modules supporting **English (en)** and **Traditional Chinese (zh-TW)**. Usage: `t('key', { params })`. Locale persisted in `localStorage` (Web UI) / `chrome.storage` (extension).

### Extension download page
Server route `GET /api/extension/download` streams the extension as a ZIP (using `archiver`). Web UI has a download component with version info and installation guide.

### Database tables
`users` (with `role` column), `sync_tokens`, `workspaces` (with `flows` and `notes` columns), `deleted_workspaces`, `sync_changes`, plus session store (auto-managed by express-session). Schema migrations run automatically on startup.

## Key Conventions

- All source is plain JavaScript (no TypeScript, no transpilation)
- Server env vars: `PORT`, `SESSION_SECRET`, `DB_PATH` (from `server/.env`)
- SQLite DB file at `server/data/tabsy.db` (auto-created on first run)
- 10-color system shared between extension and Web UI — hex values and Chrome tabGroups color names defined in SPEC.md
- Token format: `tb_` prefix + 32-char random hex
- API responses use camelCase JSON keys; SQLite columns use snake_case
- Server dependencies: express, better-sqlite3, bcrypt, express-session, better-sqlite3-session-store, dotenv, archiver; dev: nodemon
