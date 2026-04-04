import { api } from '../api.js';
import { t } from '../i18n.js';

export function render(container) {
  container.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h2>${t('register')}</h2>
        <div class="error-message" id="register-error"></div>
        <form id="register-form">
          <div class="form-group">
            <label for="username">${t('username')}</label>
            <input type="text" id="username" autocomplete="username" required minlength="3">
          </div>
          <div class="form-group">
            <label for="password">${t('password')}</label>
            <input type="password" id="password" autocomplete="new-password" required minlength="6">
          </div>
          <button type="submit" class="btn btn-primary btn-full">${t('register')}</button>
        </form>
        <div class="auth-footer">
          ${t('alreadyHaveAccount')} <a href="#/login">${t('login')}</a>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('#register-form');
  const errorEl = container.querySelector('#register-error');

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
      errorEl.textContent = reg.data?.error || t('registrationFailed');
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
      // Registered but login failed — redirect to login page
      location.hash = '#/login';
    }
  });
}
