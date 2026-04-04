import { api } from '../api.js';
import { t, getLocale, setLocale, getAvailableLocales, getTimezone, setTimezone, getDetectedTimezone, getTimezoneList, formatDateTime } from '../i18n.js';
import { encryptBackup, decryptBackup, isEncryptedBackup, downloadFile } from '../crypto.js';

export async function render(container, currentUser) {
  const locales = getAvailableLocales();
  const currentLocale = getLocale();
  const isAdmin = currentUser && currentUser.role === 'admin';

  container.innerHTML = `
    <div class="page-header">
      <h1>${t('settings')}</h1>
    </div>

    <section class="settings-section">
      <h2>${t('language')}</h2>
      <div class="token-create-form">
        <select id="lang-select" class="search-input" style="max-width:200px">
          ${locales.map(l => `<option value="${l.code}" ${l.code === currentLocale ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>
      </div>
    </section>

    <section class="settings-section">
      <h2>${t('timezone')}</h2>
      <div class="token-create-form">
        <select id="tz-select" class="search-input" style="max-width:320px">
        </select>
      </div>
    </section>

    <section class="settings-section">
      <h2>${t('syncTokens')}</h2>
      <p class="settings-desc">${t('syncTokensDesc')}</p>

      <div class="token-create-form" id="token-form">
        <input type="text" id="token-name" class="search-input" placeholder="${t('tokenNamePlaceholder')}">
        <button class="btn btn-primary btn-inline" id="create-token-btn">${t('createToken')}</button>
      </div>

      <div class="token-created-banner" id="token-banner" style="display:none">
        <p><strong>${t('tokenCreated')}</strong> ${t('tokenCopyWarning')}</p>
        <code class="token-value" id="token-value"></code>
        <button class="btn btn-ghost btn-sm" id="copy-token-btn">${t('copy')}</button>
      </div>

      <div id="token-list"></div>
    </section>

    <section class="settings-section">
      <h2>${t('syncLogs')}</h2>
      <p class="settings-desc">${t('syncLogsDesc')}</p>
      <div id="sync-logs-list"></div>
    </section>

    ${isAdmin ? `
    <section class="settings-section">
      <h2>${t('userManagement')}</h2>
      <p class="settings-desc">${t('userManagementDesc')}</p>

      <div class="token-create-form" id="add-user-form">
        <input type="text" id="new-username" class="search-input" placeholder="${t('usernamePlaceholder')}" style="flex:1">
        <input type="password" id="new-password" class="search-input" placeholder="${t('passwordPlaceholder')}" style="flex:1">
        <select id="new-role" class="search-input" style="max-width:140px">
          <option value="user">${t('roleUser')}</option>
          <option value="admin">${t('roleAdmin')}</option>
        </select>
        <button class="btn btn-primary btn-inline" id="add-user-btn">${t('addUser')}</button>
      </div>

      <div id="user-list"></div>
    </section>
    ` : ''}

    <section class="settings-section">
      <h2>${t('backupRestore')}</h2>

      <div class="backup-settings-row" id="backup-settings-area">
        <div class="token-create-form" style="flex-wrap:wrap;gap:10px">
          <label class="backup-toggle-label">
            <span>${t('autoBackup')}</span>
            <input type="checkbox" id="backup-enabled">
            <span class="backup-toggle-status" id="backup-status-text"></span>
          </label>
          <label style="display:flex;align-items:center;gap:6px">
            <span>${t('backupTime')}</span>
            <input type="time" id="backup-time" class="search-input" style="width:120px">
          </label>
          <label style="display:flex;align-items:center;gap:6px">
            <span>${t('retentionDays')}</span>
            <input type="number" id="backup-retention" class="search-input" style="width:80px" min="1" max="365">
            <span>${t('days')}</span>
          </label>
          <button class="btn btn-primary btn-inline btn-sm" id="save-backup-settings-btn">${t('saveSettings')}</button>
        </div>
      </div>

      <div style="margin:12px 0;display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" id="backup-now-btn">${t('backupNow')}</button>
      </div>

      <h3 style="margin-top:16px;margin-bottom:8px;font-size:0.9rem;color:var(--color-text-secondary)">${t('backupHistory')}</h3>
      <div id="backup-list"></div>
    </section>

    ${isAdmin ? `
    <section class="settings-section">
      <h2>${t('allUsersBackups')}</h2>
      <p class="settings-desc">${t('allUsersBackupsDesc')}</p>
      <div id="all-backup-list"></div>
    </section>
    ` : ''}

    <section class="settings-section">
      <h2>${t('exportBackup')}</h2>
      <p class="settings-desc">${t('exportDesc')}</p>

      <div style="margin:8px 0">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="export-encrypt-check">
          <span>${t('encryptWithPassword')}</span>
        </label>
      </div>

      <div id="export-password-area" style="display:none;margin:8px 0">
        <div class="token-create-form" style="flex-wrap:wrap;gap:8px">
          <input type="password" id="export-pw1" class="search-input" placeholder="${t('encryptPassword')}" style="max-width:200px">
          <input type="password" id="export-pw2" class="search-input" placeholder="${t('encryptPasswordConfirm')}" style="max-width:200px">
        </div>
        <p class="settings-desc" style="margin-top:6px;color:var(--color-danger);font-size:0.8rem">${t('passwordWarning')}</p>
      </div>

      <button class="btn btn-primary btn-sm" id="export-backup-btn">${t('exportBackup')}</button>
    </section>

    <section class="settings-section">
      <h2>${t('importBackup')}</h2>
      <p class="settings-desc">${t('importDesc')}</p>

      <button class="btn btn-outline btn-sm" id="import-backup-btn">${t('selectFile')}</button>
      <input type="file" id="import-backup-file" accept=".json,.tabsy" style="display:none">

      <div id="import-preview-area" style="display:none;margin-top:12px"></div>
    </section>
  `;

  // --- Language selector ---
  container.querySelector('#lang-select').addEventListener('change', (e) => {
    setLocale(e.target.value);
    window.dispatchEvent(new CustomEvent('locale-changed'));
  });

  // --- Timezone selector ---
  const tzSelectEl = container.querySelector('#tz-select');
  const detected = getDetectedTimezone();
  const currentTz = getTimezone();
  const savedTz = localStorage.getItem('tabsyTimezone');
  const zones = getTimezoneList();
  const autoLabel = `Auto (${detected})`;
  tzSelectEl.innerHTML = `<option value="">${autoLabel}</option>` +
    zones.map(z => `<option value="${z}">${z}</option>`).join('');
  tzSelectEl.value = savedTz || '';

  tzSelectEl.addEventListener('change', (e) => {
    setTimezone(e.target.value || '');
    window.dispatchEvent(new CustomEvent('locale-changed'));
  });

  const tokenListEl = container.querySelector('#token-list');
  const nameInput = container.querySelector('#token-name');
  const createBtn = container.querySelector('#create-token-btn');
  const banner = container.querySelector('#token-banner');
  const tokenValueEl = container.querySelector('#token-value');
  const copyBtn = container.querySelector('#copy-token-btn');

  // Load tokens
  async function loadTokens() {
    const { ok, data } = await api.get('/auth/tokens');
    if (!ok) {
      tokenListEl.innerHTML = `<p class="empty-state">${t('failedToLoadTokens')}</p>`;
      return;
    }
    renderTokens(data.tokens);
  }

  function renderTokens(tokens) {
    if (tokens.length === 0) {
      tokenListEl.innerHTML = `<p class="empty-state">${t('noTokensYet')}</p>`;
      return;
    }

    tokenListEl.innerHTML = `
      <table class="token-table">
        <thead>
          <tr>
            <th>${t('tokenName')}</th>
            <th>${t('tokenCreatedAt')}</th>
            <th>${t('tokenLastUsed')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${tokens.map(tk => `
            <tr>
              <td>${escapeHtml(tk.name) || '<em>unnamed</em>'}</td>
              <td>${formatTime(tk.createdAt)}</td>
              <td>${tk.lastUsedAt ? formatTime(tk.lastUsedAt) : t('never')}</td>
              <td><button class="btn btn-danger btn-sm" data-revoke="${tk.id}">${t('revoke')}</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    tokenListEl.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('revokeConfirm'))) return;
        btn.disabled = true;
        const res = await api.del(`/auth/tokens/${btn.dataset.revoke}`);
        if (res.ok) {
          await loadTokens();
        } else {
          btn.disabled = false;
          alert(t('failedToRevokeToken'));
        }
      });
    });
  }

  // Create token
  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    createBtn.disabled = true;
    const { ok, data } = await api.post('/auth/tokens', { name });
    createBtn.disabled = false;

    if (ok) {
      nameInput.value = '';
      tokenValueEl.textContent = data.token;
      banner.style.display = 'flex';
      await loadTokens();
    } else {
      alert(data?.error || t('failedToCreateToken'));
    }
  });

  // Copy token
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(tokenValueEl.textContent).then(() => {
      copyBtn.textContent = t('copied');
      setTimeout(() => { copyBtn.textContent = t('copy'); }, 2000);
    });
  });

  await loadTokens();

  // === Sync Logs ===
  const syncLogsListEl = container.querySelector('#sync-logs-list');

  async function loadSyncLogs() {
    const { ok, data } = await api.get('/sync/logs?limit=30');
    if (!ok) {
      syncLogsListEl.innerHTML = `<p class="empty-state">${t('failedToLoadSyncLogs')}</p>`;
      return;
    }
    renderSyncLogs(data.logs);
  }

  function renderSyncLogs(logs) {
    if (!logs || logs.length === 0) {
      syncLogsListEl.innerHTML = `<p class="empty-state">${t('noSyncLogs')}</p>`;
      return;
    }

    syncLogsListEl.innerHTML = `
      <table class="token-table">
        <thead>
          <tr>
            <th>${t('syncLogAction')}</th>
            <th>${t('syncLogClientId')}</th>
            <th>${t('syncLogWorkspaces')}</th>
            <th>${t('syncLogTime')}</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(log => `
            <tr>
              <td><span class="sync-action-badge sync-action-${log.action}">${log.action === 'push' ? t('syncLogPush') : t('syncLogPull')}</span></td>
              <td><code style="font-size:11px;background:#f0f0f0;padding:2px 6px;border-radius:3px" title="${escapeHtml(log.clientId)}">${escapeHtml(log.clientId.substring(0, 8))}…</code></td>
              <td>${log.workspaceCount}</td>
              <td>${formatTime(log.createdAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  await loadSyncLogs();

  // === Admin: User Management ===
  if (!isAdmin) {
    // Skip user management, go straight to backup section
    await initBackupSection(container);
    return;
  }

  const userListEl = container.querySelector('#user-list');
  const addUserBtn = container.querySelector('#add-user-btn');
  const newUsernameInput = container.querySelector('#new-username');
  const newPasswordInput = container.querySelector('#new-password');
  const newRoleSelect = container.querySelector('#new-role');

  async function loadUsers() {
    const { ok, data } = await api.get('/auth/users');
    if (!ok) {
      userListEl.innerHTML = `<p class="empty-state">${t('failedToLoadUsers')}</p>`;
      return;
    }
    renderUsers(data.users);
  }

  function renderUsers(users) {
    if (users.length <= 1) {
      userListEl.innerHTML = `<p class="empty-state">${t('noOtherUsers')}</p>`;
      return;
    }

    userListEl.innerHTML = `
      <table class="token-table">
        <thead>
          <tr>
            <th>${t('usernamePlaceholder')}</th>
            <th>${t('role')}</th>
            <th>${t('createdAt')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>${escapeHtml(u.username)} ${u.id === currentUser.id ? `<span style="color:var(--color-text-tertiary)">${t('you')}</span>` : ''}</td>
              <td>${u.role === 'admin' ? t('roleAdmin') : t('roleUser')}</td>
              <td>${formatTime(u.createdAt)}</td>
              <td>
                ${u.id !== currentUser.id ? `
                  <button class="btn btn-ghost btn-sm" data-reset-pw="${u.id}" data-username="${escapeHtml(u.username)}">${t('resetPassword')}</button>
                  <button class="btn btn-danger btn-sm" data-delete-user="${u.id}" data-username="${escapeHtml(u.username)}">${t('deleteUser')}</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Reset password handlers
    userListEl.querySelectorAll('[data-reset-pw]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.username;
        const newPw = prompt(t('resetPasswordPrompt', { name }));
        if (!newPw) return;
        if (newPw.length < 6) {
          alert(t('failedToResetPassword'));
          return;
        }
        btn.disabled = true;
        const { ok } = await api.put(`/auth/users/${btn.dataset.resetPw}/password`, { password: newPw });
        btn.disabled = false;
        if (ok) {
          alert(t('passwordResetSuccess'));
        } else {
          alert(t('failedToResetPassword'));
        }
      });
    });

    // Delete user handlers
    userListEl.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.username;
        if (!confirm(t('deleteUserConfirm', { name }))) return;
        btn.disabled = true;
        const { ok } = await api.del(`/auth/users/${btn.dataset.deleteUser}`);
        if (ok) {
          await loadUsers();
        } else {
          btn.disabled = false;
          alert(t('failedToDeleteUser'));
        }
      });
    });
  }

  // Add user handler
  addUserBtn.addEventListener('click', async () => {
    const username = newUsernameInput.value.trim();
    const password = newPasswordInput.value;
    const role = newRoleSelect.value;

    if (!username || !password) return;

    addUserBtn.disabled = true;
    const { ok, data } = await api.post('/auth/users', { username, password, role });
    addUserBtn.disabled = false;

    if (ok) {
      newUsernameInput.value = '';
      newPasswordInput.value = '';
      newRoleSelect.value = 'user';
      await loadUsers();
    } else {
      alert(data?.error || t('failedToCreateUser'));
    }
  });

  await loadUsers();

  // === Admin: Backup Management ===
  await initBackupSection(container);
}

// === Backup Section (for all users) ===
async function initBackupSection(container) {
  const isAdmin = !!container.querySelector('#all-backup-list');

  // --- All users: backup settings & list ---
  const enabledCheck = container.querySelector('#backup-enabled');
  const timeInput = container.querySelector('#backup-time');
  const retentionInput = container.querySelector('#backup-retention');
  const statusText = container.querySelector('#backup-status-text');
  const saveBtn = container.querySelector('#save-backup-settings-btn');
  const backupNowBtn = container.querySelector('#backup-now-btn');
  const backupListEl = container.querySelector('#backup-list');

  // Load settings
  async function loadBackupSettings() {
    const { ok, data } = await api.get('/backups/settings');
    if (!ok) return;
    enabledCheck.checked = data.enabled;
    timeInput.value = data.time;
    retentionInput.value = data.retentionDays;
    statusText.textContent = data.enabled ? t('backupEnabled') : t('backupDisabled');
    statusText.style.color = data.enabled ? 'var(--color-success)' : 'var(--color-text-tertiary)';
  }

  enabledCheck.addEventListener('change', () => {
    statusText.textContent = enabledCheck.checked ? t('backupEnabled') : t('backupDisabled');
    statusText.style.color = enabledCheck.checked ? 'var(--color-success)' : 'var(--color-text-tertiary)';
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const { ok } = await api.put('/backups/settings', {
      enabled: enabledCheck.checked,
      time: timeInput.value,
      retentionDays: parseInt(retentionInput.value) || 30
    });
    saveBtn.disabled = false;
    if (ok) {
      alert(t('settingsSaved'));
    } else {
      alert(t('failedToSaveSettings'));
    }
  });

  // Backup now
  backupNowBtn.addEventListener('click', async () => {
    backupNowBtn.disabled = true;
    backupNowBtn.textContent = t('creatingBackup');
    const { ok } = await api.post('/backups', {});
    backupNowBtn.disabled = false;
    backupNowBtn.textContent = t('backupNow');
    if (ok) {
      alert(t('backupCreated'));
      await loadBackups();
    } else {
      alert(t('failedToCreateBackup'));
    }
  });

  // Load backup list
  async function loadBackups() {
    const { ok, data } = await api.get('/backups');
    if (!ok) {
      backupListEl.innerHTML = `<p class="empty-state">${t('failedToLoadBackups')}</p>`;
      return;
    }
    renderBackupTable(data.backups, backupListEl, false, loadBackups);
  }

  await loadBackupSettings();
  await loadBackups();

  // --- Admin: all users' backups ---
  if (isAdmin) {
    const allBackupListEl = container.querySelector('#all-backup-list');

    async function loadAllBackups() {
      const { ok, data } = await api.get('/backups/all');
      if (!ok) {
        allBackupListEl.innerHTML = `<p class="empty-state">${t('failedToLoadBackups')}</p>`;
        return;
      }
      renderBackupTable(data.backups, allBackupListEl, true, loadAllBackups);
    }

    await loadAllBackups();
  }

  // --- All users: Export ---
  const exportBtn = container.querySelector('#export-backup-btn');
  const encryptCheck = container.querySelector('#export-encrypt-check');
  const pwArea = container.querySelector('#export-password-area');
  const pw1Input = container.querySelector('#export-pw1');
  const pw2Input = container.querySelector('#export-pw2');

  encryptCheck.addEventListener('change', () => {
    pwArea.style.display = encryptCheck.checked ? 'block' : 'none';
  });

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = t('exporting');

    try {
      const { ok, data } = await api.post('/backups/export');
      if (!ok) throw new Error();

      const jsonStr = JSON.stringify(data, null, 2);
      const dateSuffix = new Date().toISOString().slice(0, 10);

      if (encryptCheck.checked) {
        const pw = pw1Input.value;
        const pw2 = pw2Input.value;
        if (pw.length < 4) { alert(t('passwordTooShort')); return; }
        if (pw !== pw2) { alert(t('passwordMismatch')); return; }

        const encrypted = await encryptBackup(jsonStr, pw);
        downloadFile(encrypted, `tabsy-backup-${dateSuffix}.tabsy`);
        pw1Input.value = '';
        pw2Input.value = '';
      } else {
        downloadFile(jsonStr, `tabsy-backup-${dateSuffix}.json`, 'application/json');
      }
    } catch {
      alert(t('failedToCreateBackup'));
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = t('exportBackup');
    }
  });

  // --- All users: Import ---
  const importBtn = container.querySelector('#import-backup-btn');
  const importFileInput = container.querySelector('#import-backup-file');
  const previewArea = container.querySelector('#import-preview-area');

  importBtn.addEventListener('click', () => importFileInput.click());

  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importFileInput.value = '';

    const buffer = await file.arrayBuffer();

    if (isEncryptedBackup(buffer)) {
      showDecryptThenImport(buffer, previewArea);
    } else {
      try {
        const text = new TextDecoder().decode(buffer);
        const data = JSON.parse(text);
        showImportPreview(data, previewArea);
      } catch {
        alert(t('failedToParseImport'));
      }
    }
  });
}

// --- Decrypt modal inline ---
function showDecryptThenImport(buffer, previewArea) {
  previewArea.style.display = 'block';
  previewArea.innerHTML = `
    <div class="backup-decrypt-box">
      <p style="margin-bottom:8px;font-weight:600">${t('encryptedFileDetected')}</p>
      <p style="margin-bottom:10px;font-size:0.875rem;color:var(--color-text-secondary)">${t('enterDecryptPassword')}</p>
      <div class="token-create-form" style="gap:8px">
        <input type="password" id="decrypt-pw-input" class="search-input" placeholder="${t('decryptPassword')}" style="max-width:240px">
        <button class="btn btn-primary btn-sm" id="decrypt-btn">${t('decrypt')}</button>
      </div>
      <p id="decrypt-error" style="display:none;margin-top:8px;color:var(--color-danger);font-size:0.85rem"></p>
    </div>
  `;

  const pwInput = previewArea.querySelector('#decrypt-pw-input');
  const decryptBtn = previewArea.querySelector('#decrypt-btn');
  const errorEl = previewArea.querySelector('#decrypt-error');

  setTimeout(() => pwInput.focus(), 50);

  const doDecrypt = async () => {
    const pw = pwInput.value;
    if (!pw) { pwInput.focus(); return; }

    decryptBtn.disabled = true;
    decryptBtn.textContent = t('decrypting');
    errorEl.style.display = 'none';

    try {
      const jsonStr = await decryptBackup(buffer, pw);
      const data = JSON.parse(jsonStr);
      showImportPreview(data, previewArea);
    } catch {
      errorEl.textContent = t('decryptFailed');
      errorEl.style.display = 'block';
      decryptBtn.disabled = false;
      decryptBtn.textContent = t('decrypt');
    }
  };

  decryptBtn.addEventListener('click', doDecrypt);
  pwInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doDecrypt();
  });
}

// --- Import preview ---
function showImportPreview(data, previewArea) {
  const workspaces = data.workspaces || [];
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    previewArea.style.display = 'block';
    previewArea.innerHTML = `<p class="empty-state">${t('invalidImportFile')}</p>`;
    return;
  }

  const source = data.source?.username || '—';
  const createdAt = data.createdAt || '—';

  previewArea.style.display = 'block';
  previewArea.innerHTML = `
    <div class="backup-import-preview">
      <h3 style="margin-bottom:8px">${t('importPreview')}</h3>
      <div style="font-size:0.875rem;color:var(--color-text-secondary);margin-bottom:10px">
        <span>${t('importSource')}: <strong>${escapeHtml(source)}</strong></span>
        &nbsp;|&nbsp;
        <span>${t('importCreatedAt')}: ${formatTime(createdAt)}</span>
        &nbsp;|&nbsp;
        <span>${t('importWorkspaceCount', { n: workspaces.length })}</span>
      </div>

      <div style="margin-bottom:8px">
        <button class="btn btn-ghost btn-sm" id="import-select-all">${t('selectAll')}</button>
        <button class="btn btn-ghost btn-sm" id="import-deselect-all">${t('deselectAll')}</button>
      </div>

      <div class="import-ws-list" style="max-height:240px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius);margin-bottom:10px">
        ${workspaces.map((ws, i) => {
          const tabCount = (ws.tabs || []).length;
          const groupCount = (ws.groups || []).length;
          return `
            <label class="import-ws-item" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--color-border);cursor:pointer">
              <input type="checkbox" class="import-ws-check" data-idx="${i}" checked>
              <span class="workspace-color-dot" style="background:${ws.color || '#888'};width:10px;height:10px;border-radius:50%;flex-shrink:0"></span>
              <span style="flex:1;font-size:0.875rem">${escapeHtml(ws.name || 'Untitled')}</span>
              <span style="font-size:0.75rem;color:var(--color-text-tertiary)">${tabCount} tabs, ${groupCount} groups</span>
            </label>
          `;
        }).join('')}
      </div>

      <div style="margin-bottom:10px">
        <label style="font-size:0.875rem;font-weight:500">${t('conflictHandling')}</label>
        <div style="margin-top:4px;display:flex;flex-direction:column;gap:4px">
          <label style="font-size:0.85rem;cursor:pointer"><input type="radio" name="import-conflict" value="merge" checked> ${t('conflictSkip')}</label>
          <label style="font-size:0.85rem;cursor:pointer"><input type="radio" name="import-conflict" value="overwrite"> ${t('conflictOverwrite')}</label>
          <label style="font-size:0.85rem;cursor:pointer"><input type="radio" name="import-conflict" value="duplicate"> ${t('conflictDuplicate')}</label>
        </div>
      </div>

      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="do-import-btn">${t('importSelected')}</button>
        <button class="btn btn-ghost btn-sm" id="cancel-import-btn">${t('cancel')}</button>
      </div>
    </div>
  `;

  // Select/deselect all
  previewArea.querySelector('#import-select-all').addEventListener('click', () => {
    previewArea.querySelectorAll('.import-ws-check').forEach(cb => cb.checked = true);
  });
  previewArea.querySelector('#import-deselect-all').addEventListener('click', () => {
    previewArea.querySelectorAll('.import-ws-check').forEach(cb => cb.checked = false);
  });

  // Cancel
  previewArea.querySelector('#cancel-import-btn').addEventListener('click', () => {
    previewArea.style.display = 'none';
    previewArea.innerHTML = '';
  });

  // Import
  previewArea.querySelector('#do-import-btn').addEventListener('click', async () => {
    const checked = previewArea.querySelectorAll('.import-ws-check:checked');
    if (checked.length === 0) {
      alert(t('noWorkspacesSelected'));
      return;
    }

    const selectedIndices = new Set([...checked].map(cb => parseInt(cb.dataset.idx)));
    const selectedWs = workspaces.filter((_, i) => selectedIndices.has(i));
    const mode = previewArea.querySelector('input[name="import-conflict"]:checked')?.value || 'merge';

    const importBtn = previewArea.querySelector('#do-import-btn');
    importBtn.disabled = true;
    importBtn.textContent = t('importing');

    const { ok, data: result } = await api.post('/backups/import', {
      workspaces: selectedWs,
      mode
    });

    if (ok) {
      alert(t('importResult', { imported: result.imported, skipped: result.skipped }));
      previewArea.style.display = 'none';
      previewArea.innerHTML = '';
    } else {
      alert(t('failedToImport'));
      importBtn.disabled = false;
      importBtn.textContent = t('importSelected');
    }
  });
}

// --- Shared backup table renderer ---
function renderBackupTable(backups, containerEl, showUsername, onRefresh) {
  if (!backups || backups.length === 0) {
    containerEl.innerHTML = `<p class="empty-state">${t('noBackupsYet')}</p>`;
    return;
  }

  containerEl.innerHTML = `
    <table class="token-table">
      <thead>
        <tr>
          ${showUsername ? `<th>${t('usernamePlaceholder')}</th>` : ''}
          <th>${t('backupType')}</th>
          <th>${t('backupWorkspaces')}</th>
          <th>${t('backupSize')}</th>
          <th>${t('backupTime2')}</th>
          <th>${t('backupNote')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${backups.map(b => `
          <tr>
            ${showUsername ? `<td>${escapeHtml(b.username || '—')}</td>` : ''}
            <td><span class="sync-action-badge sync-action-${b.type === 'auto' ? 'pull' : 'push'}">${b.type === 'auto' ? t('backupTypeAuto') : t('backupTypeManual')}</span></td>
            <td>${b.workspaceCount}</td>
            <td>${formatSize(b.size)}</td>
            <td>${formatTime(b.createdAt)}</td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(b.note || '')}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-backup-download="${b.id}">${t('downloadBackup')}</button>
              <button class="btn btn-ghost btn-sm" data-backup-restore="${b.id}" data-ws-count="${b.workspaceCount}">${t('restoreBackup')}</button>
              <button class="btn btn-danger btn-sm" data-backup-delete="${b.id}">${t('deleteBackup')}</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Download handlers
  containerEl.querySelectorAll('[data-backup-download]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.backupDownload;
      btn.disabled = true;
      try {
        const resp = await fetch(`/api/backups/${id}/download`);
        if (!resp.ok) throw new Error();
        const jsonStr = await resp.text();

        const wantEncrypt = confirm(t('encryptWithPassword') + '?');
        if (wantEncrypt) {
          const pw = prompt(t('encryptPassword'));
          if (!pw) { btn.disabled = false; return; }
          const pw2 = prompt(t('encryptPasswordConfirm'));
          if (pw !== pw2) { alert(t('passwordMismatch')); btn.disabled = false; return; }
          if (pw.length < 4) { alert(t('passwordTooShort')); btn.disabled = false; return; }

          const encrypted = await encryptBackup(jsonStr, pw);
          downloadFile(encrypted, `tabsy-backup-${new Date().toISOString().slice(0, 10)}.tabsy`);
        } else {
          downloadFile(jsonStr, `tabsy-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
        }
      } catch {
        alert(t('failedToLoadBackups'));
      }
      btn.disabled = false;
    });
  });

  // Restore handlers
  containerEl.querySelectorAll('[data-backup-restore]').forEach(btn => {
    btn.addEventListener('click', () => {
      showRestoreModal(btn.dataset.backupRestore, btn.dataset.wsCount, onRefresh);
    });
  });

  // Delete handlers
  containerEl.querySelectorAll('[data-backup-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('deleteBackupConfirm'))) return;
      btn.disabled = true;
      const { ok } = await api.del(`/backups/${btn.dataset.backupDelete}`);
      if (ok) {
        if (onRefresh) await onRefresh();
      } else {
        btn.disabled = false;
        alert(t('failedToDeleteBackup'));
      }
    });
  });
}

// --- Restore modal ---
function showRestoreModal(backupId, wsCount, onDone) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>${t('restorePreview')}</h2>
        <button class="btn-icon modal-close" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom:12px">${t('importWorkspaceCount', { n: wsCount })}</p>

        <label style="font-size:0.875rem;font-weight:500">${t('restoreMode')}</label>
        <div style="margin-top:4px;display:flex;flex-direction:column;gap:4px;margin-bottom:12px">
          <label style="font-size:0.85rem;cursor:pointer"><input type="radio" name="restore-mode" value="merge" checked> ${t('restoreMerge')}</label>
          <label style="font-size:0.85rem;cursor:pointer"><input type="radio" name="restore-mode" value="overwrite"> ${t('restoreOverwrite')}</label>
        </div>

        <p style="font-size:0.85rem;color:var(--color-text-secondary)">${t('restoreWarning')}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost modal-cancel">${t('cancel')}</button>
        <button class="btn btn-primary" id="confirm-restore-btn">${t('confirmRestore')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('.modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#confirm-restore-btn').addEventListener('click', async () => {
    const mode = overlay.querySelector('input[name="restore-mode"]:checked')?.value || 'merge';
    const btn = overlay.querySelector('#confirm-restore-btn');
    btn.disabled = true;
    btn.textContent = t('restoring');

    const { ok, data } = await api.post(`/backups/${backupId}/restore`, { mode });
    if (ok) {
      close();
      alert(t('restoreResult', { imported: data.imported, skipped: data.skipped }));
      if (onDone) await onDone();
    } else {
      alert(t('failedToRestore'));
      btn.disabled = false;
      btn.textContent = t('confirmRestore');
    }
  });
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  return formatDateTime(iso);
}
