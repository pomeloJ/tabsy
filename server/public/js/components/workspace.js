import { api } from '../api.js';
import { t } from '../i18n.js';

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

const GROUP_COLOR_NAMES = Object.keys(GROUP_COLORS);

// --- State ---
let state = null;       // { id, name, color, savedAt, groups, tabs }
let original = null;    // snapshot for dirty check
let isDirty = false;
let saving = false;
let detailEl = null;
let beforeUnloadHandler = null;
let hashChangeHandler = null;

export async function render(container, workspaceId) {
  cleanup();
  container.innerHTML = `<div class="ws-detail"><div class="ws-loading">${t('loadingWorkspace')}</div></div>`;
  detailEl = container.querySelector('.ws-detail');

  const { ok, data } = await api.get(`/workspaces/${workspaceId}`);
  if (!ok) {
    detailEl.innerHTML = `
      <a href="#/" class="ws-back">${svgChevronLeft} ${t('backToWorkspaces')}</a>
      <div class="ws-error">${t('workspaceNotFound')}</div>
    `;
    return;
  }

  state = structuredClone(data);
  original = JSON.stringify(data);
  isDirty = false;

  // Warn on unsaved changes
  beforeUnloadHandler = (e) => {
    if (isDirty) { e.preventDefault(); e.returnValue = ''; }
  };
  hashChangeHandler = (e) => {
    if (isDirty && !confirm(t('unsavedChanges'))) {
      e.preventDefault();
      history.pushState(null, '', `#/workspace/${workspaceId}`);
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);
  window.addEventListener('hashchange', hashChangeHandler);

  renderAll();
}

function cleanup() {
  if (beforeUnloadHandler) window.removeEventListener('beforeunload', beforeUnloadHandler);
  if (hashChangeHandler) window.removeEventListener('hashchange', hashChangeHandler);
  beforeUnloadHandler = null;
  hashChangeHandler = null;
}

function markDirty() {
  isDirty = JSON.stringify(state) !== original;
  const saveBtn = detailEl.querySelector('#ws-save-btn');
  if (saveBtn) {
    saveBtn.disabled = !isDirty || saving;
    saveBtn.classList.toggle('btn-primary', isDirty);
    saveBtn.classList.toggle('btn-outline', !isDirty);
  }
  updateMeta();
}

function updateMeta() {
  const metaEl = detailEl.querySelector('#ws-meta');
  if (metaEl) {
    const tabs = state.tabs || [];
    const groups = state.groups || [];
    metaEl.textContent = `${tabs.length} ${tabs.length !== 1 ? t('tabs') : t('tab')} · ${groups.length} ${groups.length !== 1 ? t('groups') : t('group')}`;
  }
}

// --- Full re-render ---
function renderAll() {
  detailEl.innerHTML = `
    <div class="ws-toprow">
      <a href="#/" class="ws-back">${svgChevronLeft} ${t('backToWorkspaces')}</a>
      <div class="ws-toprow-actions">
        <button class="btn btn-outline btn-sm" id="ws-save-btn" disabled>
          ${svgSave} ${t('save')}
        </button>
      </div>
    </div>

    <div class="ws-header">
      <button class="ws-color-dot" id="ws-color-btn" style="background: ${state.color}" title="${t('changeColor')}" aria-label="${t('changeWorkspaceColor')}"></button>
      <div class="ws-color-picker" id="ws-color-picker" style="display:none">
        ${WS_COLORS.map(c => `
          <button class="ws-color-option ${c.hex === state.color ? 'active' : ''}"
            data-color="${c.hex}" title="${c.name}" aria-label="${c.name}"
            style="background: ${c.hex}">
            ${c.hex === state.color ? svgCheck : ''}
          </button>
        `).join('')}
      </div>
      <h1 class="ws-title" id="ws-name">${escapeHtml(state.name)}</h1>
      <button class="btn-icon" id="ws-edit-name" title="${t('editName')}" aria-label="${t('editWorkspaceName')}">${svgPencil}</button>
      <span class="ws-header-meta" id="ws-meta"></span>
    </div>
    ${state.lastSyncedBy ? `<div class="ws-synced-by" style="font-size:12px;color:var(--color-text-secondary);margin-bottom:12px">${t('lastSyncedBy')}: <code style="font-size:11px;background:#f0f0f0;padding:2px 6px;border-radius:3px">${escapeHtml(state.lastSyncedBy.substring(0, 8))}…</code></div>` : ''}

    <div id="ws-groups"></div>

    <div id="ws-flows"></div>

    <div class="ws-add-section">
      <div class="ws-add-row" id="add-tab-row">
        <input type="url" class="ws-add-input" id="add-tab-url" placeholder="${t('addTabPlaceholder')}">
        <button class="btn btn-sm btn-outline" id="add-tab-btn">${svgPlus} ${t('addTab')}</button>
      </div>
      <div class="ws-add-row" id="add-group-row">
        <input type="text" class="ws-add-input" id="add-group-name" placeholder="${t('newGroupPlaceholder')}">
        <div class="ws-add-color-pick" id="add-group-colors">
          ${GROUP_COLOR_NAMES.map((c, i) => `
            <button class="ws-gcolor-opt ${i === 0 ? 'active' : ''}" data-color="${c}" title="${c}" style="background: ${GROUP_COLORS[c]}"></button>
          `).join('')}
        </div>
        <button class="btn btn-sm btn-outline" id="add-group-btn">${svgPlus} ${t('addGroup')}</button>
      </div>
    </div>
  `;

  updateMeta();
  renderGroups();
  renderFlows();
  bindHeader();
  bindAddForms();
  bindSave();
}

// --- Render groups + tabs ---
function renderGroups() {
  const groupsEl = detailEl.querySelector('#ws-groups');
  const groups = state.groups || [];
  const tabs = state.tabs || [];

  // Index tabs by groupId
  const grouped = new Map();
  const ungrouped = [];
  for (const tab of tabs) {
    if (tab.groupId && groups.some(g => g.groupId === tab.groupId)) {
      if (!grouped.has(tab.groupId)) grouped.set(tab.groupId, []);
      grouped.get(tab.groupId).push(tab);
    } else {
      ungrouped.push(tab);
    }
  }

  let html = groups.map(group => {
    const gtabs = grouped.get(group.groupId) || [];
    const color = GROUP_COLORS[group.color] || GROUP_COLORS.grey;
    return `
      <div class="ws-group" data-group-id="${group.groupId}">
        <div class="ws-group-header">
          <span class="ws-group-color-bar" style="background: ${color}"></span>
          <span class="ws-group-title">${escapeHtml(group.title || t('untitled'))}</span>
          <span class="ws-group-count">${gtabs.length}</span>
          <button class="btn-icon ws-group-edit-btn" data-action="edit-group" data-gid="${group.groupId}" title="${t('editGroup')}">${svgPencil}</button>
          <button class="btn-icon danger ws-group-del-btn" data-action="del-group" data-gid="${group.groupId}" title="${t('deleteGroup')}">${svgX}</button>
          <svg class="ws-group-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="ws-group-tabs">
          ${gtabs.map((tab, i) => renderTab(tab, i)).join('')}
          ${gtabs.length === 0 ? `<div class="ws-tab ws-tab-empty"><span style="color:var(--color-text-tertiary);font-size:0.8125rem">${t('noTabsInGroup')}</span></div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  if (ungrouped.length > 0 || groups.length === 0) {
    html += `
      <div class="ws-group ungrouped">
        <div class="ws-group-header">
          <span class="ws-group-color-bar"></span>
          <span class="ws-group-title">${t('ungrouped')}</span>
          <span class="ws-group-count">${ungrouped.length}</span>
          <svg class="ws-group-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="ws-group-tabs">
          ${ungrouped.length > 0 ? ungrouped.map((tab, i) => renderTab(tab, i)).join('') :
            `<div class="ws-tab ws-tab-empty"><span style="color:var(--color-text-tertiary);font-size:0.8125rem">${t('noUngroupedTabs')}</span></div>`}
        </div>
      </div>
    `;
  }

  groupsEl.innerHTML = html;
  bindGroupEvents(groupsEl);
}

// --- Render flows (read-only) ---
function getTriggerLabels() {
  return { manual: t('triggerManual'), page_load: t('triggerPageLoad'), page_idle: t('triggerPageIdle') };
}
const BLOCK_LABELS = {
  click: '👆 Click', fill: '✏️ Fill', select: '📋 Select', check: '☑️ Check',
  scroll_to: '📜 Scroll', remove_element: '🗑️ Remove', set_attribute: '🏷️ Attr',
  add_class: '🎨 Class+', remove_class: '🎨 Class-', inject_css: '💅 CSS',
  navigate: '🔗 Navigate', wait_element: '⏳ Wait', wait_hidden: '⏳ WaitHide',
  delay: '⏱️ Delay', get_text: '📋 GetText', get_attribute: '📋 GetAttr',
  get_value: '📋 GetVal', set_variable: '📦 SetVar', eval_expression: '🧮 Eval',
  if: '❓ If', loop: '🔄 Loop', loop_elements: '🔄 Each', try_catch: '🛡️ Try',
  break: '⏹️ Break', log: '💬 Log', alert: '🔔 Alert', run_script: '⚡ Script'
};

function renderFlows() {
  const flowsEl = detailEl.querySelector('#ws-flows');
  const flows = state.flows || [];

  if (flows.length === 0) {
    flowsEl.innerHTML = '';
    return;
  }

  flowsEl.innerHTML = `
    <div class="ws-flows-section">
      <div class="ws-flows-header">
        <span class="ws-flows-title">${svgFlow} ${t('flows')}</span>
        <span class="ws-flows-count">${flows.length}</span>
      </div>
      ${flows.map(f => renderFlowCard(f)).join('')}
    </div>
  `;

  // Toggle collapse
  flowsEl.querySelectorAll('.ws-flow-card-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.ws-flow-card').classList.toggle('collapsed');
    });
  });
}

