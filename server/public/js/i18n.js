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
    personalSettings: 'Personal',
    adminSettings: 'Administration',
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
    sAgo: '{n}s ago',
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

    // Notes
    notesLabel: 'Notes',
    noNotes: 'No notes yet.',
    addNote: 'Add Note',
    editNote: 'Edit Note',
    notesPlaceholder: 'Write notes in Markdown...',
    preview: 'Preview',
    edit: 'Edit',
    addLink: 'Add Link',
    noLinks: 'No links',
    unlinked: 'Unlinked',

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

    // Language & Timezone
    language: 'Language',
    timezone: 'Timezone',

    // Sync logs
    syncLogs: 'Sync History',
    syncLogsDesc: 'Recent sync activity from your browser extensions.',
    syncLogAction: 'Action',
    syncLogClientId: 'Browser ID',
    syncLogWorkspaces: 'Workspaces',
    syncLogTime: 'Time',
    syncLogPull: 'Pull',
    syncLogPush: 'Push',
    noSyncLogs: 'No sync history yet.',
    failedToLoadSyncLogs: 'Failed to load sync logs.',
    noSyncChanges: 'No change details for this sync.',
    syncChangesTitle: 'Change Details',
    syncChangeCreated: 'Created',
    syncChangeUpdated: 'Updated',
    syncChangeDeleted: 'Deleted',
    syncChangeName: 'Name',
    syncChangeColor: 'Color',
    syncChangeTabs: 'Tabs',
    syncChangeGroups: 'Groups',
    syncChangeFlows: 'Flows',
    syncChangeNotes: 'Notes',
    syncChangeModified: 'Modified',
    syncChangeSavedAt: 'Saved at',
    syncChangeSynced: 'Data synced (no field changes)',
    syncChangeNotesModified: 'Notes edited',
    syncLogsMore: 'View all sync history',
    syncLogsFilterAll: 'All actions',
    syncLogsDateFrom: 'From',
    syncLogsDateTo: 'To',
    syncLogsLoadMore: 'Load more',
    syncLogPulledIds: 'Synced workspaces',
    lastSyncedBy: 'Last synced by',

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

    // Backup & Restore
    backupRestore: 'Backup & Restore',
    autoBackup: 'Auto Backup',
    backupEnabled: 'Enabled',
    backupDisabled: 'Disabled',
    backupTime: 'Backup Time',
    retentionDays: 'Retention Days',
    days: 'days',
    saveSettings: 'Save',
    settingsSaved: 'Settings saved',
    failedToSaveSettings: 'Failed to save settings.',
    backupNow: 'Backup Now',
    creatingBackup: 'Creating...',
    backupCreated: 'Backup created successfully.',
    failedToCreateBackup: 'Failed to create backup.',
    backupHistory: 'Backup History',
    noBackupsYet: 'No backups yet.',
    backupType: 'Type',
    backupTypeAuto: 'Auto',
    backupTypeManual: 'Manual',
    backupWorkspaces: 'Workspaces',
    backupUsers: 'Users',
    backupSize: 'Size',
    backupTime2: 'Time',
    backupNote: 'Note',
    downloadBackup: 'Download',
    restoreBackup: 'Restore',
    deleteBackup: 'Delete',
    deleteBackupConfirm: 'Delete this backup?',
    failedToDeleteBackup: 'Failed to delete backup.',
    failedToLoadBackups: 'Failed to load backups.',
    failedToLoadBackupSettings: 'Failed to load backup settings.',

    // Export with encryption
    exportBackup: 'Export Backup',
    exportDesc: 'Export your workspaces as a portable file. Can be imported by any user on any server.',
    encryptWithPassword: 'Encrypt with password',
    encryptPassword: 'Password',
    encryptPasswordConfirm: 'Confirm password',
    passwordMismatch: 'Passwords do not match.',
    passwordTooShort: 'Password must be at least 4 characters.',
    passwordWarning: 'Password cannot be recovered. Keep it safe.',
    encryptionRequiresHttps: 'Encryption requires a secure connection (HTTPS). Please access via HTTPS or localhost.',
    exporting: 'Exporting...',
    exportSuccess: 'Export complete.',

    // Import
    importBackup: 'Import Backup',
    importDesc: 'Import workspaces from a backup file (.json or encrypted .tabsy). Works across users and servers.',
    selectFile: 'Select backup file...',
    importFileAccept: '.json,.tabsy',
    encryptedFileDetected: 'This backup is encrypted.',
    enterDecryptPassword: 'Enter password to decrypt:',
    decryptPassword: 'Password',
    decrypt: 'Decrypt',
    decrypting: 'Decrypting...',
    decryptFailed: 'Decryption failed. Wrong password?',
    importPreview: 'Import Preview',
    importSource: 'Source',
    importCreatedAt: 'Created',
    importWorkspaceCount: '{n} workspace(s)',
    selectAll: 'Select All',
    deselectAll: 'Deselect All',
    conflictHandling: 'If workspace already exists:',
    conflictSkip: 'Skip existing',
    conflictOverwrite: 'Overwrite existing',
    conflictDuplicate: 'Keep both (create copy)',
    importSelected: 'Import Selected',
    importing: 'Importing...',
    importResult: 'Imported {imported}, skipped {skipped}.',
    noWorkspacesSelected: 'No workspaces selected.',
    failedToImport: 'Failed to import.',

    // Restore modal
    restorePreview: 'Restore Preview',
    restoreMode: 'Restore mode:',
    restoreMerge: 'Merge (keep existing, add missing)',
    restoreOverwrite: 'Overwrite (reset to backup state)',
    restoreWarning: 'A safety backup will be created before restoring.',
    confirmRestore: 'Confirm Restore',
    restoring: 'Restoring...',
    restoreResult: 'Restored {imported}, skipped {skipped}.',
    failedToRestore: 'Failed to restore.',

    // Admin: all users backups
    allUsersBackups: 'All Users\' Backups',
    allUsersBackupsDesc: 'View and manage backups for all users.',
  },

  'zh-TW': {
    workspaces: '工作區',
    settings: '設定',
    personalSettings: '個人設定',
    adminSettings: '管理區域',
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
    sAgo: '{n} 秒前',
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

    notesLabel: '筆記',
    noNotes: '尚無筆記。',
    addNote: '新增筆記',
    editNote: '編輯筆記',
    notesPlaceholder: '使用 Markdown 撰寫筆記...',
    preview: '預覽',
    edit: '編輯',
    addLink: '新增關聯',
    noLinks: '無關聯',
    unlinked: '未關聯',

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
    timezone: '時區',

    // Sync logs
    syncLogs: '同步紀錄',
    syncLogsDesc: '來自瀏覽器擴充功能的近期同步活動。',
    syncLogAction: '動作',
    syncLogClientId: '瀏覽器 ID',
    syncLogWorkspaces: '工作區',
    syncLogTime: '時間',
    syncLogPull: '拉取',
    syncLogPush: '推送',
    noSyncLogs: '尚無同步紀錄。',
    failedToLoadSyncLogs: '載入同步紀錄失敗。',
    noSyncChanges: '此次同步無變更明細。',
    syncChangesTitle: '變更明細',
    syncChangeCreated: '新增',
    syncChangeUpdated: '更新',
    syncChangeDeleted: '刪除',
    syncChangeName: '名稱',
    syncChangeColor: '顏色',
    syncChangeTabs: '分頁',
    syncChangeGroups: '群組',
    syncChangeFlows: '流程',
    syncChangeNotes: '筆記',
    syncChangeModified: '修改',
    syncChangeSavedAt: '儲存時間',
    syncChangeSynced: '資料已同步（無欄位變更）',
    syncChangeNotesModified: '筆記已編輯',
    syncLogsMore: '查看完整同步紀錄',
    syncLogsFilterAll: '全部動作',
    syncLogsDateFrom: '從',
    syncLogsDateTo: '到',
    syncLogsLoadMore: '載入更多',
    syncLogPulledIds: '同步的工作區',
    lastSyncedBy: '最後同步自',

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

    // Backup & Restore
    backupRestore: '備份與還原',
    autoBackup: '自動備份',
    backupEnabled: '已啟用',
    backupDisabled: '已停用',
    backupTime: '備份時間',
    retentionDays: '保留天數',
    days: '天',
    saveSettings: '儲存',
    settingsSaved: '設定已儲存',
    failedToSaveSettings: '儲存設定失敗。',
    backupNow: '立即備份',
    creatingBackup: '建立中...',
    backupCreated: '備份已成功建立。',
    failedToCreateBackup: '建立備份失敗。',
    backupHistory: '備份記錄',
    noBackupsYet: '尚無備份。',
    backupType: '類型',
    backupTypeAuto: '自動',
    backupTypeManual: '手動',
    backupWorkspaces: '工作區',
    backupUsers: '使用者',
    backupSize: '大小',
    backupTime2: '時間',
    backupNote: '備註',
    downloadBackup: '下載',
    restoreBackup: '還原',
    deleteBackup: '刪除',
    deleteBackupConfirm: '刪除此備份？',
    failedToDeleteBackup: '刪除備份失敗。',
    failedToLoadBackups: '載入備份失敗。',
    failedToLoadBackupSettings: '載入備份設定失敗。',

    // Export with encryption
    exportBackup: '匯出備份',
    exportDesc: '將您的工作區匯出為可攜式檔案。可由任何伺服器上的任何使用者匯入。',
    encryptWithPassword: '使用密碼加密',
    encryptPassword: '密碼',
    encryptPasswordConfirm: '確認密碼',
    passwordMismatch: '兩次密碼不一致。',
    passwordTooShort: '密碼至少需要 4 個字元。',
    passwordWarning: '密碼無法找回，請妥善保管。',
    encryptionRequiresHttps: '加密功能需要安全連線（HTTPS）。請透過 HTTPS 或 localhost 存取。',
    exporting: '匯出中...',
    exportSuccess: '匯出完成。',

    // Import
    importBackup: '匯入備份',
    importDesc: '從備份檔匯入工作區（.json 或加密的 .tabsy）。支援跨使用者與跨伺服器。',
    selectFile: '選擇備份檔...',
    importFileAccept: '.json,.tabsy',
    encryptedFileDetected: '此備份已加密。',
    enterDecryptPassword: '請輸入密碼以解密：',
    decryptPassword: '密碼',
    decrypt: '解密',
    decrypting: '解密中...',
    decryptFailed: '解密失敗，密碼錯誤？',
    importPreview: '匯入預覽',
    importSource: '來源',
    importCreatedAt: '建立時間',
    importWorkspaceCount: '{n} 個工作區',
    selectAll: '全選',
    deselectAll: '取消全選',
    conflictHandling: '工作區已存在時：',
    conflictSkip: '跳過已存在的',
    conflictOverwrite: '覆寫已存在的',
    conflictDuplicate: '兩者都保留（建立副本）',
    importSelected: '匯入選取的工作區',
    importing: '匯入中...',
    importResult: '已匯入 {imported} 個，跳過 {skipped} 個。',
    noWorkspacesSelected: '未選取任何工作區。',
    failedToImport: '匯入失敗。',

    // Restore modal
    restorePreview: '還原預覽',
    restoreMode: '還原模式：',
    restoreMerge: '合併（保留現有，補回缺少的）',
    restoreOverwrite: '覆寫（完全恢復到備份狀態）',
    restoreWarning: '還原前將自動建立安全備份。',
    confirmRestore: '確認還原',
    restoring: '還原中...',
    restoreResult: '已還原 {imported} 個，跳過 {skipped} 個。',
    failedToRestore: '還原失敗。',

    // Admin: all users backups
    allUsersBackups: '所有使用者的備份',
    allUsersBackupsDesc: '檢視及管理所有使用者的備份。',
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

// --- Timezone ---

const _detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let _timezone = _detectedTimezone;

export function getTimezone() {
  return _timezone;
}

export function setTimezone(tz) {
  if (tz) {
    _timezone = tz;
    localStorage.setItem('tabsyTimezone', tz);
  } else {
    _timezone = _detectedTimezone;
    localStorage.removeItem('tabsyTimezone');
  }
}

export function getDetectedTimezone() {
  return _detectedTimezone;
}

export function initTimezone() {
  const saved = localStorage.getItem('tabsyTimezone');
  _timezone = saved || _detectedTimezone;
}

export function getTimezoneList() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [_detectedTimezone];
  }
}

/**
 * Format an ISO date string using the current timezone setting.
 */
export function formatDateTime(iso, opts = {}) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleString(undefined, {
    timeZone: _timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
    ...opts
  });
}

export function formatDateTimeShort(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleString(undefined, {
    timeZone: _timezone,
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false
  });
}

// Initialize on load
initLocale();
initTimezone();
