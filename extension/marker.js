const CHROME_COLOR_HEX = {
  blue: '#4285f4', red: '#ea4335', yellow: '#fbbc04', green: '#34a853',
  pink: '#e91e8b', purple: '#a142f4', cyan: '#24c1e0', orange: '#fa903e', grey: '#9aa0a6'
};

// --- Simple i18n for marker page (cannot use ES module import) ---
const _locales = {
  en: {
    tabs: 'Tabs', groups: 'Groups', pinned: 'Pinned',
    record: 'Timeline', unnamed: '(Unnamed)', nTabs: '{n} tabs',
    saved: 'Saved', opened: 'Opened',
    markerHint: 'This tab is a Tabsy workspace marker — do not close'
  },
  'zh-TW': {
    tabs: '分頁', groups: '群組', pinned: '釘選',
    record: '記錄', unnamed: '(未命名)', nTabs: '{n} 個分頁',
    saved: '儲存', opened: '開啟',
    markerHint: '此分頁為 Tabsy workspace 標記 — 請勿關閉'
  }
};

let _dict = _locales.en;

function mt(key, params) {
  var str = _dict[key] || _locales.en[key] || key;
  if (params) {
    Object.keys(params).forEach(function(k) {
      str = str.replace('{' + k + '}', params[k]);
    });
  }
  return str;
}

function applyLabels() {
  document.getElementById('tabLabel').textContent = mt('tabs');
  document.getElementById('groupLabel').textContent = mt('groups');
  document.getElementById('pinnedLabel').textContent = mt('pinned');
  document.getElementById('timelineTitle').textContent = mt('record');
  document.getElementById('groupsTitle').textContent = mt('groups');
  document.getElementById('hint').textContent = mt('markerHint');
}

const params = new URLSearchParams(location.search);
const wsId = params.get('id') || '';
const wsName = params.get('name') || 'Workspace';
const wsColor = params.get('color') || '#0078d4';
const openedAt = new Date();

// Apply basic info from URL params immediately
document.getElementById('name').textContent = wsName;
document.documentElement.style.setProperty('--color', wsColor);
document.title = '\u{1F4C2} ' + wsName + ' \u2014 Tabsy';

function formatTime(date) {
  return date.toLocaleString(undefined, {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function addTimelineItem(text, active) {
  var item = document.createElement('div');
  item.className = 'timeline-item';
  item.innerHTML =
    '<div class="timeline-dot ' + (active ? '' : 'dim') + '"></div>' +
    '<div class="timeline-text">' + text + '</div>';
  document.getElementById('timeline').appendChild(item);
}

function renderStats(tabs, groups) {
  var pinned = tabs.filter(function(t) { return t.pinned; });
  document.getElementById('tabCount').textContent = tabs.length;
  document.getElementById('groupCount').textContent = groups.length;
  document.getElementById('pinnedCount').textContent = pinned.length;
}

function renderGroups(tabs, groups) {
  if (groups.length === 0) return;
  var groupsEl = document.getElementById('groups');
  var listEl = document.getElementById('groupList');
  groupsEl.style.display = 'block';

  groups.forEach(function(g) {
    var count = tabs.filter(function(t) { return t.groupId === g.groupId; }).length;
    var colorHex = CHROME_COLOR_HEX[g.color] || '#9aa0a6';
    var row = document.createElement('div');
    row.className = 'group-row';
    row.innerHTML =
      '<div class="group-color" style="background:' + colorHex + '"></div>' +
      '<span class="group-name">' + (g.title || mt('unnamed')) + '</span>' +
      '<span class="group-count">' + mt('nTabs', { n: count }) + '</span>';
    listEl.appendChild(row);
  });
}

// Load locale, then render
chrome.storage.local.get(['workspaces', 'tabsyLocale'], function(result) {
  var locale = result.tabsyLocale || 'en';
  if (_locales[locale]) _dict = _locales[locale];
  applyLabels();

  var workspaces = (result && result.workspaces) || [];
  var ws = workspaces.find(function(w) { return w.id === wsId; })
        || workspaces.find(function(w) { return w.name === wsName; });

  if (ws) {
    var tabs = ws.tabs || [];
    var groups = ws.groups || [];

    renderStats(tabs, groups);

    if (ws.savedAt) {
      addTimelineItem('<strong>' + mt('saved') + '</strong> <span class="time">' + formatTime(new Date(ws.savedAt)) + '</span>', false);
    }
    addTimelineItem('<strong>' + mt('opened') + '</strong> <span class="time">' + formatTime(openedAt) + '</span>', true);

    renderGroups(tabs, groups);
  } else {
    document.getElementById('tabCount').textContent = '\u2014';
    document.getElementById('groupCount').textContent = '\u2014';
    document.getElementById('pinnedCount').textContent = '\u2014';
    addTimelineItem('<strong>' + mt('opened') + '</strong> <span class="time">' + formatTime(openedAt) + '</span>', true);
  }
});
