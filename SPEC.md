# Tabsy — 規格書

## 概述

Tabsy 是一套瀏覽器工作區管理系統，由三個元件組成：

| 元件 | 說明 |
|------|------|
| **Chrome Extension** | Edge/Chrome 外掛，以「一個視窗 = 一個工作區」為核心，管理分頁儲存、還原、命名、顏色標記 |
| **Sync Server** | Node.js 同步伺服器，提供 REST API，負責工作區資料的跨裝置同步與持久化 |
| **Web UI** | 伺服器內建的網頁管理介面，可在瀏覽器外掛以外的環境管理工作區 |

Server 與 Web UI 跑在同一個 Node.js process，Web UI 以靜態檔案方式由 Server 直接提供。

---

## 專案結構

```
tabsy/
├── extension/                — Chrome/Edge 外掛
│   ├── manifest.json
│   ├── background.js
│   ├── sidepanel.html
│   ├── sidepanel.js
│   ├── popup.html              （保留備用）
│   ├── popup.js                （保留備用）
│   ├── lib/
│   │   ├── storage.js          — 儲存層抽象（local + remote）
│   │   ├── sync.js             — 同步邏輯
│   │   └── api-client.js       — Server API 呼叫封裝
│   └── icons/
│       └── icon.png
│
├── server/                   — Node.js 同步伺服器 + Web UI
│   ├── package.json
│   ├── src/
│   │   ├── index.js            — 入口，啟動 Express + 靜態檔案
│   │   ├── db.js               — SQLite 連線 + schema 初始化
│   │   ├── routes/
│   │   │   ├── api.js          — /api/workspaces CRUD
│   │   │   └── auth.js         — 登入、註冊、token 管理
│   │   └── middleware/
│   │       └── auth.js         — 認證中間件（session + token 雙模式）
│   └── public/               — Web UI 靜態檔案
│       ├── index.html
│       ├── login.html
│       ├── css/
│       │   └── style.css
│       ├── js/
│       │   ├── app.js
│       │   ├── api.js
│       │   └── components/     — UI 元件（vanilla JS）
│       └── assets/
│
├── SPEC.md
└── README.md
```

---

## 技術選型

| 項目 | 選擇 | 說明 |
|------|------|------|
| 外掛 | Manifest V3 | Chrome 114+、Edge 相容 |
| 伺服器框架 | Express | 成熟穩定，生態系完整 |
| 資料庫 | SQLite（better-sqlite3） | 單檔、零設定、未來可遷移至 PostgreSQL |
| Web UI | 純 HTML + CSS + vanilla JS | 零建置步驟，Server 直接 serve 靜態檔案 |
| RWD | CSS Flexbox + Grid + Media Queries | 支援桌面 / 平板 / 手機瀏覽 |
| 認證 | Web：帳密 + session / API：Bearer token | 雙模式，Web 登入後可管理 sync token |
| 密碼雜湊 | bcrypt | 安全儲存密碼 |
| Session | express-session + better-sqlite3-session-store | Session 存 SQLite，單一資料檔 |

---

## 統一資料模型

Extension、Server、Web UI 三端共用同一份資料結構定義。

### Workspace

```json
{
  "id": "uuid-v4",
  "name": "開發專案",
  "color": "#0078d4",
  "savedAt": "2026-04-03T05:00:00.000Z",
  "groups": [
    {
      "groupId": "g1",
      "title": "群組名稱",
      "color": "blue",
      "collapsed": false
    }
  ],
  "tabs": [
    {
      "url": "https://example.com",
      "title": "Example",
      "pinned": false,
      "groupId": "g1",
      "index": 0
    }
  ]
}
```

**與 MVP 的差異：**

| 欄位 | 變更 | 原因 |
|------|------|------|
| `id` | 新增 UUID v4 | 跨裝置同步需要穩定識別 |
| `groups` | 改為陣列，`groupId` 改為字串 | 原本用 Chrome 的數字 groupId 作 key，不同裝置會不同 |
| `tabs[].groupId` | 對應 groups 內的字串 `groupId` | 與 groups 結構一致 |

