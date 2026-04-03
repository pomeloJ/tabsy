# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tabsy is a browser workspace management system with three components:
- **Chrome Extension** (`extension/`) — Manifest V3, manages tab saving/restoring with "one window = one workspace" concept
- **Sync Server** (`server/`) — Express + SQLite (better-sqlite3), REST API for cross-device sync
- **Web UI** (`server/public/`) — Vanilla HTML/CSS/JS served as static files by the same Express process

Full specification is in SPEC.md — always consult it for data models, API contracts, and sync protocol details.

## Current Status

Building v1.0.0 (sync foundation). Project directories created, implementation starting from scratch.

## Project Structure

```
tabsy/
├── extension/               — Chrome/Edge extension (Manifest V3, no build step)
│   ├── manifest.json
│   ├── background.js
│   ├── sidepanel.html / .js
│   ├── popup.html / .js     (reserved)
│   ├── lib/
│   │   ├── storage.js       — storage abstraction (local + remote)
│   │   ├── sync.js          — sync logic
│   │   └── api-client.js    — server API wrapper
│   └── icons/
│
├── server/                  — Node.js sync server + Web UI
│   ├── package.json
│   ├── .env                 — PORT, SESSION_SECRET, DB_PATH
│   ├── src/
│   │   ├── index.js         — entry point, Express + static files
│   │   ├── db.js            — SQLite connection + schema init
│   │   ├── routes/
│   │   │   ├── api.js       — /api/workspaces CRUD
│   │   │   └── auth.js      — login, register, token management
│   │   └── middleware/
│   │       └── auth.js      — auth middleware (session + token dual mode)
│   └── public/              — Web UI static files
│       ├── index.html
│       ├── css/style.css
│       └── js/
│           ├── app.js
│           ├── api.js
│           └── components/
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
cd extension && zip -r tabsy-extension.zip manifest.json background.js sidepanel.html sidepanel.js popup.html popup.js lib/ icons/
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

### Web UI routing
Hash-based routing (`#/login`, `#/workspace/:id`) — no server-side routing needed. ES Modules loaded directly by the browser, no build tools.

### Extension marker mechanism
Restored workspaces get a collapsed tab group with an `about:blank#ws-marker` tab at the front. This marker is auto-excluded when saving. Any code touching save/restore must preserve this behavior.

## Key Conventions

- All source is plain JavaScript (no TypeScript, no transpilation)
- Server env vars: `PORT`, `SESSION_SECRET`, `DB_PATH` (from `server/.env`)
- SQLite DB file at `server/data/tabsy.db` (auto-created on first run)
- 10-color system shared between extension and Web UI — hex values and Chrome tabGroups color names defined in SPEC.md
- Token format: `tb_` prefix + 32-char random hex
- API responses use camelCase JSON keys; SQLite columns use snake_case
- Server dependencies: express, better-sqlite3, bcrypt, express-session, better-sqlite3-session-store, uuid, nodemon (dev)

## Development Milestones (v1.0.0)

1. Server skeleton (Express + SQLite + schema init)
2. User register/login API + session
3. Sync Token CRUD API
4. Workspace CRUD API
5. Web UI — login/register pages
6. Web UI — workspace overview (read-only)
7. Web UI — settings page (token management)
8. Extension — storage layer refactor (add UUID, storage adapter)
9. Extension — settings UI (Server URL + Token)
10. Extension — sync functionality (push/pull)
11. Extension — sync status display
