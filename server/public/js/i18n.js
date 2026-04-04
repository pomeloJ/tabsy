/**
 * i18n — Lightweight internationalization for Tabsy Web UI
 *
 * Usage:
 *   import { t, setLocale, getLocale } from './i18n.js';
 *   t('save') // → "Save"
 */

const locales = {
  en: {
    // Nav & layout
    workspaces: 'Workspaces',
    settings: 'Settings',
    logout: 'Logout',
    workspace: 'Workspace',
    closeMenu: 'Close menu',
    openMenu: 'Open menu',

    // Login
    login: 'Login',
    username: 'Username',
    password: 'Password',
    loginFailed: 'Login failed',
    noAccount: "Don't have an account?",
    register: 'Register',

    // Register
    alreadyHaveAccount: 'Already have an account?',
    registrationFailed: 'Registration failed',

    // Dashboard
    importJson: 'Import JSON',
    exportJson: 'Export JSON',
    import: 'Import',
    export: 'Export',
    newWorkspace: 'New Workspace',
    searchWorkspaces: 'Search workspaces...',
    sortByTime: 'Sort by time',
    sortByName: 'Sort by name',
    failedToLoadWorkspaces: 'Failed to load workspaces.',
    noWorkspacesYet: 'No workspaces yet.',
    createToStart: 'Create one to get started.',
    noWorkspacesFound: 'No workspaces found.',
    tab: 'tab',
    tabs: 'tabs',
    group: 'group',
    groups: 'groups',
    flow: 'flow',
    flowsPlural: 'flows',
    deleteWorkspace: 'Delete workspace',
    failedToDeleteWorkspace: 'Failed to delete workspace.',
    deleteConfirm: 'Delete "{name}"?',
    noGroups: 'No groups',
    untitled: 'Untitled',
    justNow: 'Just now',
    mAgo: '{n}m ago',
    hAgo: '{n}h ago',
    dAgo: '{n}d ago',

    // New Workspace modal
    name: 'Name',
    color: 'Color',
    cancel: 'Cancel',
    create: 'Create',
    creating: 'Creating...',
    failedToCreateWorkspace: 'Failed to create workspace.',

    // Workspace detail
    loadingWorkspace: 'Loading workspace...',
    workspaceNotFound: 'Workspace not found.',
    backToWorkspaces: 'Back to Workspaces',
    save: 'Save',
    saving: 'Saving...',
    saved: 'Saved',
    changeColor: 'Change color',
    changeWorkspaceColor: 'Change workspace color',
    editName: 'Edit name',
    editWorkspaceName: 'Edit workspace name',
    addTabPlaceholder: 'Add tab — paste URL...',
    addTab: 'Add Tab',
    newGroupPlaceholder: 'New group name...',
    addGroup: 'Add Group',
    unsavedChanges: 'You have unsaved changes. Leave anyway?',
    ungrouped: 'Ungrouped',
    noTabsInGroup: 'No tabs in this group',
    noUngroupedTabs: 'No ungrouped tabs',
    editGroup: 'Edit group',
    deleteGroup: 'Delete group',
    deleteGroupConfirm: 'Delete group "{name}"? Tabs will become ungrouped.',
    done: 'Done',
    moveTo: 'Move to...',
    moveToGroup: 'Move to group',
    moveTabToGroup: 'Move tab to group',
    removeTab: 'Remove tab',
    openInNewTab: 'Open in new tab',
    pin: 'PIN',
    title: 'Title',
    url: 'URL',
    workspaceSaved: 'Workspace saved',
    failedToSaveWorkspace: 'Failed to save workspace',

    // Flows (read-only in workspace detail)
    flows: 'Flows',
    blocks: 'Blocks',
    variables: 'Variables',
    noBlocks: 'No blocks',
    urlMatch: 'URL Match',
    triggerManual: 'Manual',
    triggerPageLoad: 'Page Load',
    triggerPageIdle: 'Page Idle',
    thenBranch: 'Then',
    elseBranch: 'Else',
    tryBranch: 'Try',
    catchBranch: 'Catch',

    // Settings
    syncTokens: 'Sync Tokens',
    syncTokensDesc: 'Create tokens for your browser extensions to sync workspaces with this server.',
    tokenNamePlaceholder: 'Token name (e.g. My Laptop)',
    createToken: 'Create Token',
    tokenCreated: 'Token created!',
    tokenCopyWarning: "Copy it now — it won't be shown again.",
    copy: 'Copy',
    copied: 'Copied!',
    failedToLoadTokens: 'Failed to load tokens.',
    noTokensYet: 'No tokens yet.',
    tokenName: 'Name',
    tokenCreatedAt: 'Created',
    tokenLastUsed: 'Last Used',
    never: 'Never',
    revoke: 'Revoke',
    revokeConfirm: 'Revoke this token? Extensions using it will lose access.',
    failedToRevokeToken: 'Failed to revoke token.',
    failedToCreateToken: 'Failed to create token.',

    // Import/Export
    importPrompt: 'Found {n} workspace(s) to import.\n\nType "merge" to add new ones only, or "overwrite" to replace existing ones with same ID.\n\nDefault: merge',
    importComplete: 'Import complete: {imported} imported, {skipped} skipped.',
    invalidImportFile: 'Invalid file: no workspaces found.',
    failedToParseImport: 'Failed to parse import file. Make sure it is a valid Tabsy JSON export.',

    // Setup wizard
    setupTitle: 'Welcome to Tabsy',
    setupDesc: 'Create your admin account to get started.',
    setupButton: 'Create Account',
    setupFailed: 'Setup failed',

    // User management (admin)
    userManagement: 'User Management',
    userManagementDesc: 'Create and manage user accounts.',
    addUser: 'Add User',
    usernamePlaceholder: 'Username',
    passwordPlaceholder: 'Password',
    roleAdmin: 'Admin',
    roleUser: 'User',
    role: 'Role',
    createdAt: 'Created',
    deleteUser: 'Delete',
    resetPassword: 'Reset Password',
    deleteUserConfirm: 'Delete user "{name}"? All their workspaces will be deleted.',
    resetPasswordPrompt: 'New password for "{name}" (min 6 characters):',
    failedToLoadUsers: 'Failed to load users.',
    failedToCreateUser: 'Failed to create user.',
    failedToDeleteUser: 'Failed to delete user.',
    failedToResetPassword: 'Failed to reset password.',
    passwordResetSuccess: 'Password updated.',
    noOtherUsers: 'No other users yet.',
    you: '(you)',

    // Language
    language: 'Language',

    // Download page
    download: 'Download',
    loading: 'Loading',
    extensionDownload: 'Extension Download',
    downloadZip: 'Download ZIP',
    failedToLoadVersion: 'Failed to load version info.',
    installGuide: 'Installation Guide',
    installStep1Title: 'Download the ZIP file',
    installStep1Desc: 'Click the download button above to get the latest extension package.',
    installStep2Title: 'Extract the ZIP',
    installStep2Desc: 'Unzip the downloaded file to a permanent location (e.g. Documents/tabsy-extension). If updating, replace the old folder.',
    installStep3Title: 'Open browser extensions page',
    installStep3Desc: 'Go to edge://extensions (Edge) or chrome://extensions (Chrome), then enable "Developer mode" in the top-right corner.',
    installStep4Title: 'Load the extension',
    installStep4Desc: 'Click "Load unpacked" and select the extracted folder. If updating, click the reload button on the existing extension card instead.',
    versionHistory: 'Version History',
  },

  'zh-TW': {
    workspaces: '工作區',
    settings: '設定',
    logout: '登出',
    workspace: '工作區',
    closeMenu: '關閉選單',
    openMenu: '開啟選單',

    login: '登入',
    username: '使用者名稱',
    password: '密碼',
    loginFailed: '登入失敗',
    noAccount: '還沒有帳號？',
    register: '註冊',

    alreadyHaveAccount: '已經有帳號？',
    registrationFailed: '註冊失敗',

    importJson: '匯入 JSON',
    exportJson: '匯出 JSON',
    import: '匯入',
    export: '匯出',
    newWorkspace: '新增工作區',
    searchWorkspaces: '搜尋工作區...',
    sortByTime: '依時間排序',
    sortByName: '依名稱排序',
    failedToLoadWorkspaces: '無法載入工作區。',
    noWorkspacesYet: '尚無工作區。',
    createToStart: '建立一個來開始使用。',
    noWorkspacesFound: '找不到工作區。',
    tab: '分頁',
    tabs: '分頁',
    group: '群組',
    groups: '群組',
    flow: '流程',
    flowsPlural: '流程',
    deleteWorkspace: '刪除工作區',
    failedToDeleteWorkspace: '刪除工作區失敗。',
    deleteConfirm: '刪除「{name}」？',
    noGroups: '無群組',
    untitled: '未命名',
    justNow: '剛剛',
    mAgo: '{n} 分鐘前',
    hAgo: '{n} 小時前',
    dAgo: '{n} 天前',

    name: '名稱',
    color: '顏色',
    cancel: '取消',
    create: '建立',
    creating: '建立中...',
    failedToCreateWorkspace: '建立工作區失敗。',

    loadingWorkspace: '載入工作區中...',
    workspaceNotFound: '找不到工作區。',
    backToWorkspaces: '返回工作區',
    save: '儲存',
    saving: '儲存中...',
    saved: '已儲存',
    changeColor: '更改顏色',
    changeWorkspaceColor: '更改工作區顏色',
    editName: '編輯名稱',
    editWorkspaceName: '編輯工作區名稱',
    addTabPlaceholder: '新增分頁 — 貼上網址...',
    addTab: '新增分頁',
    newGroupPlaceholder: '新群組名稱...',
    addGroup: '新增群組',
    unsavedChanges: '您有未儲存的變更。確定離開？',
    ungrouped: '未分組',
    noTabsInGroup: '此群組中沒有分頁',
    noUngroupedTabs: '沒有未分組的分頁',
    editGroup: '編輯群組',
    deleteGroup: '刪除群組',
    deleteGroupConfirm: '刪除群組「{name}」？分頁將變為未分組。',
    done: '完成',
    moveTo: '移至...',
    moveToGroup: '移至群組',
    moveTabToGroup: '移動分頁到群組',
    removeTab: '移除分頁',
    openInNewTab: '在新分頁中開啟',
    pin: '釘選',
    title: '標題',
    url: '網址',
    workspaceSaved: '工作區已儲存',
    failedToSaveWorkspace: '儲存工作區失敗',

    flows: '流程',
    blocks: '區塊',
    variables: '變數',
    noBlocks: '無區塊',
    urlMatch: 'URL 比對',
    triggerManual: '手動',
    triggerPageLoad: '頁面載入',
    triggerPageIdle: '頁面閒置',
    thenBranch: 'Then',
    elseBranch: 'Else',
    tryBranch: 'Try',
    catchBranch: 'Catch',

    syncTokens: '同步令牌',
    syncTokensDesc: '為您的瀏覽器擴充功能建立令牌，以與此伺服器同步工作區。',
    tokenNamePlaceholder: '令牌名稱（例如：我的筆電）',
    createToken: '建立令牌',
    tokenCreated: '令牌已建立！',
    tokenCopyWarning: '請立即複製 — 之後將無法再次顯示。',
    copy: '複製',
    copied: '已複製！',
    failedToLoadTokens: '載入令牌失敗。',
    noTokensYet: '尚無令牌。',
    tokenName: '名稱',
    tokenCreatedAt: '建立時間',
    tokenLastUsed: '最後使用',
    never: '從未',
    revoke: '撤銷',
    revokeConfirm: '撤銷此令牌？使用此令牌的擴充功能將失去存取權限。',
    failedToRevokeToken: '撤銷令牌失敗。',
    failedToCreateToken: '建立令牌失敗。',

    importPrompt: '找到 {n} 個工作區可匯入。\n\n輸入「merge」僅新增，或「overwrite」覆蓋相同 ID 的現有工作區。\n\n預設：merge',
    importComplete: '匯入完成：{imported} 個已匯入，{skipped} 個已跳過。',
    invalidImportFile: '無效的檔案：找不到工作區。',
    failedToParseImport: '無法解析匯入檔案。請確認它是有效的 Tabsy JSON 匯出檔。',

    setupTitle: '歡迎使用 Tabsy',
    setupDesc: '建立管理員帳號以開始使用。',
    setupButton: '建立帳號',
    setupFailed: '設定失敗',

    userManagement: '使用者管理',
    userManagementDesc: '建立和管理使用者帳號。',
    addUser: '新增使用者',
    usernamePlaceholder: '使用者名稱',
    passwordPlaceholder: '密碼',
    roleAdmin: '管理員',
    roleUser: '一般使用者',
    role: '角色',
    createdAt: '建立時間',
    deleteUser: '刪除',
    resetPassword: '重設密碼',
    deleteUserConfirm: '刪除使用者「{name}」？該使用者的所有工作區將被刪除。',
    resetPasswordPrompt: '「{name}」的新密碼（至少 6 個字元）：',
    failedToLoadUsers: '載入使用者失敗。',
    failedToCreateUser: '建立使用者失敗。',
    failedToDeleteUser: '刪除使用者失敗。',
    failedToResetPassword: '重設密碼失敗。',
    passwordResetSuccess: '密碼已更新。',
    noOtherUsers: '尚無其他使用者。',
    you: '（你）',

    language: '語言',

    // Download page
    download: '下載',
    loading: '載入中',
    extensionDownload: '擴充功能下載',
    downloadZip: '下載 ZIP',
    failedToLoadVersion: '無法載入版本資訊。',
    installGuide: '安裝說明',
    installStep1Title: '下載 ZIP 檔案',
    installStep1Desc: '點擊上方的下載按鈕，取得最新的擴充功能套件。',
    installStep2Title: '解壓縮 ZIP',
    installStep2Desc: '將下載的檔案解壓縮到固定位置（例如：文件/tabsy-extension）。若為更新，請直接覆蓋舊資料夾。',
    installStep3Title: '開啟瀏覽器擴充功能頁面',
    installStep3Desc: '前往 edge://extensions（Edge）或 chrome://extensions（Chrome），然後在右上角啟用「開發人員模式」。',
    installStep4Title: '載入擴充功能',
    installStep4Desc: '點擊「載入未封裝」並選取解壓縮的資料夾。若為更新，請改按現有擴充功能卡片上的重新載入按鈕。',
    versionHistory: '版本紀錄',
  }
};

let _locale = 'en';
let _dict = locales.en;

/**
 * Translate a key with optional interpolation: t('hello', { name: 'World' })
 */
export function t(key, params) {
  let str = _dict[key] ?? locales.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, v);
    }
  }
  return str;
}

export function getLocale() {
  return _locale;
}

export function setLocale(locale) {
  if (!locales[locale]) return;
  _locale = locale;
  _dict = locales[locale];
  localStorage.setItem('tabsyLocale', locale);
}

export function initLocale() {
  const saved = localStorage.getItem('tabsyLocale');
  _locale = saved && locales[saved] ? saved : 'en';
  _dict = locales[_locale];
}

export function getAvailableLocales() {
  return [
    { code: 'en', name: 'English' },
    { code: 'zh-TW', name: '繁體中文' }
  ];
}

// Initialize on load
initLocale();