### User（僅 Server 端）

```json
{
  "id": 1,
  "username": "user1",
  "createdAt": "2026-04-03T05:00:00.000Z"
}
```

### SyncToken（僅 Server 端）

```json
{
  "id": 1,
  "userId": 1,
  "token": "tb_xxxxxxxxxxxx",
  "name": "我的筆電",
  "createdAt": "2026-04-03T05:00:00.000Z",
  "lastUsedAt": "2026-04-03T06:00:00.000Z"
}
```

---

## 資料庫 Schema（SQLite）

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sync_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,              -- UUID v4
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  groups TEXT NOT NULL DEFAULT '[]', -- JSON 陣列
  tabs TEXT NOT NULL DEFAULT '[]',   -- JSON 陣列
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_workspaces_user ON workspaces(user_id);
CREATE INDEX idx_tokens_user ON sync_tokens(user_id);
CREATE INDEX idx_tokens_token ON sync_tokens(token);
```

`groups` 和 `tabs` 以 JSON 字串存在單一欄位，查詢以 workspace 為單位，不需要對個別 tab 做 query。

---

## 認證系統

### 雙模式設計

```
┌─────────────┐    帳密 + Session Cookie    ┌──────────┐
│   Web UI    │ ◄─────────────────────────► │  Server  │
└─────────────┘                             └──────────┘
                                                 ▲
