import { api } from '../api.js';
import { t, getLocale, setLocale, getAvailableLocales } from '../i18n.js';

export async function render(container) {
  const locales = getAvailableLocales();
  const currentLocale = getLocale();

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
  `;

  // --- Language selector ---
  container.querySelector('#lang-select').addEventListener('change', (e) => {
    setLocale(e.target.value);
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
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
