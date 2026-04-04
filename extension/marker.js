const CHROME_COLOR_HEX = {
  blue: '#4285f4', red: '#ea4335', yellow: '#fbbc04', green: '#34a853',
  pink: '#e91e8b', purple: '#a142f4', cyan: '#24c1e0', orange: '#fa903e', grey: '#9aa0a6'
};

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
  return date.toLocaleString('zh-TW', {
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
      '<span class="group-name">' + (g.title || '(未命名)') + '</span>' +
      '<span class="group-count">' + count + ' 個分頁</span>';
    listEl.appendChild(row);
  });
}

// Load workspace data from chrome.storage.local
chrome.storage.local.get('workspaces', function(result) {
  var workspaces = (result && result.workspaces) || [];
  var ws = workspaces.find(function(w) { return w.id === wsId; })
        || workspaces.find(function(w) { return w.name === wsName; });

  if (ws) {
    var tabs = ws.tabs || [];
    var groups = ws.groups || [];

    renderStats(tabs, groups);

    if (ws.savedAt) {
      addTimelineItem('<strong>儲存</strong> <span class="time">' + formatTime(new Date(ws.savedAt)) + '</span>', false);
    }
    addTimelineItem('<strong>開啟</strong> <span class="time">' + formatTime(openedAt) + '</span>', true);

    renderGroups(tabs, groups);
  } else {
    document.getElementById('tabCount').textContent = '\u2014';
    document.getElementById('groupCount').textContent = '\u2014';
    document.getElementById('pinnedCount').textContent = '\u2014';
    addTimelineItem('<strong>開啟</strong> <span class="time">' + formatTime(openedAt) + '</span>', true);
  }
});