function renderFlowCard(flow) {
  const trigger = getTriggerLabels()[flow.trigger] || flow.trigger;
  const blockCount = countBlocks(flow.blocks || []);
  const varCount = Object.keys(flow.variables || {}).length;

  return `
    <div class="ws-flow-card ${flow.enabled ? '' : 'disabled'}">
      <div class="ws-flow-card-header">
        <span class="ws-flow-status ${flow.enabled ? 'enabled' : 'off'}">${flow.enabled ? '●' : '○'}</span>
        <span class="ws-flow-name">${escapeHtml(flow.name)}</span>
        <span class="ws-flow-trigger">${trigger}</span>
        <svg class="ws-flow-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="ws-flow-card-body">
        ${flow.match ? `<div class="ws-flow-meta-row"><span class="ws-flow-meta-label">${t('urlMatch')}</span><code>${escapeHtml(flow.match)}</code></div>` : ''}
        <div class="ws-flow-meta-row">
          <span class="ws-flow-meta-label">${t('blocks')}</span><span>${blockCount}</span>
          <span class="ws-flow-meta-label" style="margin-left:12px">${t('variables')}</span><span>${varCount}</span>
        </div>
        ${renderFlowBlocks(flow.blocks || [])}
      </div>
    </div>
  `;
}

function renderFlowBlocks(blocks, depth = 0) {
  if (blocks.length === 0) return `<div class="ws-flow-blocks-empty">${t('noBlocks')}</div>`;
  return `<div class="ws-flow-blocks" style="margin-left:${depth * 12}px">
    ${blocks.map(b => {
      const label = BLOCK_LABELS[b.type] || b.type;
      const summary = getFlowBlockSummary(b);
      let nested = '';
      if (b.then && b.then.length) nested += `<div class="ws-flow-branch-label">${t('thenBranch')}</div>${renderFlowBlocks(b.then, depth + 1)}`;
      if (b.else && b.else.length) nested += `<div class="ws-flow-branch-label">${t('elseBranch')}</div>${renderFlowBlocks(b.else, depth + 1)}`;
      if (b.body && b.body.length) nested += renderFlowBlocks(b.body, depth + 1);
      if (b.try && b.try.length) nested += `<div class="ws-flow-branch-label">${t('tryBranch')}</div>${renderFlowBlocks(b.try, depth + 1)}`;
      if (b.catch && b.catch.length) nested += `<div class="ws-flow-branch-label">${t('catchBranch')}</div>${renderFlowBlocks(b.catch, depth + 1)}`;
      return `<div class="ws-flow-block">
        <span class="ws-flow-block-label">${label}</span>
        ${summary ? `<span class="ws-flow-block-summary">${escapeHtml(summary)}</span>` : ''}
        ${nested}
      </div>`;
    }).join('')}
  </div>`;
}