┌─────────────┐    Bearer Token (Header)         │
│  Extension  │ ─────────────────────────────────┘
└─────────────┘
```

### Web UI 認證流程

1. 使用者在 Web UI 輸入帳號密碼登入
2. Server 驗證後建立 session，設定 cookie
3. 後續 Web UI 的 API 請求自動帶上 cookie
4. 登入後可在「設定」頁面建立 / 管理 sync token

### Extension 認證流程

1. 使用者在 Web UI 建立一組 sync token（附帶名稱，如「我的筆電」）
2. 複製 token，貼到 Extension Side Panel 的設定區
3. Token 存入 `chrome.storage.local`
4. Extension 的所有 API 請求帶上 `Authorization: Bearer <token>`

### Token 格式

```
tb_<32 字元隨機 hex>
```

前綴 `tb_` 用於識別，避免與其他 token 混淆。

### 認證中間件邏輯

```
每個 /api/* 請求：
  1. 檢查 Authorization header → 有 → 驗證 token → 通過 → 取得 user_id
  2. 無 header → 檢查 session cookie → 有 → 驗證 session → 通過 → 取得 user_id
  3. 都沒有 → 401 Unauthorized
```

---

## Server API

Base URL: `/api`

所有 `/api/*` 路由皆需認證（token 或 session）。

### 工作區 CRUD

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/workspaces` | 取得該使用者所有工作區（不含 tabs/groups 詳細資料） |
| GET | `/api/workspaces/:id` | 取得單一工作區完整資料 |
| POST | `/api/workspaces` | 建立工作區 |
| PUT | `/api/workspaces/:id` | 更新工作區（整筆覆蓋） |
| DELETE | `/api/workspaces/:id` | 刪除工作區 |

#### GET /api/workspaces

回應（列表模式，省略 tabs/groups 以減少傳輸量）：

```json
{
  "workspaces": [
    {
      "id": "uuid",
      "name": "開發專案",
      "color": "#0078d4",
      "savedAt": "...",
      "updatedAt": "...",
      "tabCount": 12,
      "groupCount": 3
    }
  ]
}
```

#### POST /api/workspaces

Request body：

```json
{
  "id": "uuid-v4",
  "name": "開發專案",
  "color": "#0078d4",
  "savedAt": "...",
  "groups": [...],
  "tabs": [...]
}
```

`id` 由 client 端產生（Extension 或 Web UI），確保離線建立的工作區也有穩定 ID。

#### PUT /api/workspaces/:id

Request body 同 POST，整筆覆蓋。Server 自動更新 `updated_at`。

### 同步

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/sync/push` | Extension 批次上傳本地變更 |
| POST | `/api/sync/pull` | Extension 拉取 server 端變更 |

#### POST /api/sync/pull

Request body：

```json
{
  "lastSyncAt": "2026-04-03T05:00:00.000Z"
}
```

回應：

```json
{
  "workspaces": [...],
  "deleted": ["uuid-1", "uuid-2"],
  "serverTime": "2026-04-03T06:00:00.000Z"
}
```

回傳 `lastSyncAt` 之後有變動的工作區，以及已刪除的 ID 列表。

#### POST /api/sync/push

Request body：

```json
{
  "upsert": [...],
  "delete": ["uuid-1"]
}
```

回應：

```json
{
  "conflicts": [
    {
      "id": "uuid",
      "serverVersion": { ... },
      "resolution": "server_wins"
    }
  ],
  "serverTime": "2026-04-03T06:00:00.000Z"
}
```

### 認證

| 方法 | 路徑 | 說明 | 需認證 |
|------|------|------|--------|
| POST | `/api/auth/register` | 註冊 | 否 |
| POST | `/api/auth/login` | 登入（建立 session） | 否 |
| POST | `/api/auth/logout` | 登出（銷毀 session） | 是 |
| GET | `/api/auth/me` | 取得目前使用者資訊 | 是 |
| GET | `/api/auth/tokens` | 列出 sync token | 是 |
| POST | `/api/auth/tokens` | 建立 sync token | 是 |
| DELETE | `/api/auth/tokens/:id` | 撤銷 sync token | 是 |

---

## 同步策略

### 原則

- **Last-Write-Wins**：以 `savedAt` 時間戳判定，較新的版本覆蓋較舊的
- **Client 產生 ID**：workspace UUID 由 client 端（Extension 或 Web UI）在建立時產生
- **批次同步**：Extension 不逐筆即時同步，而是定期或手動觸發批次同步

### Extension 同步流程

```
外掛啟動 / 使用者點擊「同步」：
  1. POST /api/sync/pull { lastSyncAt }
     → 取得 server 端新增/更新/刪除的 workspace
     → 合併到 local storage

  2. 收集 local 自 lastSyncAt 後的變更
     POST /api/sync/push { upsert, delete }
     → server 回傳衝突列表（如有）

  3. 更新 lastSyncAt 為 serverTime
```

### 衝突處理

```
比較 local.savedAt vs server.savedAt：
  - local 較新 → 以 local 為準，上傳覆蓋
  - server 較新 → 以 server 為準，覆蓋 local
  - 相同 → 無衝突，跳過
```

### 同步狀態

每個 workspace 在 Extension 端額外記錄：

```json
{
  "syncStatus": "synced | pending | local_only | conflict",
  "lastSyncAt": "..."
}
```

Side Panel 卡片上顯示同步狀態圖示。

---

## Chrome Extension（詳細）

### MVP 功能（v0.2.0 — 已完成）

#### 儲存工作區

- 儲存目前視窗的所有分頁（URL、標題、釘選狀態）
- 儲存分頁群組（Tab Groups）的結構、標題、顏色、摺疊狀態
- 支援自訂工作區名稱
- 支援選擇工作區顏色（10 色）
- 支援一鍵儲存所有視窗（每個視窗各存為一個工作區）
- 自動排除 marker 標記分頁，避免重複儲存

#### 還原工作區

- 在新視窗還原所有分頁與群組結構
- 還原群組的標題、顏色、摺疊狀態
- 分頁列最前方自動建立 marker group（摺疊狀態），顯示工作區名稱與顏色
- marker 使用 `chrome-extension://<id>/marker.html?name=...&color=...&tabs=...&savedAt=...` 作為識別 URL，頁面會顯示 workspace 資訊

#### 工作區辨識

- **Badge**：外掛圖示顯示工作區編號（數字）+ 對應顏色背景
- **Tooltip**：hover 顯示 `📂 #編號 名稱`
- **Side Panel 頂部**：常駐顯示目前工作區的編號、名稱、顏色
- **Marker Group**：分頁列上直接可見 `📂 工作區名稱`
- 切換視窗時自動更新所有顯示

#### 管理

- Side Panel 列出所有已儲存的工作區（名稱、顏色條、分頁數、群組數、時間）
- 個別還原、個別刪除
- 一鍵清除全部

### 同步功能（新增）

- Side Panel 底部新增「設定」區塊：Server URL + Token 輸入
- 同步按鈕：手動觸發同步
- 自動同步：外掛啟動時 + 儲存/刪除工作區時
- 每個工作區卡片顯示同步狀態圖示
- 網路錯誤時 graceful fallback，不影響本地操作

### 使用的 Chrome Extension API

| API | 用途 |
|-----|------|
| `chrome.tabs` | 查詢、建立、關閉、分組分頁 |
| `chrome.tabGroups` | 查詢、建立、更新分頁群組 |
| `chrome.windows` | 查詢、建立視窗、監聽視窗切換 |
| `chrome.storage.local` | 本地儲存工作區資料 |
| `chrome.sidePanel` | Side Panel UI |
| `chrome.action` | Badge 文字、顏色、tooltip |

### 顏色系統

外掛自訂 10 色，並對應 `chrome.tabGroups` API 支援的顏色名稱：

| 顯示名 | Hex | tabGroups color |
|---------|-----|-----------------|
| 藍 | #0078d4 | blue |
| 綠 | #107c10 | green |
| 紅 | #d13438 | red |
| 橘 | #ca5010 | orange |
| 紫 | #881798 | purple |
| 青 | #038387 | cyan |
| 粉 | #e3008c | pink |
| 灰 | #69797e | grey |
| 深藍 | #003966 | blue |
| 深綠 | #0b6a0b | green |

### Marker 機制

- 還原時在分頁列最前方建立一個摺疊的 tab group
- 內含一個 `marker.html` 分頁（顯示 workspace 名稱、顏色、分頁數、儲存時間）
- 群組標題為 `📂 工作區名稱`，顏色對應工作區顏色
- 儲存時偵測 marker URL，自動排除該分頁及其所屬群組

---

## Web UI

### 頁面規劃

| 路由 | 頁面 | 說明 |
|------|------|------|
| `/login` | 登入頁 | 帳號密碼表單 |
| `/register` | 註冊頁 | 帳號密碼表單 |
| `/` | 工作區總覽 | 所有工作區列表，主頁面 |
| `/workspace/:id` | 工作區詳情 | 檢視/編輯單一工作區的分頁與群組 |
| `/settings` | 設定頁 | Sync Token 管理、帳號設定 |

### 功能

#### 工作區總覽（`/`）

- 卡片式列表顯示所有工作區
- 每張卡片：名稱、顏色條、分頁數、群組數、最後更新時間
- 支援搜尋（依名稱）
- 支援排序（依名稱 / 更新時間）
- 新增工作區按鈕
- 刪除工作區（確認對話框）

#### 工作區詳情（`/workspace/:id`）

- 編輯名稱、顏色
- 檢視分頁列表（URL、標題、所屬群組）
- 新增分頁（輸入 URL）
- 移除分頁
- 檢視/編輯群組（標題、顏色）
- 拖曳排序分頁（選配，非必要）

#### 設定（`/settings`）

- Sync Token 列表（名稱、建立時間、最後使用時間）
- 建立新 token（輸入名稱 → 顯示一次完整 token）
- 撤銷 token
- 修改密碼

#### 匯出 / 匯入

- 匯出全部工作區為 JSON 檔案下載
- 匯入 JSON 檔案（合併或覆蓋）

### RWD 斷點

| 斷點 | 佈局 |
|------|------|
| ≥ 1024px | 桌面：側邊導覽列 + 主內容區 |
| 768–1023px | 平板：摺疊導覽列 + 主內容區 |
| < 768px | 手機：底部導覽 + 全寬內容 |

### 技術細節

- **路由**：hash-based routing（`#/workspace/uuid`），不需 server-side routing
- **狀態管理**：vanilla JS 模組，fetch API 呼叫 server
- **元件**：ES Module 拆分（每個頁面一個 JS 模組）
- **CSS**：單一 CSS 檔案，CSS custom properties 管理主題色
- **無建置步驟**：不需要 webpack / vite，瀏覽器直接載入 ES Module

---

## 已知限制

- 無法讀取 Edge 原生 Workspace 結構
- 無法控制 Edge 側邊欄 UI
- `chrome.tabGroups` 顏色僅支援 9 種（blue, cyan, green, grey, orange, pink, purple, red, yellow）
- SQLite 單檔寫入有鎖限制，極高併發場景需遷移至 PostgreSQL
- `chrome.storage.local` 儲存上限預設 10MB（大量工作區需注意）

---

## 開發與部署

### 開發環境啟動

```bash
# Server（含 Web UI）
cd server
npm install
npm run dev          # nodemon 自動重啟

# Extension
# 無需建置，直接在 edge://extensions/ 載入 extension/ 資料夾
```

### 環境變數（server/.env）

```env
PORT=3000
SESSION_SECRET=your-random-secret
DB_PATH=./data/tabsy.db
```

### 部署

```bash
cd server
npm install --production
node src/index.js
# 或使用 PM2
pm2 start src/index.js --name tabsy
```

Server 同時提供：
- `/api/*` → REST API
- `/*` → Web UI 靜態檔案

只需部署一個 Node.js process，無需額外的前端部署。

### 外掛打包

```bash
cd extension
zip -r tabsy-extension-v1.0.0.zip manifest.json background.js sidepanel.html sidepanel.js popup.html popup.js lib/ icons/
```

---

## 開發里程碑

### v0.2.x — MVP（已完成）

Extension 本地工作區管理，無同步功能。

### v1.0.0 — 同步基礎

| # | 工作項目 | 元件 |
|---|---------|------|
| 1 | Server 骨架（Express + SQLite + schema 初始化） | Server |
| 2 | 使用者註冊 / 登入 API + session | Server |
| 3 | Sync Token CRUD API | Server |
| 4 | Workspace CRUD API | Server |
| 5 | Web UI — 登入 / 註冊頁 | Web UI |
| 6 | Web UI — 工作區總覽（唯讀） | Web UI |
| 7 | Web UI — 設定頁（Token 管理） | Web UI |
| 8 | Extension — 儲存層重構（加入 UUID、storage adapter） | Extension |
| 9 | Extension — 設定 UI（Server URL + Token） | Extension |
| 10 | Extension — 同步功能（push/pull） | Extension |
| 11 | Extension — 同步狀態顯示 | Extension |

### v1.1.0 — Web 管理

| # | 工作項目 | 元件 |
|---|---------|------|
| 1 | Web UI — 工作區詳情（編輯分頁/群組） | Web UI |
| 2 | Web UI — 新增工作區 | Web UI |
| 3 | Web UI — 匯出 / 匯入 JSON | Web UI |
| 4 | Web UI — RWD 優化 | Web UI |
| 5 | Sync push/pull API | Server |

### v1.2.0+ — 進階功能（未來）

- 自動快照（定時備份目前工作區狀態）
- 工作區版本歷史（可回溯到任意時間點）
- 分享工作區（產生連結，其他人可匯入）
- 工作區範本
- WebSocket 即時同步推送
