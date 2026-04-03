import { api } from '../api.js';

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Workspaces</h1>
    </div>
    <div class="dashboard-toolbar">
      <input type="text" class="search-input" id="search" placeholder="Search workspaces...">
      <select class="sort-select" id="sort">
        <option value="savedAt">Sort by time</option>
        <option value="name">Sort by name</option>
      </select>
    </div>
    <div id="workspace-list" class="workspace-list"></div>
  `;

  const listEl = container.querySelector('#workspace-list');
  const searchEl = container.querySelector('#search');
  const sortEl = container.querySelector('#sort');

  const { ok, data } = await api.get('/workspaces');
  if (!ok) {
    listEl.innerHTML = '<div class="empty-state"><p>Failed to load workspaces.</p></div>';
    return;
  }

  let workspaces = data.workspaces;

  function renderList() {
    const query = searchEl.value.trim().toLowerCase();
    const sortBy = sortEl.value;

    let filtered = workspaces;
    if (query) {
      filtered = filtered.filter(w => w.name.toLowerCase().includes(query));
    }

    filtered.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return new Date(b.savedAt) - new Date(a.savedAt);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>No workspaces found.</p></div>';
      return;
    }

    listEl.innerHTML = filtered.map(w => `
      <div class="workspace-card" style="border-left-color: ${w.color}" data-id="${w.id}">
        <div class="workspace-card-header">
          <span class="workspace-color-dot" style="background: ${w.color}"></span>
          <span class="workspace-name">${escapeHtml(w.name)}</span>
        </div>
        <div class="workspace-card-meta">
          <span>${w.tabCount} tab${w.tabCount !== 1 ? 's' : ''}</span>
          <span>${w.groupCount} group${w.groupCount !== 1 ? 's' : ''}</span>
          <span>${formatTime(w.savedAt)}</span>
        </div>
        <div class="workspace-card-actions">
          <button class="btn btn-danger btn-sm" data-delete="${w.id}">Delete</button>
        </div>
      </div>
    `).join('');

    // Delete handlers
    listEl.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        const ws = workspaces.find(w => w.id === id);
        if (!confirm(`Delete "${ws?.name}"?`)) return;

        btn.disabled = true;
        const res = await api.del(`/workspaces/${id}`);
        if (res.ok) {
          workspaces = workspaces.filter(w => w.id !== id);
          renderList();
        } else {
          btn.disabled = false;
          alert('Failed to delete workspace.');
        }
      });
    });
  }

  searchEl.addEventListener('input', renderList);
  sortEl.addEventListener('change', renderList);
  renderList();
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
