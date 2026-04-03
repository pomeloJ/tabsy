import { api } from './api.js';
import { render as renderLogin } from './components/login.js';
import { render as renderRegister } from './components/register.js';
import { render as renderDashboard } from './components/dashboard.js';
import { render as renderSettings } from './components/settings.js';

const appEl = document.getElementById('app');
const navRight = document.getElementById('nav-right');

let currentUser = null;

// --- Auth state ---
async function checkAuth() {
  const { ok, data } = await api.get('/auth/me');
  currentUser = ok ? data : null;
  updateNav();
  return currentUser;
}

function updateNav() {
  if (currentUser) {
    navRight.innerHTML = `
      <a href="#/" class="btn btn-ghost">Workspaces</a>
      <a href="#/settings" class="btn btn-ghost">Settings</a>
      <span class="nav-user">${currentUser.username}</span>
      <button class="btn btn-ghost" id="logout-btn">Logout</button>
    `;
    navRight.querySelector('#logout-btn').addEventListener('click', async () => {
      await api.post('/auth/logout');
      currentUser = null;
      updateNav();
      location.hash = '#/login';
    });
  } else {
    navRight.innerHTML = `<a href="#/login" class="btn btn-ghost">Login</a>`;
  }
}

// --- Router ---
const guestRoutes = {
  '#/login': renderLogin,
  '#/register': renderRegister
};

const authRoutes = {
  '#/': renderDashboard,
  '#/settings': renderSettings
};

async function route() {
  const hash = location.hash || '#/';

  // Guest routes (login, register)
  if (guestRoutes[hash]) {
    if (currentUser) {
      location.hash = '#/';
      return;
    }
    guestRoutes[hash](appEl);
    return;
  }

  // Auth routes — require login
  if (!currentUser) {
    location.hash = '#/login';
    return;
  }

  const renderer = authRoutes[hash];
  if (renderer) {
    renderer(appEl);
  } else {
    // Default: redirect to dashboard
    location.hash = '#/';
  }
}

// --- Init ---
window.addEventListener('hashchange', route);
window.addEventListener('auth-changed', async () => {
  await checkAuth();
  route();
});

await checkAuth();
if (!location.hash || location.hash === '#') {
  location.hash = currentUser ? '#/' : '#/login';
}
route();