function getFlowBlockSummary(b) {
  switch (b.type) {
    case 'click': case 'scroll_to': case 'remove_element': return b.selector || '';
    case 'fill': return b.selector ? `${b.selector} = "${(b.value || '').slice(0, 20)}"` : '';
    case 'wait_element': case 'wait_hidden': return `${b.selector || ''} (${b.timeout || 5000}ms)`;
    case 'delay': return `${b.ms || 1000}ms`;
    case 'navigate': return (b.url || '').slice(0, 40);
    case 'log': case 'alert': return (b.message || '').slice(0, 40);
    case 'set_variable': return `${b.variable} = "${(b.value || '').slice(0, 20)}"`;
    case 'get_text': case 'get_value': return `${b.selector} → ${b.variable}`;
    case 'if': return b.condition ? (b.condition.selector || b.condition.text || b.condition.type) : '';
    case 'loop': return `${b.times}x`;
    case 'loop_elements': return `${b.selector} as ${b.itemVariable || 'el'}`;
    case 'inject_css': return (b.css || '').slice(0, 30);
    case 'run_script': return (b.code || '').slice(0, 30);
    default: return '';
  }
}

function countBlocks(blocks) {
  let count = blocks.length;
  for (const b of blocks) {
    if (b.then) count += countBlocks(b.then);
    if (b.else) count += countBlocks(b.else);
    if (b.body) count += countBlocks(b.body);
    if (b.try) count += countBlocks(b.try);
    if (b.catch) count += countBlocks(b.catch);
  }
  return count;
}

