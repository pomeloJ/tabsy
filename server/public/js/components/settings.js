import { api } from '../api.js';

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Settings</h1>
    </div>

    <section class="settings-section">
      <h2>Sync Tokens</h2>
      <p class="settings-desc">Create tokens for your browser extensions to sync workspaces with this server.</p>

      <div class="token-create-form" id="token-form">
        <input type="text" id="token-name" class="search-input" placeholder="Token name (e.g. My Laptop)">
        <button class="btn btn-primary btn-inline" id="create-token-btn">Create Token</button>
      </div>

      <div class="token-created-banner" id="token-banner" style="display:none">
        <p><strong>Token created!</strong> Copy it now — it won't be shown again.</p>
        <code class="token-value" id="token-value"></code>
        <button class="btn btn-ghost btn-sm" id="copy-token-btn">Copy</button>
      </div>

      <div id="token-list"></div>
    </section>
  `;

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
      tokenListEl.innerHTML = '<p class="empty-state">Failed to load tokens.</p>';
      return;
    }
    renderTokens(data.tokens);
  }

  function renderTokens(tokens) {
    if (tokens.length === 0) {
      tokenListEl.innerHTML = '<p class="empty-state">No tokens yet.</p>';
      return;
    }

    tokenListEl.innerHTML = `
      <table class="token-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Created</th>
            <th>Last Used</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${tokens.map(t => `
            <tr>
              <td>${escapeHtml(t.name) || '<em>unnamed</em>'}</td>
              <td>${formatTime(t.createdAt)}</td>
              <td>${t.lastUsedAt ? formatTime(t.lastUsedAt) : 'Never'}</td>
              <td><button class="btn btn-danger btn-sm" data-revoke="${t.id}">Revoke</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    tokenListEl.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Revoke this token? Extensions using it will lose access.')) return;
        btn.disabled = true;
        const res = await api.del(`/auth/tokens/${btn.dataset.revoke}`);
        if (res.ok) {
          await loadTokens();
        } else {
          btn.disabled = false;
          alert('Failed to revoke token.');
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
      alert(data?.error || 'Failed to create token.');
    }
  });

  // Copy token
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(tokenValueEl.textContent).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
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
