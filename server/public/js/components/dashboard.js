import { api } from '../api.js';

const GROUP_COLORS = {
  blue: '#1a73e8',
  cyan: '#007b83',
  green: '#188038',
  grey: '#5f6368',
  orange: '#e8710a',
  pink: '#d01884',
  purple: '#9334e6',
  red: '#d93025',
  yellow: '#f9ab00'
};

const WS_COLORS = [
  { hex: '#0078d4', name: 'Blue' },
  { hex: '#107c10', name: 'Green' },
  { hex: '#d13438', name: 'Red' },
  { hex: '#ca5010', name: 'Orange' },
  { hex: '#881798', name: 'Purple' },
  { hex: '#038387', name: 'Cyan' },
  { hex: '#e3008c', name: 'Pink' },
  { hex: '#69797e', name: 'Grey' },
  { hex: '#003966', name: 'Dark Blue' },
  { hex: '#0b6a0b', name: 'Dark Green' }
];

const svgPlus = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const svgDownload = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const svgUpload = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
const svgTrash = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Workspaces</h1>
      <div class="page-header-actions">
        <button class="btn btn-outline btn-sm" id="import-btn" title="Import JSON">${svgUpload} Import</button>
        <button class="btn btn-outline btn-sm" id="export-btn" title="Export JSON">${svgDownload} Export</button>
        <button class="btn btn-primary btn-sm" id="new-ws-btn">${svgPlus} New Workspace</button>
      </div>
    </div>
    <div class="dashboard-toolbar">
      <input type="text" class="search-input" id="search" placeholder="Search workspaces...">
      <select class="sort-select" id="sort">
        <option value="savedAt">Sort by time</option>
        <option value="name">Sort by name</option>
      </select>
    </div>
    <div id="workspace-list" class="workspace-list"></div>
    <input type="file" id="import-file" accept=".json" style="display:none">
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
      const msg = workspaces.length === 0
        ? '<p>No workspaces yet.</p><p style="margin-top:8px;font-size:0.875rem">Create one to get started.</p>'
        : '<p>No workspaces found.</p>';
      listEl.innerHTML = `<div class="empty-state">${msg}</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(w => `
      <div class="workspace-card" style="border-left-color: ${w.color}" data-id="${w.id}">
        <div class="workspace-card-header">
          <span class="workspace-color-dot" style="background: ${w.color}"></span>
          <span class="workspace-name">${escapeHtml(w.name)}</span>
        </div>
        <div class="workspace-card-groups">
          ${renderGroupChips(w.groupSummary, w.groupCount)}
        </div>
        <div class="workspace-card-meta">
          <span>${w.tabCount} tab${w.tabCount !== 1 ? 's' : ''}</span>
          <span>${w.groupCount} group${w.groupCount !== 1 ? 's' : ''}</span>
          <span>${formatTime(w.savedAt)}</span>
        </div>
        <div class="workspace-card-actions">
          <button class="btn-icon danger" data-delete="${w.id}" title="Delete workspace"
            aria-label="Delete ${escapeHtml(w.name)}">${svgTrash}</button>
        </div>
      </div>
    `).join('');

    // Card click → navigate to detail
    listEl.querySelectorAll('.workspace-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-delete]')) return;
        location.hash = `#/workspace/${card.dataset.id}`;
      });
    });

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

  // --- New Workspace ---
  container.querySelector('#new-ws-btn').addEventListener('click', () => {
    showNewWorkspaceModal(container, async (ws) => {
      workspaces.unshift(ws);
      renderList();
      location.hash = `#/workspace/${ws.id}`;
    });
  });

  // --- Export ---
  container.querySelector('#export-btn').addEventListener('click', async () => {
    const btn = container.querySelector('#export-btn');
    btn.disabled = true;
    try {
      // Fetch full workspace data for export
      const allData = await Promise.all(
        workspaces.map(w => api.get(`/workspaces/${w.id}`).then(r => r.data))
      );
      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        workspaces: allData
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tabsy-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      btn.disabled = false;
    }
  });

  // --- Import ---
  const importFile = container.querySelector('#import-file');
  container.querySelector('#import-btn').addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importFile.value = '';

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      const wsArray = importData.workspaces;
      if (!Array.isArray(wsArray) || wsArray.length === 0) {
        alert('Invalid file: no workspaces found.');
        return;
      }

      const mode = prompt(
        `Found ${wsArray.length} workspace(s) to import.\n\nType "merge" to add new ones only, or "overwrite" to replace existing ones with same ID.\n\nDefault: merge`,
        'merge'
      );
      if (mode === null) return;
      const isOverwrite = mode.trim().toLowerCase() === 'overwrite';

      let imported = 0;
      let skipped = 0;

      for (const ws of wsArray) {
        if (!ws.id || !ws.name || !ws.color) { skipped++; continue; }

        const existing = workspaces.find(w => w.id === ws.id);
        if (existing && !isOverwrite) { skipped++; continue; }

        const payload = {
          id: ws.id,
          name: ws.name,
          color: ws.color,
          savedAt: ws.savedAt || new Date().toISOString(),
          groups: ws.groups || [],
          tabs: ws.tabs || []
        };

        let res;
        if (existing) {
          res = await api.put(`/workspaces/${ws.id}`, payload);
        } else {
          res = await api.post('/workspaces', payload);
        }

        if (res.ok) imported++;
        else skipped++;
      }

      alert(`Import complete: ${imported} imported, ${skipped} skipped.`);

      // Refresh
      const refresh = await api.get('/workspaces');
      if (refresh.ok) {
        workspaces = refresh.data.workspaces;
        renderList();
      }
    } catch (err) {
      alert('Failed to parse import file. Make sure it is a valid Tabsy JSON export.');
    }
  });
}

