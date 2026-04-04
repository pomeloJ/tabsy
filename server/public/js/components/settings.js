import { api } from '../api.js';
import { t, getLocale, setLocale, getAvailableLocales, getTimezone, setTimezone, getDetectedTimezone, getTimezoneList, formatDateTime } from '../i18n.js';

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
  if (!isAdmin) return;

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
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  return formatDateTime(iso);
}
