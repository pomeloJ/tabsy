import { api } from './api.js';
import { t, setLocale, getLocale, getAvailableLocales, initLocale } from './i18n.js';
import { render as renderLogin } from './components/login.js';
import { render as renderRegister } from './components/register.js';
import { render as renderDashboard } from './components/dashboard.js';
import { render as renderSettings } from './components/settings.js';
import { render as renderWorkspace } from './components/workspace.js';

const appEl = document.getElementById('app');
const sidebar = document.getElementById('sidebar');
const sidebarNav = document.getElementById('sidebar-nav');
const sidebarFooter = document.getElementById('sidebar-footer');
const sidebarClose = document.getElementById('sidebar-close');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const topbar = document.getElementById('topbar');
const topbarTitle = document.getElementById('topbar-title');
const topbarMenu = document.getElementById('topbar-menu');
const bottomnav = document.getElementById('bottomnav');

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
    document.body.classList.remove('guest');

    sidebarNav.innerHTML = `
      <a href="#/" class="sidebar-link" data-route="/">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        ${t('workspaces')}
      </a>
      <a href="#/settings" class="sidebar-link" data-route="/settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        ${t('settings')}
      </a>
    `;

    sidebarFooter.innerHTML = `
      <div class="sidebar-user">${escapeHtml(currentUser.username)}</div>
      <button class="sidebar-logout" id="logout-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        ${t('logout')}
      </button>
    `;

    sidebarFooter.querySelector('#logout-btn').addEventListener('click', async () => {
      await api.post('/auth/logout');
      currentUser = null;
      updateNav();
      location.hash = '#/login';
    });
  } else {
    document.body.classList.add('guest');
    sidebarNav.innerHTML = '';
    sidebarFooter.innerHTML = '';
  }

  updateActiveNav();
}

function updateActiveNav() {
  const hash = location.hash || '#/';

  // Sidebar links
  sidebarNav.querySelectorAll('.sidebar-link').forEach(link => {
    const route = link.dataset.route;
    // Mark active if exact match, or if hash starts with /workspace and route is /
    const isActive = hash === '#' + route ||
      (route === '/' && hash.startsWith('#/workspace/'));
    link.classList.toggle('active', isActive);
  });

  // Bottom nav
  bottomnav.querySelectorAll('.bottomnav-item').forEach(item => {
    const route = item.dataset.route;
    const isActive = hash === '#' + route ||
      (route === '/' && hash.startsWith('#/workspace/'));
    item.classList.toggle('active', isActive);
  });
}

// --- Sidebar toggle (tablet/mobile) ---
function openSidebar() {
  sidebar.classList.add('open');
}

function closeSidebar() {
  sidebar.classList.remove('open');
}

topbarMenu.addEventListener('click', openSidebar);
sidebarClose.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

// Close sidebar on nav link click (mobile)
sidebarNav.addEventListener('click', (e) => {
  if (e.target.closest('.sidebar-link')) {
    closeSidebar();
  }
});

// --- Router ---
const guestRoutes = {
  '#/login': renderLogin,
  '#/register': renderRegister
};

const authRoutes = {
  '#/': renderDashboard,
  '#/settings': renderSettings
};

// Dynamic route patterns
const dynamicAuthRoutes = [
  {
    pattern: /^#\/workspace\/(.+)$/,
    render: (container, params) => renderWorkspace(container, params[0])
  }
];

async function route() {
  const hash = location.hash || '#/';

  // Guest routes
  if (guestRoutes[hash]) {
    if (currentUser) {
      location.hash = '#/';
      return;
    }
    guestRoutes[hash](appEl);
    updateActiveNav();
    updateTopbarTitle(hash);
    return;
  }

  // Auth required
  if (!currentUser) {
    location.hash = '#/login';
    return;
  }

  // Exact auth routes
  const renderer = authRoutes[hash];
  if (renderer) {
    renderer(appEl);
    updateActiveNav();
    updateTopbarTitle(hash);
    return;
  }

  // Dynamic auth routes
  for (const dr of dynamicAuthRoutes) {
    const match = hash.match(dr.pattern);
    if (match) {
      dr.render(appEl, match.slice(1));
      updateActiveNav();
      updateTopbarTitle(hash);
      return;
    }
  }

  // Default
  location.hash = '#/';
}

function updateTopbarTitle(hash) {
  if (hash.startsWith('#/workspace/')) {
    topbarTitle.textContent = t('workspace');
  } else if (hash === '#/settings') {
    topbarTitle.textContent = t('settings');
  } else {
    topbarTitle.textContent = 'Tabsy';
  }
}

// --- Init ---
window.addEventListener('hashchange', route);
window.addEventListener('auth-changed', async () => {
  await checkAuth();
  route();
});

// Apply i18n to static elements
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

// Listen for locale changes
window.addEventListener('locale-changed', () => {
  applyI18n();
  updateNav();
  route();
});

await checkAuth();
applyI18n();
if (!location.hash || location.hash === '#') {
  location.hash = currentUser ? '#/' : '#/login';
}
route();

// --- Util ---
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
