# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tabsy is a browser workspace management system with three components:
- **Chrome Extension** (`extension/`) — Manifest V3, manages tab saving/restoring with "one window = one workspace" concept
- **Sync Server** (`server/`) — Express + SQLite (better-sqlite3), REST API for cross-device sync
- **Web UI** (`server/public/`) — Vanilla HTML/CSS/JS served as static files by the same Express process

Full specification is in SPEC.md — always consult it for data models, API contracts, and sync protocol details.

## Current Status

v1.0.0 complete. All 11 milestones done — server, Web UI, and extension with full sync functionality.

## Git Branching

- `main` — stable releases
- `dev` — active development

## Project Structure

```
tabsy/
├── extension/               — Chrome/Edge extension (Manifest V3, no build step)
│   ├── manifest.json
│   ├── background.js        — service worker: badge updates, side panel open
│   ├── sidepanel.html / .js — main UI: save/restore/list/sync
│   ├── lib/
│   │   ├── storage.js       — chrome.storage.local CRUD + pending deletions
│   │   ├── sync.js          — pull/push sync logic (LWW)
│   │   └── api-client.js    — server API wrapper with Bearer token
│   └── icons/
│
├── server/                  — Node.js sync server + Web UI
│   ├── package.json
│   ├── .env                 — PORT, SESSION_SECRET, DB_PATH
│   ├── src/
│   │   ├── index.js         — entry point, Express + CORS + static files
│   │   ├── db.js            — SQLite connection + schema init (5 tables)
│   │   ├── routes/
│   │   │   ├── api.js       — /api/workspaces CRUD + /api/sync/push & /api/sync/pull
│   │   │   └── auth.js      — login, register, token management
│   │   └── middleware/
│   │       └── auth.js      — auth middleware (session + token dual mode)
│   └── public/              — Web UI static files
│       ├── index.html
│       ├── css/style.css
│       └── js/
│           ├── app.js       — hash router + auth state
│           ├── api.js       — fetch wrapper
│           └── components/  — login, register, dashboard, settings
│
├── CLAUDE.md
└── SPEC.md
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

### Dual auth system
The server supports two auth modes on every `/api/*` route:
1. **Bearer token** (`Authorization: Bearer tb_<hex>`) — used by the extension
2. **Session cookie** — used by the Web UI after username/password login

The auth middleware checks token first, then falls back to session. Sync tokens are created/managed through the Web UI settings page.

### Data flow
- Extension stores workspaces in `chrome.storage.local` and syncs to server via `/api/sync/push` and `/api/sync/pull`
- Workspace UUIDs are generated client-side (extension or Web UI), not by the server
- Sync uses Last-Write-Wins based on `savedAt` timestamps
- `groups` and `tabs` are stored as JSON text columns in SQLite (not normalized)

### Sync protocol
- **Pull**: POST `/api/sync/pull` with `lastSyncAt` → returns updated workspaces + deleted IDs + `serverTime`
- **Push**: POST `/api/sync/push` with `upsert[]` + `delete[]` → returns conflicts + `serverTime`
- Extension tracks `syncStatus` per workspace: `synced | local_only | pending | conflict`
- Extension tracks `pendingDeletions` in chrome.storage.local for deleted synced workspaces
- Server tracks deletions in `deleted_workspaces` table for pull reporting

### Web UI routing
Hash-based routing (`#/login`, `#/workspace/:id`) — no server-side routing needed. ES Modules loaded directly by the browser, no build tools.

### Extension marker mechanism
Restored workspaces get a collapsed tab group with a `marker.html` tab at the front. The marker URL is `chrome-extension://<id>/marker.html?name=...&color=...&tabs=...&savedAt=...` and displays workspace info. Detection uses `url.startsWith(chrome.runtime.getURL('marker.html'))`. This marker is auto-excluded when saving. Any code touching save/restore must preserve this behavior.

### Database tables
`users`, `sync_tokens`, `workspaces`, `deleted_workspaces`, plus session store (auto-managed by express-session)

## Key Conventions

- All source is plain JavaScript (no TypeScript, no transpilation)
- Server env vars: `PORT`, `SESSION_SECRET`, `DB_PATH` (from `server/.env`)
- SQLite DB file at `server/data/tabsy.db` (auto-created on first run)
- 10-color system shared between extension and Web UI — hex values and Chrome tabGroups color names defined in SPEC.md
- Token format: `tb_` prefix + 32-char random hex
- API responses use camelCase JSON keys; SQLite columns use snake_case
- Server dependencies: express, better-sqlite3, bcrypt, express-session, better-sqlite3-session-store, dotenv; dev: nodemon
