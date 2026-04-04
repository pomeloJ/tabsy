import { api } from '../api.js';
import { t } from '../i18n.js';

export function render(container) {
  container.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h2>${t('login')}</h2>
        <div class="error-message" id="login-error"></div>
        <form id="login-form">
          <div class="form-group">
            <label for="username">${t('username')}</label>
            <input type="text" id="username" autocomplete="username" required>
          </div>
          <div class="form-group">
            <label for="password">${t('password')}</label>
            <input type="password" id="password" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn-primary btn-full">${t('login')}</button>
        </form>
        <div class="auth-footer">
          ${t('noAccount')} <a href="#/register">${t('register')}</a>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const errorEl = container.querySelector('#login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.remove('visible');

    const username = form.querySelector('#username').value.trim();
    const password = form.querySelector('#password').value;
    const btn = form.querySelector('button[type="submit"]');

    btn.disabled = true;
    const { ok, data } = await api.post('/auth/login', { username, password });
    btn.disabled = false;

    if (ok) {
      window.dispatchEvent(new CustomEvent('auth-changed'));
      location.hash = '#/';
    } else {
      errorEl.textContent = data?.error || t('loginFailed');
      errorEl.classList.add('visible');
    }
  });
}
