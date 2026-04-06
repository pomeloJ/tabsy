# Tabsy

A self-hosted browser workspace management system. Save, restore, and sync your tab workspaces across devices.

**One window = one workspace.** Tabsy captures your browser tabs and tab groups into named, color-coded workspaces that you can restore with a single click.

## Why Tabsy?

Modern browser workflows involve dozens of tabs across multiple contexts — research, projects, clients, daily tasks. Tabsy solves three core needs:

1. **Tab Sync** — Save your browser windows as workspaces and sync them across devices via a self-hosted server. Restore any workspace with one click, preserving tab groups, colors, and ordering.
2. **Flow Automation** — Attach visual automation flows (iOS Shortcuts-style) to workspaces. Automate repetitive browser tasks with 40+ block types: click, fill, wait, loop, if/else, and more. Flows can auto-trigger when a workspace is restored.
3. **Notes** — Attach notes to workspaces, tab groups, or individual tabs with many-to-many linking. Notes follow tabs through navigation using persistent tab IDs, survive recapture, and sync across devices with per-note conflict resolution.

## Features

- **Workspace Management** — Save and restore entire browser windows as named workspaces with color coding
- **Tab Group Support** — Preserves Chrome/Edge tab groups (name, color, collapsed state)
- **Drag-and-Drop Reordering** — Reorder tabs within and across groups via drag-and-drop in Web UI
- **Cross-Device Sync** — Sync workspaces between browsers via a self-hosted server
- **Live Sync** — Real-time tab state reconciliation with automatic tab ordering
- **Sync Change Tracking** — Detailed per-field diff history with dedicated sync logs page
- **Notes** — Independent notes with many-to-many linking to workspaces, groups, and tabs; per-note sync merge
- **Web Dashboard** — Manage workspaces from any browser through the built-in web UI
- **Flows** — Visual block-based automation (40+ block types) attached to workspaces with auto-trigger
- **Encrypted Backups** — Per-user encrypted backup and restore
- **Cloudflare Access** — Optional Service Token support for deployments behind Cloudflare Access
- **Role-Based Access** — Admin and regular user roles with user management
- **First-Time Setup Wizard** — Guided admin account creation on first launch
- **i18n** — English and Traditional Chinese (繁體中文)
- **Responsive Design** — Desktop, tablet, and mobile layouts

## Architecture

```
+-----------------+       +---------------------------+
|  Browser        |       |  Sync Server (Express)    |
|  Extension      | <---> |  REST API + SQLite        |
|  (Side Panel)   |  sync |  + Web UI (static files)  |
+-----------------+       +---------------------------+
```

| Component | Description |
|-----------|-------------|
| **Extension** (`extension/`) | Manifest V3 Chrome/Edge extension with side panel UI |
| **Server** (`server/`) | Express + SQLite (better-sqlite3) REST API |
| **Web UI** (`server/public/`) | Vanilla HTML/CSS/JS served by the same Express process |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- Chrome or Edge browser (for the extension)

### Server Setup

```bash
# Clone the repository
git clone https://github.com/your-username/tabsy.git
cd tabsy/server

# Install dependencies
npm install

# Create environment file
cp .env.sample .env
# Edit .env and change SESSION_SECRET to a random string

# Start the server
npm start
```

The server starts at `http://localhost:3000`. On first visit, you'll be guided to create an admin account.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `SESSION_SECRET` | — | Secret for session cookies (change this!) |
| `DB_PATH` | `./data/tabsy.db` | SQLite database file path |

### Extension Setup

**Option 1: Download from Web UI**

1. Log in to the Web UI and go to the **Download** page
2. Download the extension ZIP file and extract it
3. Open `chrome://extensions/` or `edge://extensions/`
4. Enable **Developer mode**
5. Click **Load unpacked** and select the extracted folder
6. Click the Tabsy icon in the toolbar to open the side panel
7. Go to Settings in the web UI, create a sync token, and paste it into the extension

**Option 2: Load from source**