const svgFlow = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';

function renderTab(tab, idx) {
  const faviconUrl = getFaviconUrl(tab.url);
  const groups = state.groups || [];
  const moveOptions = [
    `<option value="">${t('moveTo')}</option>`,
    ...groups.map(g => `<option value="${g.groupId}" ${tab.groupId === g.groupId ? 'disabled' : ''}>${escapeHtml(g.title || t('untitled'))}</option>`),
    `<option value="__ungrouped" ${!tab.groupId ? 'disabled' : ''}>${t('ungrouped')}</option>`
  ].join('');

  return `
    <div class="ws-tab" data-tab-idx="${idx}" data-tab-url="${escapeAttr(tab.url)}">
      <span class="ws-tab-favicon">
        ${faviconUrl ? `<img src="${faviconUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
      </span>
      <div class="ws-tab-info" role="button" tabindex="0" title="Click to edit">
        <div class="ws-tab-title">${escapeHtml(tab.title || tab.url)}</div>
        <div class="ws-tab-url">${escapeHtml(tab.url)}</div>
      </div>
      ${tab.pinned ? `<span class="ws-tab-pin">${t('pin')}</span>` : ''}
      <a class="btn-icon ws-tab-open" href="${escapeAttr(tab.url)}" target="_blank" rel="noopener noreferrer" title="${t('openInNewTab')}" aria-label="${t('openInNewTab')}">${svgExternalLink}</a>
      <select class="ws-tab-move" title="${t('moveToGroup')}" aria-label="${t('moveTabToGroup')}">${moveOptions}</select>
      <button class="btn-icon danger ws-tab-del" title="${t('removeTab')}" aria-label="${t('removeTab')}">${svgX}</button>
    </div>
  `;
}

// --- Event bindings ---
function bindHeader() {
  // Color picker toggle
  const colorBtn = detailEl.querySelector('#ws-color-btn');
  const colorPicker = detailEl.querySelector('#ws-color-picker');
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    colorPicker.style.display = colorPicker.style.display === 'none' ? 'flex' : 'none';
  });
  document.addEventListener('click', () => { colorPicker.style.display = 'none'; }, { once: false });
  colorPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    const opt = e.target.closest('[data-color]');
    if (!opt) return;
    state.color = opt.dataset.color;
    colorBtn.style.background = state.color;
    colorPicker.querySelectorAll('.ws-color-option').forEach(o => {
      o.classList.toggle('active', o.dataset.color === state.color);
      o.innerHTML = o.dataset.color === state.color ? svgCheck : '';
    });
    colorPicker.style.display = 'none';
    markDirty();
  });

  // Edit name
  const nameEl = detailEl.querySelector('#ws-name');
  const editBtn = detailEl.querySelector('#ws-edit-name');
  editBtn.addEventListener('click', () => startEditName(nameEl));
  nameEl.addEventListener('click', () => startEditName(nameEl));
}

function startEditName(nameEl) {
  if (nameEl.querySelector('input')) return;
  const current = state.name;
  nameEl.innerHTML = `<input type="text" class="ws-name-input" value="${escapeAttr(current)}" autofocus>`;
  const input = nameEl.querySelector('input');
  input.focus();
  input.select();

  const finish = () => {
    const val = input.value.trim();
    if (val && val !== current) {
      state.name = val;
      markDirty();
    }
    nameEl.textContent = state.name;
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

function bindGroupEvents(groupsEl) {
  // Collapse toggle
  groupsEl.querySelectorAll('.ws-group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('select')) return;
      header.closest('.ws-group').classList.toggle('collapsed');
    });
  });

  // Edit group
  groupsEl.querySelectorAll('[data-action="edit-group"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editGroup(btn.dataset.gid);
    });
  });

  // Delete group
  groupsEl.querySelectorAll('[data-action="del-group"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteGroup(btn.dataset.gid);
    });
  });

  // Tab edit (click on info area)
  groupsEl.querySelectorAll('.ws-tab-info').forEach(info => {
    info.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabEl = info.closest('.ws-tab');
      const url = tabEl.dataset.tabUrl;
      const groupEl = tabEl.closest('.ws-group');
      const gid = groupEl.dataset.groupId || null;
      editTab(tabEl, url, gid);
    });
    info.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') info.click();
    });
  });

  // Tab delete
  groupsEl.querySelectorAll('.ws-tab-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabEl = btn.closest('.ws-tab');
      const url = tabEl.dataset.tabUrl;
      const groupEl = tabEl.closest('.ws-group');
      const gid = groupEl.dataset.groupId || null;
      deleteTab(url, gid);
    });
  });

  // Tab move
  groupsEl.querySelectorAll('.ws-tab-move').forEach(sel => {
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      const tabEl = sel.closest('.ws-tab');
      const url = tabEl.dataset.tabUrl;
      const groupEl = tabEl.closest('.ws-group');
      const fromGid = groupEl.dataset.groupId || null;
      const toGid = sel.value === '__ungrouped' ? null : sel.value;
      if (toGid !== undefined && toGid !== '') {
        moveTab(url, fromGid, toGid);
      }
      sel.value = '';
    });
  });
}

function bindAddForms() {
  // Add tab
  const addTabBtn = detailEl.querySelector('#add-tab-btn');
  const addTabUrl = detailEl.querySelector('#add-tab-url');
  addTabBtn.addEventListener('click', () => addTab(addTabUrl));
  addTabUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTab(addTabUrl); }
  });

  // Add group
  const addGroupBtn = detailEl.querySelector('#add-group-btn');
  const addGroupName = detailEl.querySelector('#add-group-name');
  const addGroupColors = detailEl.querySelector('#add-group-colors');

  // Color selection for new group
  addGroupColors.querySelectorAll('.ws-gcolor-opt').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.preventDefault();
      addGroupColors.querySelectorAll('.ws-gcolor-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    });
  });

  addGroupBtn.addEventListener('click', () => addGroup(addGroupName, addGroupColors));
  addGroupName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addGroup(addGroupName, addGroupColors); }
  });
}

function bindSave() {
  detailEl.querySelector('#ws-save-btn').addEventListener('click', saveWorkspace);
}

// --- Actions ---
function addTab(urlInput) {
  const url = urlInput.value.trim();
  if (!url) return;
  try { new URL(url); } catch {
    urlInput.setCustomValidity('Please enter a valid URL');
    urlInput.reportValidity();
    return;
  }
  urlInput.setCustomValidity('');

  // Extract title from URL
  let title = url;
  try { title = new URL(url).hostname; } catch {}

  state.tabs.push({
    url,
    title,
    pinned: false,
    groupId: null,
    index: state.tabs.length
  });

  urlInput.value = '';
  markDirty();
  renderGroups();
}

function deleteTab(url, groupId) {
  const idx = state.tabs.findIndex(t => t.url === url && (t.groupId || null) === groupId);
  if (idx === -1) return;
  state.tabs.splice(idx, 1);
  markDirty();
  renderGroups();
}

function moveTab(url, fromGid, toGid) {
  const tab = state.tabs.find(t => t.url === url && (t.groupId || null) === fromGid);
  if (!tab) return;
  tab.groupId = toGid;
  markDirty();
  renderGroups();
}

function addGroup(nameInput, colorsEl) {
  const title = nameInput.value.trim();
  if (!title) { nameInput.focus(); return; }
  const activeColor = colorsEl.querySelector('.ws-gcolor-opt.active');
  const color = activeColor ? activeColor.dataset.color : 'grey';

  state.groups.push({
    groupId: 'g' + Date.now(),
    title,
    color,
    collapsed: false
  });

  nameInput.value = '';
  markDirty();
  renderGroups();
}

function deleteGroup(gid) {
  const group = state.groups.find(g => g.groupId === gid);
  if (!group) return;
  if (!confirm(t('deleteGroupConfirm', { name: group.title }))) return;

  // Move tabs to ungrouped
  state.tabs.forEach(t => {
    if (t.groupId === gid) t.groupId = null;
  });
  state.groups = state.groups.filter(g => g.groupId !== gid);
  markDirty();
  renderGroups();
}

function editGroup(gid) {
  const group = state.groups.find(g => g.groupId === gid);
  if (!group) return;

  const groupEl = detailEl.querySelector(`[data-group-id="${gid}"]`);
  const header = groupEl.querySelector('.ws-group-header');

  // Replace header with inline edit form
  const oldHTML = header.innerHTML;
  header.innerHTML = `
    <input type="text" class="ws-group-edit-input" value="${escapeAttr(group.title)}" autofocus>
    <div class="ws-add-color-pick ws-group-edit-colors">
      ${GROUP_COLOR_NAMES.map(c => `
        <button class="ws-gcolor-opt ${c === group.color ? 'active' : ''}" data-color="${c}" title="${c}" style="background: ${GROUP_COLORS[c]}"></button>
      `).join('')}
    </div>
    <button class="btn btn-sm btn-primary ws-group-edit-save">${t('done')}</button>
    <button class="btn btn-sm btn-ghost ws-group-edit-cancel">${t('cancel')}</button>
  `;

  const input = header.querySelector('input');
  input.focus();
  input.select();

  // Color clicks
  header.querySelectorAll('.ws-gcolor-opt').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      header.querySelectorAll('.ws-gcolor-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    });
  });

  const save = (e) => {
    e.stopPropagation();
    const newTitle = input.value.trim();
    const activeColor = header.querySelector('.ws-gcolor-opt.active');
    if (newTitle) group.title = newTitle;
    if (activeColor) group.color = activeColor.dataset.color;
    markDirty();
    renderGroups();
  };

  const cancel = (e) => {
    e.stopPropagation();
    renderGroups();
  };

  header.querySelector('.ws-group-edit-save').addEventListener('click', save);
  header.querySelector('.ws-group-edit-cancel').addEventListener('click', cancel);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') save(e);
    if (e.key === 'Escape') cancel(e);
  });
  header.addEventListener('click', (e) => e.stopPropagation());
}

function editTab(tabEl, url, groupId) {
  // Don't open if already editing
  if (tabEl.querySelector('.ws-tab-edit')) return;

  const tab = state.tabs.find(t => t.url === url && (t.groupId || null) === groupId);
  if (!tab) return;

  const origTitle = tab.title || '';
  const origUrl = tab.url;

  // Replace tab content with edit form
  const infoEl = tabEl.querySelector('.ws-tab-info');
  const actionsHTML = tabEl.querySelector('.ws-tab-move')?.outerHTML || '';
  const delHTML = tabEl.querySelector('.ws-tab-del')?.outerHTML || '';
  const pinHTML = tabEl.querySelector('.ws-tab-pin')?.outerHTML || '';

  // Hide action controls during edit
  const openEl = tabEl.querySelector('.ws-tab-open');
  const moveEl = tabEl.querySelector('.ws-tab-move');
  const delEl = tabEl.querySelector('.ws-tab-del');
  if (openEl) openEl.style.display = 'none';
  if (moveEl) moveEl.style.display = 'none';
  if (delEl) delEl.style.display = 'none';

  infoEl.outerHTML = `
    <div class="ws-tab-edit">
      <div class="ws-tab-edit-field">
        <label>${t('title')}</label>
        <input type="text" class="ws-tab-edit-input" id="tab-edit-title" value="${escapeAttr(origTitle)}" placeholder="${t('title')}">
      </div>
      <div class="ws-tab-edit-field">
        <label>${t('url')}</label>
        <input type="url" class="ws-tab-edit-input" id="tab-edit-url" value="${escapeAttr(origUrl)}" placeholder="https://...">
      </div>
      <div class="ws-tab-edit-actions">
        <button class="btn btn-sm btn-primary ws-tab-edit-done">${t('done')}</button>
        <button class="btn btn-sm btn-ghost ws-tab-edit-cancel">${t('cancel')}</button>
      </div>
    </div>
  `;

  tabEl.classList.add('editing');

  const titleInput = tabEl.querySelector('#tab-edit-title');
  const urlInput = tabEl.querySelector('#tab-edit-url');
  titleInput.focus();
  titleInput.select();

  const done = () => {
    const newTitle = titleInput.value.trim();
    const newUrl = urlInput.value.trim();

    if (!newUrl) {
      urlInput.focus();
      urlInput.setCustomValidity('URL is required');
      urlInput.reportValidity();
      return;
    }
    try { new URL(newUrl); } catch {
      urlInput.focus();
      urlInput.setCustomValidity('Please enter a valid URL');
      urlInput.reportValidity();
      return;
    }

    tab.title = newTitle || newUrl;
    tab.url = newUrl;
    markDirty();
    renderGroups();
  };

  const cancel = () => {
    renderGroups();
  };

  tabEl.querySelector('.ws-tab-edit-done').addEventListener('click', (e) => { e.stopPropagation(); done(); });
  tabEl.querySelector('.ws-tab-edit-cancel').addEventListener('click', (e) => { e.stopPropagation(); cancel(); });

  // Keyboard shortcuts
  const handleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); done(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };
  titleInput.addEventListener('keydown', handleKey);
  urlInput.addEventListener('keydown', handleKey);
}

async function saveWorkspace() {
  if (!isDirty || saving) return;
  const saveBtn = detailEl.querySelector('#ws-save-btn');
  saving = true;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `${svgLoader} ${t('saving')}`;

  state.savedAt = new Date().toISOString();

  const { ok, data } = await api.put(`/workspaces/${state.id}`, {
    name: state.name,
    color: state.color,
    savedAt: state.savedAt,
    groups: state.groups,
    tabs: state.tabs,
    flows: state.flows || []
  });

  saving = false;

  if (ok) {
    original = JSON.stringify(state);
    isDirty = false;
    saveBtn.innerHTML = `${svgCheck} ${t('saved')}`;
    saveBtn.classList.remove('btn-primary');
    saveBtn.classList.add('btn-outline');
    setTimeout(() => {
      saveBtn.innerHTML = `${svgSave} ${t('save')}`;
      saveBtn.disabled = true;
    }, 1500);
    showToast(t('workspaceSaved'));
  } else {
    saveBtn.innerHTML = `${svgSave} ${t('save')}`;
    saveBtn.disabled = false;
    showToast(t('failedToSaveWorkspace'), true);
  }
}

function showToast(msg, isError = false) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (isError) toast.style.background = 'var(--color-danger)';
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// --- Helpers ---
function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome:' || u.protocol === 'about:' || u.protocol === 'edge:') return null;
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return null; }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- SVG Icons (inline, Lucide-style) ---
const svgChevronLeft = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
const svgPencil = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
const svgX = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const svgPlus = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const svgSave = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
const svgCheck = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const svgLoader = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ws-spin"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>';
const svgExternalLink = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
