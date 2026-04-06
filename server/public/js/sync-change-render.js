import { t } from './i18n.js';

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function addedRemoved(label, added, removed, modified, nameKey) {
  const details = [];
  if (added && added.length) {
    const items = added.map(x => typeof x === 'string' ? escapeHtml(x) : escapeHtml(x.title || x.url || x.name));
    details.push(`<span class="sync-change-added">+ ${label}: ${items.join(', ')}</span>`);
  }
  if (removed && removed.length) {
    const items = removed.map(x => typeof x === 'string' ? escapeHtml(x) : escapeHtml(x.title || x.url || x.name));
    details.push(`<span class="sync-change-removed">\u2212 ${label}: ${items.join(', ')}</span>`);
  }
  if (modified && modified.length) {
    const items = modified.map(x => {
      if (typeof x === 'string') return escapeHtml(x);
      const name = escapeHtml(x.name || x.title || x.url || '');
      const diffs = x.diffs ? ` (${x.diffs.map(d => escapeHtml(d)).join(', ')})` : (x.title ? ` ${escapeHtml(x.title)}` : '');
      return name + diffs;
    });
    details.push(`${t('syncChangeModified')} ${label}: ${items.join(', ')}`);
  }
  return details;
}

export function renderChangeCard(change) {
  const typeLabel = {
    created: t('syncChangeCreated'),
    updated: t('syncChangeUpdated'),
    deleted: t('syncChangeDeleted')
  }[change.changeType] || change.changeType;

  const typeClass = `sync-change-${change.changeType}`;
  const details = [];
  const ch = change.changes;

  // Workspace-level
  if (ch.name) details.push(`${t('syncChangeName')}: "${escapeHtml(ch.name[0])}" \u2192 "${escapeHtml(ch.name[1])}"`);
  if (ch.color) details.push(`${t('syncChangeColor')}: ${escapeHtml(ch.color[0])} \u2192 ${escapeHtml(ch.color[1])}`);
  if (ch.savedAt) details.push(`${t('syncChangeSavedAt')}: ${escapeHtml(ch.savedAt[0])} \u2192 ${escapeHtml(ch.savedAt[1])}`);

  // Tabs
  if (ch.tabCount) details.push(`${t('syncChangeTabs')}: ${ch.tabCount[0]} \u2192 ${ch.tabCount[1]}`);
  details.push(...addedRemoved(t('syncChangeTabs'), ch.tabsAdded, ch.tabsRemoved, ch.tabsModified));

  // Groups
  if (ch.groupCount) details.push(`${t('syncChangeGroups')}: ${ch.groupCount[0]} \u2192 ${ch.groupCount[1]}`);
  details.push(...addedRemoved(t('syncChangeGroups'), ch.groupsAdded, ch.groupsRemoved, ch.groupsModified));

  // Flows
  if (ch.flowCount) details.push(`${t('syncChangeFlows')}: ${ch.flowCount[0]} \u2192 ${ch.flowCount[1]}`);
  details.push(...addedRemoved(t('syncChangeFlows'), ch.flowsAdded, ch.flowsRemoved, ch.flowsModified));

  // Notes
  if (ch.noteCount) details.push(`${t('syncChangeNotes')}: ${ch.noteCount[0]} \u2192 ${ch.noteCount[1]}`);
  details.push(...addedRemoved(t('syncChangeNotes'), ch.notesAdded, ch.notesRemoved, ch.notesModified));

  return `
    <div class="sync-change-card">
      <span class="sync-action-badge ${typeClass}">${typeLabel}</span>
      <strong>${escapeHtml(change.workspaceName)}</strong>
      ${details.length ? `<div class="sync-change-details">${details.join('<br>')}</div>` : `<div class="sync-change-details" style="color:#999">${t('syncChangeSynced')}</div>`}
    </div>
  `;
}