1. Open `chrome://extensions/` or `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder
4. Click the Tabsy icon in the toolbar to open the side panel
5. Go to Settings in the web UI, create a sync token, and paste it into the extension

## Usage

### Extension (Side Panel)

- **Save** — Click save to capture the current window as a workspace
- **Restore** — Click a workspace to open it in a new window
- **Sync** — Workspaces sync automatically when connected to a server

### Web UI

- **Dashboard** — View, search, sort, create, and delete workspaces
- **Workspace Detail** — Edit tabs, groups, notes, and flows with tabbed panel UI
- **Sync Logs** — View detailed sync change history with action/date filters
- **Settings** — Personal settings and admin panel (user management, tokens)
- **Backup/Restore** — Encrypted per-user backup and restore

### User Roles

| Role | Capabilities |
|------|-------------|
| **Admin** | Everything a regular user can do, plus: create/delete users, reset passwords |
| **User** | Manage own workspaces, create sync tokens |

The first account created via the setup wizard is automatically an admin. New users can only be created by an admin through the settings page.

## Development

```bash
# Start with auto-reload
cd server
npm run dev
```

The extension has no build step — edit files in `extension/` and reload the extension in the browser.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Manifest V3, Chrome APIs, vanilla JS |
| Server | Express, better-sqlite3, bcrypt, express-session |
| Web UI | Vanilla HTML/CSS/JS, ES Modules, no build tools |
| Auth | Dual mode — session cookies (Web UI) + Bearer tokens (extension) |
| Sync | Last-Write-Wins (LWW) based on `savedAt` timestamps |

## Project Structure

```
tabsy/
��── extension/               # Chrome/Edge extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js        # Service worker
│   ├── sidepanel.html/.js   # Main extension UI
│   ├── marker.html/.js      # Workspace marker page
│   ├── flow-editor.html/.js # Flow editor
│   └── lib/
│       ├── storage.js       # chrome.storage.local CRUD
│       ├── sync.js          # Pull/push sync + change tracking
│       ├── live-sync.js     # Real-time sync reconciliation
│       ├── capture.js       # Workspace capture with persistent tab IDs
│       ├── merge.js         # Sync merge logic
│       ├── api-client.js    # Server API wrapper
│       ├── flow-*.js        # Flow schema, executor, runner
│       ├── safe-eval.js     # Sandboxed expression eval for flows
│       └── i18n.js          # Extension i18n
│
├── server/                  # Sync server + Web UI
│   ├── package.json
│   ├── .env.sample          # Environment template
│   ├── src/
│   │   ├── index.js         # Entry point
│   │   ├── db.js            # SQLite schema + migrations
│   │   ├── routes/
│   │   │   ├── api.js       # Workspace CRUD + sync + change tracking
│   │   │   ├── auth.js      # Auth + user management
│   │   │   └── backup.js    # Encrypted backup/restore
│   │   ├── services/
│   │   │   └── backup.js    # Backup encryption + file management
│   │   └── middleware/
│   │       └── auth.js      # Auth middleware (session + token)
│   └── public/              # Web UI static files
│       ├── index.html
│       ├── css/style.css
│       └── js/
│           ├── app.js       # Hash router + auth state
│           ├── api.js       # Fetch wrapper
│           ├── i18n.js      # Web UI i18n
│           └── components/  # UI components
│
├── SPEC.md                  # Full specification
└── README.md
```

## License

MIT

---

# Tabsy（繁體中文）

自架的瀏覽器工作區管理系統。儲存、還原、跨裝置同步你的分頁工作區。

**一個視窗 = 一個工作區。** Tabsy 將瀏覽器分頁與分頁群組擷取為命名、色彩標記的工作區，一鍵即可還原。

## 為什麼選擇 Tabsy？

現代瀏覽器工作流涉及大量分頁與多種情境 — 研究、專案、客戶、日常任務。Tabsy 解決三大核心需求：

1. **分頁同步** — 將瀏覽器視窗儲存為工作區，透過自架伺服器跨裝置同步。一鍵還原，完整保留分頁群組、顏色與排序。
2. **Flow 自動化** — 為工作區附加視覺化自動化流程（類似 iOS 捷徑），40+ 種動作類型：點擊、填寫、等待、迴圈、條件判斷等。可在還原工作區時自動觸發。
3. **筆記系統** — 將筆記附加到工作區、分頁群組或個別分頁，支援多對多連結。筆記透過持久化分頁 ID 追蹤分頁，跨裝置同步時使用逐筆記衝突解決。

## 功能特色

- **工作區管理** — 將整個瀏覽器視窗儲存為命名工作區，支援色彩標記
- **分頁群組** — 完整保留 Chrome/Edge 分頁群組（名稱、顏色、折疊狀態）
- **拖放排序** — 在 Web UI 中透過拖放重新排列分頁
- **跨裝置同步** — 透過自架伺服器在不同瀏覽器間同步工作區
- **即時同步** — 分頁狀態即時同步與自動排序
- **同步變更追蹤** — 逐欄位差異歷史記錄，附專屬同步日誌頁面
- **筆記** — 獨立筆記系統，多對多連結工作區、群組與分頁，逐筆記同步合併
- **網頁管理介面** — 內建 Web UI，可在任何瀏覽器管理工作區
- **流程自動化** — 視覺化區塊式自動化（40+ 種區塊類型），可自動觸發
- **加密備份** — 逐使用者加密備份與還原
- **Cloudflare Access** — 選配 Service Token 支援，適用於部署在 Cloudflare Access 後方的環境
- **角色權限** — 管理員與一般使用者角色，管理員可管理所有使用者
- **首次設定引導** — 首次啟動時引導建立管理員帳號
- **多語系** — 支援英文與繁體中文
- **響應式設計** — 桌面、平板、手機版面

## 快速開始

### 環境需求

- [Node.js](https://nodejs.org/) >= 18
- Chrome 或 Edge 瀏覽器（擴充功能用）

### 伺服器安裝

```bash
git clone https://github.com/your-username/tabsy.git
cd tabsy/server

npm install

cp .env.sample .env
# 編輯 .env，將 SESSION_SECRET 改為隨機字串

npm start
```

伺服器啟動於 `http://localhost:3000`。首次開啟會引導建立管理員帳號。

### 擴充功能安裝

**方式一：從 Web UI 下載**

1. 登入 Web UI，進入**下載**頁面
2. 下載擴充功能 ZIP 檔案並解壓縮
3. 開啟 `chrome://extensions/` 或 `edge://extensions/`
4. 啟用**開發者模式**
5. 點擊**載入未封裝項目**，選擇解壓縮後的資料夾
6. 點擊工具列的 Tabsy 圖示開啟側邊面板
7. 在 Web UI 的設定頁面建立同步令牌，貼入擴充功能中

**方式二：從原始碼載入**

1. 開啟 `chrome://extensions/` 或 `edge://extensions/`
2. 啟用**開發者模式**
3. 點擊**載入未封裝項目**，選擇 `extension/` 資料夾
4. 點擊工具列的 Tabsy 圖示開啟側邊面板
5. 在 Web UI 的設定頁面建立同步令牌，貼入擴充功能中

### 使用者角色

| 角色 | 權限 |
|------|------|
| **管理員** | 一般使用者所有功能，加上：建立/刪除使用者、重設密碼 |
| **一般使用者** | 管理自己的工作區、建立同步令牌 |

首次透過設定精靈建立的帳號自動為管理員。新使用者只能由管理員在設定頁面中建立。

## 授權

MIT
