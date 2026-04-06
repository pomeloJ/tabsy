import { api } from '../api.js';
import { t, formatDateTime } from '../i18n.js';
import { renderChangeCard } from '../sync-change-render.js';

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function formatTime(iso) {
  if (!iso) return '';
  return formatDateTime ? formatDateTime(iso) : new Date(iso).toLocaleString();
}

export async function render(container) {
  container.innerHTML = `
    <div class="sync-logs-page">
      <div class="ws-back-row">
        <a href="#/settings" class="ws-back">&larr; ${t('settings')}</a>
      </div>
      <h1>${t('syncLogs')}</h1>
      <p class="settings-desc">${t('syncLogsDesc')}</p>

      <div class="sync-logs-filters">
        <select id="filter-action" class="sort-select">
          <option value="">${t('syncLogsFilterAll')}</option>
          <option value="push">${t('syncLogPush')}</option>
          <option value="pull">${t('syncLogPull')}</option>
        </select>
        <input type="date" id="filter-date-from" class="sort-select" placeholder="${t('syncLogsDateFrom')}">
        <span style="color:#999;font-size:13px">~</span>
        <input type="date" id="filter-date-to" class="sort-select" placeholder="${t('syncLogsDateTo')}">
      </div>

      <div id="sync-logs-full-list"></div>
      <div id="sync-logs-load-more" style="text-align:center;margin-top:12px;display:none">
        <button class="btn btn-ghost btn-sm" id="load-more-btn">${t('syncLogsLoadMore')}</button>
      </div>
    </div>
  `;

  const listEl = container.querySelector('#sync-logs-full-list');
  const loadMoreEl = container.querySelector('#sync-logs-load-more');
  const filterAction = container.querySelector('#filter-action');
  const filterDateFrom = container.querySelector('#filter-date-from');
  const filterDateTo = container.querySelector('#filter-date-to');
  const loadMoreBtn = container.querySelector('#load-more-btn');

  let allLogs = [];
  let displayedCount = 0;
  let expandedLogId = null;
  const PAGE_SIZE = 20;

  async function loadLogs() {
    const { ok, data } = await api.get('/sync/logs?limit=200');
    if (!ok) {
      listEl.innerHTML = `<p class="empty-state">${t('failedToLoadSyncLogs')}</p>`;
      return;
    }
    allLogs = data.logs;
    displayedCount = 0;
    expandedLogId = null;
    applyFilter();
  }

  function getFilteredLogs() {
    const action = filterAction.value;
    const from = filterDateFrom.value; // "YYYY-MM-DD" or ""
    const to = filterDateTo.value;
    return allLogs.filter(l => {
      if (action && l.action !== action) return false;
      if (from && l.createdAt < from + 'T00:00:00') return false;
      if (to && l.createdAt > to + 'T23:59:59') return false;
      return true;
    });
  }

  function applyFilter() {
    displayedCount = 0;
    expandedLogId = null;
    renderPage();
  }

  function renderPage() {
    const filtered = getFilteredLogs();
    const page = filtered.slice(0, displayedCount + PAGE_SIZE);
    displayedCount = page.length;

    if (page.length === 0) {
      listEl.innerHTML = `<p class="empty-state">${t('noSyncLogs')}</p>`;
      loadMoreEl.style.display = 'none';
      return;
    }

    listEl.innerHTML = `
      <table class="token-table sync-logs-table">
        <thead>
          <tr>
            <th>${t('syncLogAction')}</th>
            <th>${t('syncLogClientId')}</th>
            <th>${t('syncLogWorkspaces')}</th>
            <th>${t('syncLogTime')}</th>
          </tr>
        </thead>
        <tbody>
          ${page.map(log => `
            <tr class="sync-log-row clickable${expandedLogId === String(log.id) ? ' expanded' : ''}" data-log-id="${log.id}" data-action="${log.action}">
              <td><span class="sync-action-badge sync-action-${log.action}">${log.action === 'push' ? t('syncLogPush') : t('syncLogPull')}</span></td>
              <td><code style="font-size:11px;background:#f0f0f0;padding:2px 6px;border-radius:3px" title="${escapeHtml(log.clientId)}">${escapeHtml(log.clientId.substring(0, 8))}\u2026</code></td>
              <td>${log.workspaceCount}</td>
              <td>${formatTime(log.createdAt)}</td>
            </tr>
            <tr class="sync-detail-row" data-detail-for="${log.id}" style="display:none">
              <td colspan="4"><div class="sync-detail-inline"></div></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    loadMoreEl.style.display = displayedCount < filtered.length ? '' : 'none';

    // Click handlers — toggle inline detail
    listEl.querySelectorAll('.sync-log-row.clickable').forEach(row => {
      row.addEventListener('click', () => toggleDetail(row));
    });

    // Re-expand if there was one open
    if (expandedLogId) {
      const detailRow = listEl.querySelector(`tr.sync-detail-row[data-detail-for="${expandedLogId}"]`);
      if (detailRow) detailRow.style.display = '';
    }
  }

  async function toggleDetail(row) {
    const logId = row.dataset.logId;
    const detailRow = listEl.querySelector(`tr.sync-detail-row[data-detail-for="${logId}"]`);
    if (!detailRow) return;

    // Collapse previous
    const prevDetail = listEl.querySelector('tr.sync-detail-row[style=""]');
    const prevRow = listEl.querySelector('.sync-log-row.expanded');
    if (prevRow && prevRow !== row) {
      prevRow.classList.remove('expanded');
      const prevDetailRow = listEl.querySelector(`tr.sync-detail-row[data-detail-for="${prevRow.dataset.logId}"]`);
      if (prevDetailRow) prevDetailRow.style.display = 'none';
    }

    // Toggle current
    if (expandedLogId === logId) {
      expandedLogId = null;
      row.classList.remove('expanded');
      detailRow.style.display = 'none';
      return;
    }

    expandedLogId = logId;
    row.classList.add('expanded');
    detailRow.style.display = '';
    const inlineEl = detailRow.querySelector('.sync-detail-inline');

    // Only push logs have change details; pull logs show workspace IDs
    if (row.dataset.action === 'push') {
      inlineEl.innerHTML = `<p class="empty-state">${t('loading')}...</p>`;
      const { ok, data } = await api.get(`/sync/changes?logId=${logId}`);
      if (!ok || !data.changes.length) {
        inlineEl.innerHTML = `<p class="empty-state">${t('noSyncChanges')}</p>`;
        return;
      }
      inlineEl.innerHTML = `<div class="sync-changes-panel">${data.changes.map(c => renderChangeCard(c)).join('')}</div>`;
    } else {
      // Pull — show the workspace IDs from the log
      const log = allLogs.find(l => String(l.id) === logId);
      if (log && log.workspaceIds && log.workspaceIds.length) {
        inlineEl.innerHTML = `<div class="sync-changes-panel"><div class="sync-change-details">${t('syncLogPulledIds')}: ${log.workspaceIds.map(id => `<code>${escapeHtml(id.substring(0, 8))}\u2026</code>`).join(', ')}</div></div>`;
      } else {
        inlineEl.innerHTML = `<p class="empty-state">${t('noSyncChanges')}</p>`;
      }
    }
  }

  filterAction.addEventListener('change', applyFilter);
  filterDateFrom.addEventListener('change', applyFilter);
  filterDateTo.addEventListener('change', applyFilter);
  loadMoreBtn.addEventListener('click', () => renderPage());

  await loadLogs();
}