// --- New Workspace Modal ---
function showNewWorkspaceModal(container, onCreate) {
  // Remove existing modal
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>New Workspace</h2>
        <button class="btn-icon modal-close" aria-label="Close">${svgX}</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="new-ws-name">Name</label>
          <input type="text" id="new-ws-name" placeholder="My Workspace" autofocus>
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="ws-color-grid">
            ${WS_COLORS.map((c, i) => `
              <button class="ws-color-option ${i === 0 ? 'active' : ''}" data-color="${c.hex}" title="${c.name}" style="background: ${c.hex}">
                ${i === 0 ? svgCheck : ''}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-create-btn">Create</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector('#new-ws-name');
  const createBtn = overlay.querySelector('#modal-create-btn');
  const colorGrid = overlay.querySelector('.ws-color-grid');
  let selectedColor = WS_COLORS[0].hex;

  // Focus name input
  setTimeout(() => nameInput.focus(), 50);

  // Color selection
  colorGrid.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-color]');
    if (!opt) return;
    selectedColor = opt.dataset.color;
    colorGrid.querySelectorAll('.ws-color-option').forEach(o => {
      o.classList.toggle('active', o.dataset.color === selectedColor);
      o.innerHTML = o.dataset.color === selectedColor ? svgCheck : '';
    });
  });

  // Close
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('.modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Create
  const doCreate = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    const id = crypto.randomUUID();
    const savedAt = new Date().toISOString();

    const { ok, data } = await api.post('/workspaces', {
      id, name, color: selectedColor, savedAt,
      groups: [], tabs: []
    });

    if (ok) {
      close();
      onCreate({
        id, name, color: selectedColor, savedAt,
        tabCount: 0, groupCount: 0, groupSummary: []
      });
    } else {
      createBtn.disabled = false;
      createBtn.textContent = 'Create';
      alert(data?.error || 'Failed to create workspace.');
    }
  };

  createBtn.addEventListener('click', doCreate);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doCreate();
    if (e.key === 'Escape') close();
  });
}

function renderGroupChips(groupSummary, totalCount) {
  if (!groupSummary || groupSummary.length === 0) {
    return '<span class="group-chip" style="opacity: 0.5">No groups</span>';
  }

  const chips = groupSummary.map(g => {
    const color = GROUP_COLORS[g.color] || GROUP_COLORS.grey;
    return `<span class="group-chip">
      <span class="group-chip-dot" style="background: ${color}"></span>
      ${escapeHtml(g.title || 'Untitled')}
    </span>`;
  }).join('');

  const remaining = totalCount - groupSummary.length;
  const moreChip = remaining > 0
    ? `<span class="group-chip-more">+${remaining}</span>`
    : '';

  return chips + moreChip;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const svgX = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const svgCheck = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
