import { api } from '../api.js';
import { t } from '../i18n.js';

export function render(container) {
  container.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h2>${t('setupTitle')}</h2>
        <p style="text-align:center;color:var(--color-text-secondary);margin-bottom:24px">${t('setupDesc')}</p>
        <div class="error-message" id="setup-error"></div>
        <form id="setup-form">
          <div class="form-group">
            <label for="username">${t('username')}</label>
            <input type="text" id="username" autocomplete="username" required minlength="3">
          </div>
          <div class="form-group">
            <label for="password">${t('password')}</label>
            <input type="password" id="password" autocomplete="new-password" required minlength="6">
          </div>
          <button type="submit" class="btn btn-primary btn-full">${t('setupButton')}</button>
        </form>
      </div>
    </div>
  `;

  const form = container.querySelector('#setup-form');
  const errorEl = container.querySelector('#setup-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.remove('visible');

    const username = form.querySelector('#username').value.trim();
    const password = form.querySelector('#password').value;
    const btn = form.querySelector('button[type="submit"]');

    btn.disabled = true;
    const reg = await api.post('/auth/register', { username, password });

    if (!reg.ok) {
      btn.disabled = false;
      errorEl.textContent = reg.data?.error || t('setupFailed');
      errorEl.classList.add('visible');
      return;
    }

    // Auto-login after registration
    const login = await api.post('/auth/login', { username, password });
    btn.disabled = false;

    if (login.ok) {
      window.dispatchEvent(new CustomEvent('auth-changed'));
      location.hash = '#/';
    } else {
      location.hash = '#/login';
    }
  });
}
