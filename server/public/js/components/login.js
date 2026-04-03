import { api } from '../api.js';

export function render(container) {
  container.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h2>Login</h2>
        <div class="error-message" id="login-error"></div>
        <form id="login-form">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" autocomplete="username" required>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn-primary">Login</button>
        </form>
        <div class="auth-footer">
          Don't have an account? <a href="#/register">Register</a>
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
      errorEl.textContent = data?.error || 'Login failed';
      errorEl.classList.add('visible');
    }
  });
}
