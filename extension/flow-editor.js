/**
 * Flow Editor — iOS Shortcuts 風格卡片式編輯器
 */

import { BLOCK_TYPES, BLOCK_CATEGORIES, CONDITION_TYPES, TRIGGER_TYPES,
         createFlow, createBlock, interpolate } from './lib/flow-schema.js';
import { getFlows, saveFlow, getFlowById } from './lib/storage.js';
import { FlowRunner, RunState } from './lib/flow-runner.js';

// --- State ---
let flow = null;
let workspaceId = null;
let pickerTarget = null; // { parentBlocks, index } — where to insert new block
let expandedBlocks = new Set();
let activePickerCallback = null; // for element picker
let _onBack = null; // callback when user clicks back

// --- DOM refs (resolved lazily — elements live in sidepanel.html) ---
let _refs = null;
function refs() {
  if (!_refs) {
    _refs = {
      flowNameInput: document.getElementById('flow-name'),
      flowTrigger:   document.getElementById('flow-trigger'),
      flowMatch:     document.getElementById('flow-match'),
      flowEnabled:   document.getElementById('flow-enabled'),
      canvas:        document.getElementById('canvas'),
      pickerOverlay: document.getElementById('picker-overlay'),
      pickerSearch:  document.getElementById('picker-search'),
      pickerList:    document.getElementById('picker-list'),
      saveBtn:       document.getElementById('fe-save-btn'),
      testBtn:       document.getElementById('test-btn'),
      backBtn:       document.getElementById('back-btn'),
      varsToggle:    document.getElementById('vars-toggle'),
      varsArrow:     document.getElementById('vars-arrow'),
      varsBody:      document.getElementById('vars-body'),
      varsList:      document.getElementById('vars-list'),
      addVarBtn:     document.getElementById('add-var-btn'),
    };
  }
  return _refs;
}
// Convenience aliases (assigned after first mount)
let flowNameInput, flowTrigger, flowMatch, flowEnabled, canvas,
    pickerOverlay, pickerSearch, pickerList, saveBtn, testBtn, backBtn,
    varsToggle, varsArrow, varsBody, varsList, addVarBtn;

// --- Init ---
let _mounted = false;
let _eventsAttached = false;

async function init(wsId, fId) {
  workspaceId = wsId;
  if (wsId && fId) {
    const f = await getFlowById(wsId, fId);
    if (f) {
      flow = f;
    }
  }
  if (!flow) {
    flow = createFlow('New Flow');
  }

  loadFlowToUI();
  renderCanvas();
  renderVars();
}

/**
 * Mount the flow editor view (called from sidepanel.js)
 */
export async function mountFlowEditor(wsId, fId, onBack) {
  // Resolve DOM refs on first mount
  const r = refs();
  flowNameInput = r.flowNameInput;
  flowTrigger = r.flowTrigger;
  flowMatch = r.flowMatch;
  flowEnabled = r.flowEnabled;
  canvas = r.canvas;
  pickerOverlay = r.pickerOverlay;
  pickerSearch = r.pickerSearch;
  pickerList = r.pickerList;
  saveBtn = r.saveBtn;
  testBtn = r.testBtn;
  backBtn = r.backBtn;
  varsToggle = r.varsToggle;
  varsArrow = r.varsArrow;
  varsBody = r.varsBody;
  varsList = r.varsList;
  addVarBtn = r.addVarBtn;

  _onBack = onBack;
  flow = null;
  expandedBlocks.clear();

  // Attach event listeners once
  if (!_eventsAttached) {
    attachEvents();
    _eventsAttached = true;
  }

  _mounted = true;
  await init(wsId, fId);
}

/**
 * Unmount the flow editor view
 */
export function unmountFlowEditor() {
  _mounted = false;
  // Stop any running debugger
  if (debugRunner && (debugRunner.state === RunState.RUNNING || debugRunner.state === RunState.PAUSED)) {
    debugRunner.stop();
  }
  debugRunner = null;
  // Reset debugger UI
  if (debuggerBar) debuggerBar.classList.remove('active');
  if (bottomPanels) bottomPanels.classList.remove('active');
}

function loadFlowToUI() {
  flowNameInput.value = flow.name;
  flowTrigger.value = flow.trigger;
  flowMatch.value = flow.match || '';
  flowEnabled.checked = flow.enabled;
}

function readFlowFromUI() {
  flow.name = flowNameInput.value.trim() || 'Untitled';
  flow.trigger = flowTrigger.value;
  flow.match = flowMatch.value.trim();
  flow.enabled = flowEnabled.checked;
}

// --- Canvas rendering ---

function renderCanvas() {
  canvas.innerHTML = '';
  renderBlockList(flow.blocks, canvas, null);

  // Final add button
  const addBtn = createAddButton(flow.blocks, flow.blocks.length);
  canvas.appendChild(addBtn);
}

function renderBlockList(blocks, container, parentPath) {
  blocks.forEach((block, i) => {
    const path = parentPath ? `${parentPath}.${i}` : `${i}`;

    // Connector line (except first)
    if (i > 0) {
      const conn = document.createElement('div');
      conn.className = 'connector';
      container.appendChild(conn);
    }

    const card = renderBlockCard(block, blocks, i, path);
    container.appendChild(card);
  });
}

function renderBlockCard(block, parentBlocks, index, path) {
  const def = BLOCK_TYPES[block.type];
  if (!def) return document.createElement('div');

  const card = document.createElement('div');
  card.className = 'block-card';
  card.dataset.category = def.category;
  card.dataset.path = path;
  if (expandedBlocks.has(path)) card.classList.add('expanded');

  // Drag attributes
  card.draggable = true;
  card.addEventListener('dragstart', (e) => onDragStart(e, parentBlocks, index));
  card.addEventListener('dragover', onDragOver);
  card.addEventListener('dragleave', onDragLeave);
  card.addEventListener('drop', (e) => onDrop(e, parentBlocks, index));
  card.addEventListener('dragend', onDragEnd);

  // Header
  const header = document.createElement('div');
  header.className = 'block-header';
  header.innerHTML = `
    <span class="block-drag-handle" title="Drag to reorder">&#x2630;</span>
    <span class="block-label">${def.label}</span>
    <span class="block-summary">${getBlockSummary(block)}</span>
    <div class="block-actions">
      <button class="block-action-btn duplicate" title="Duplicate">&#x2398;</button>
      <button class="block-action-btn delete" title="Delete">&times;</button>
    </div>
  `;

  // Toggle expand
  header.addEventListener('click', (e) => {
    if (e.target.closest('.block-action-btn') || e.target.closest('.block-drag-handle')) return;
    if (expandedBlocks.has(path)) {
      expandedBlocks.delete(path);
    } else {
      expandedBlocks.add(path);
    }
    renderCanvas();
  });

  // Delete
  header.querySelector('.delete').addEventListener('click', () => {
    parentBlocks.splice(index, 1);
    expandedBlocks.delete(path);
    renderCanvas();
  });

  // Duplicate
  header.querySelector('.duplicate').addEventListener('click', () => {
    const clone = structuredClone(block);
    parentBlocks.splice(index + 1, 0, clone);
    renderCanvas();
  });

  card.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'block-body';
  renderBlockFields(body, block, def);
  card.appendChild(body);

  return card;
}

// --- Block field rendering ---

function renderBlockFields(container, block, def) {
  switch (block.type) {
    case 'click':
    case 'scroll_to':
    case 'remove_element':
      container.appendChild(selectorField(block, 'selector'));
      break;

    case 'fill':
      container.appendChild(selectorField(block, 'selector'));
      container.appendChild(textField(block, 'value', 'Value'));
      container.appendChild(checkboxField(block, 'clearFirst', 'Clear first'));
      break;

    case 'select':
      container.appendChild(selectorField(block, 'selector'));
      container.appendChild(textField(block, 'value', 'Value'));
      break;

    case 'check':
      container.appendChild(selectorField(block, 'selector'));
      container.appendChild(checkboxField(block, 'checked', 'Checked'));
      break;

    case 'set_attribute':
      container.appendChild(selectorField(block, 'selector'));
      container.appendChild(textField(block, 'attribute', 'Attribute'));
      container.appendChild(textField(block, 'value', 'Value'));
      break;

    case 'add_class':
    case 'remove_class':
      container.appendChild(selectorField(block, 'selector'));
      container.appendChild(textField(block, 'className', 'Class'));
      break;

    case 'inject_css':
      container.appendChild(textareaField(block, 'css', 'CSS'));
      break;

    case 'navigate':
      container.appendChild(textField(block, 'url', 'URL'));
      break;

    case 'wait_element':
    case 'wait_hidden':
      container.appendChild(selectorField(block, 'selector'));
      container.appendChild(numberField(block, 'timeout', 'Timeout (ms)'));
      break;

    case 'delay':
      container.appendChild(numberField(block, 'ms', 'Delay (ms)'));
      break;

    case 'get_text':
    case 'get_value':
      container.appendChild(selectorField(block, 'selector'));
      container.appendChild(textField(block, 'variable', 'Save to var'));
      break;

    case 'get_attribute':
      container.appendChild(selectorField(block, 'selector'));
      container.appendChild(textField(block, 'attribute', 'Attribute'));
      container.appendChild(textField(block, 'variable', 'Save to var'));
      break;

    case 'set_variable':
      container.appendChild(textField(block, 'variable', 'Variable'));
      container.appendChild(textField(block, 'value', 'Value'));
      break;

    case 'eval_expression':
      container.appendChild(textareaField(block, 'expression', 'Expression'));
      container.appendChild(textField(block, 'variable', 'Save to var'));
      break;

    case 'log':
    case 'alert':
      container.appendChild(textField(block, 'message', 'Message'));
      break;

    case 'run_script':
      container.appendChild(textareaField(block, 'code', 'JavaScript'));
      break;

    case 'if':
      container.appendChild(conditionEditor(block));
      container.appendChild(nestedBlocksEditor(block, 'then', 'Then'));
      container.appendChild(nestedBlocksEditor(block, 'else', 'Else'));
      break;

    case 'loop':
      container.appendChild(numberField(block, 'times', 'Repeat'));
      container.appendChild(nestedBlocksEditor(block, 'body', 'Body'));
      break;

    case 'loop_elements':
      container.appendChild(selectorField(block, 'selector'));
      container.appendChild(textField(block, 'itemVariable', 'Item var'));
      container.appendChild(nestedBlocksEditor(block, 'body', 'Body'));
      break;

    case 'try_catch':
      container.appendChild(nestedBlocksEditor(block, 'try', 'Try'));
      container.appendChild(nestedBlocksEditor(block, 'catch', 'Catch'));
      break;
  }
}

// --- Field helpers ---

function selectorField(block, key) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML = `<label>Selector</label>`;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = block[key] || '';
  input.placeholder = '#id or .class';
  input.addEventListener('input', () => { block[key] = input.value; updateSummaries(); });
  row.appendChild(input);

  const pickerBtn = document.createElement('button');
  pickerBtn.className = 'picker-btn';
  pickerBtn.textContent = '\uD83C\uDFAF';
  pickerBtn.title = 'Pick element from page';
  pickerBtn.addEventListener('click', () => startElementPicker(input, pickerBtn));
  row.appendChild(pickerBtn);

  return row;
}

function textField(block, key, label) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML = `<label>${label}</label>`;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = block[key] || '';
  input.addEventListener('input', () => { block[key] = input.value; updateSummaries(); });
  row.appendChild(input);
  return row;
}

function numberField(block, key, label) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML = `<label>${label}</label>`;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = block[key] ?? '';
  input.addEventListener('input', () => { block[key] = Number(input.value); updateSummaries(); });
  row.appendChild(input);
  return row;
}

function textareaField(block, key, label) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.style.alignItems = 'flex-start';
  row.innerHTML = `<label>${label}</label>`;
  const ta = document.createElement('textarea');
  ta.value = block[key] || '';
  ta.addEventListener('input', () => { block[key] = ta.value; });
  row.appendChild(ta);
  return row;
}

function checkboxField(block, key, label) {
  const row = document.createElement('div');
  row.className = 'field-checkbox';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = block[key] !== false;
  cb.id = `cb-${Math.random().toString(36).slice(2, 8)}`;
  cb.addEventListener('change', () => { block[key] = cb.checked; });
  const lbl = document.createElement('label');
  lbl.htmlFor = cb.id;
  lbl.textContent = label;
  row.appendChild(cb);
  row.appendChild(lbl);
  return row;
}

function conditionEditor(block) {
  if (!block.condition) block.condition = { type: 'element_exists', selector: '' };
  const cond = block.condition;

  const container = document.createElement('div');
  container.style.marginTop = '10px';

  // Condition type selector
  const typeRow = document.createElement('div');
  typeRow.className = 'field-row';
  typeRow.innerHTML = `<label>Condition</label>`;
  const sel = document.createElement('select');
  for (const [type, def] of Object.entries(CONDITION_TYPES)) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = def.label;
    if (type === cond.type) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    block.condition = { type: sel.value };
    renderCanvas(); // Re-render to show new condition fields
  });
  typeRow.appendChild(sel);
  container.appendChild(typeRow);

  // Condition-specific fields
  const condDef = CONDITION_TYPES[cond.type];
  if (condDef?.params) {
    for (const [pkey, ptype] of Object.entries(condDef.params)) {
      if (pkey === 'selector') {
        container.appendChild(selectorFieldForObj(cond, pkey));
      } else {
        const row = document.createElement('div');
        row.className = 'field-row';
        const label = pkey === 'text' ? 'Text' : pkey === 'pattern' ? 'Pattern' :
                      pkey === 'variable' ? 'Variable' : pkey === 'value' ? 'Value' :
                      pkey === 'code' ? 'Expression' : pkey;
        row.innerHTML = `<label>${label}</label>`;
        const input = document.createElement(pkey === 'code' ? 'textarea' : 'input');
        input.type = 'text';
        input.value = cond[pkey] || '';
        input.addEventListener('input', () => { cond[pkey] = input.value; updateSummaries(); });
        row.appendChild(input);
        container.appendChild(row);
      }
    }
  }

  return container;
}

function selectorFieldForObj(obj, key) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML = `<label>Selector</label>`;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = obj[key] || '';
  input.placeholder = '#id or .class';
  input.addEventListener('input', () => { obj[key] = input.value; updateSummaries(); });
  row.appendChild(input);

  const pickerBtn = document.createElement('button');
  pickerBtn.className = 'picker-btn';
  pickerBtn.textContent = '\uD83C\uDFAF';
  pickerBtn.title = 'Pick element from page';
  pickerBtn.addEventListener('click', () => startElementPicker(input, pickerBtn));
  row.appendChild(pickerBtn);

  return row;
}

function nestedBlocksEditor(block, key, label) {
  if (!block[key]) block[key] = [];
  const container = document.createElement('div');
  container.className = 'nested-container';

  const header = document.createElement('div');
  header.className = 'nested-label';
  header.innerHTML = `<span>${label}</span>`;
  container.appendChild(header);

  const blocksContainer = document.createElement('div');
  blocksContainer.className = 'nested-blocks';

  renderBlockList(block[key], blocksContainer, `${block.type}-${key}`);

  const addBtn = createAddButton(block[key], block[key].length);
  blocksContainer.appendChild(addBtn);

  container.appendChild(blocksContainer);
  return container;
}

// --- Block summary (shown in collapsed header) ---

function getBlockSummary(block) {
  switch (block.type) {
    case 'click': return block.selector || '';
    case 'fill': return block.selector ? `${block.selector} = "${trunc(block.value)}"` : '';
    case 'select': return block.selector ? `${block.selector} = "${trunc(block.value)}"` : '';
    case 'check': return `${block.selector} → ${block.checked ? 'on' : 'off'}`;
    case 'scroll_to':
    case 'remove_element': return block.selector || '';
    case 'set_attribute': return `${block.selector} [${block.attribute}]`;
    case 'add_class':
    case 'remove_class': return `${block.selector} .${block.className}`;
    case 'inject_css': return trunc(block.css, 40);
    case 'navigate': return trunc(block.url, 40);
    case 'wait_element':
    case 'wait_hidden': return `${block.selector} (${block.timeout}ms)`;
    case 'delay': return `${block.ms}ms`;
    case 'get_text':
    case 'get_value': return `${block.selector} → ${block.variable}`;
    case 'get_attribute': return `${block.selector} [${block.attribute}] → ${block.variable}`;
    case 'set_variable': return `${block.variable} = "${trunc(block.value)}"`;
    case 'eval_expression': return `${block.variable} = ${trunc(block.expression, 30)}`;
    case 'log': return trunc(block.message, 40);
    case 'alert': return trunc(block.message, 40);
    case 'run_script': return trunc(block.code, 40);
    case 'if': {
      const c = block.condition;
      if (!c) return '';
      const def = CONDITION_TYPES[c.type];
      return def ? def.label + (c.selector ? ` ${c.selector}` : '') : '';
    }
    case 'loop': return `${block.times}x`;
    case 'loop_elements': return `${block.selector} as ${block.itemVariable || 'el'}`;
    case 'try_catch': return '';
    case 'break': return '';
    default: return '';
  }
}

function trunc(s, max = 30) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function updateSummaries() {
  // Re-render summaries without full rebuild
  document.querySelectorAll('.block-card').forEach(card => {
    // Summary updates happen on next full render
  });
}

// --- Add block button & picker ---

function createAddButton(targetBlocks, insertIndex) {
  const btn = document.createElement('button');
  btn.className = 'add-block-btn';
  btn.innerHTML = '+ Add Block';
  btn.addEventListener('click', () => openPicker(targetBlocks, insertIndex));
  return btn;
}

function openPicker(targetBlocks, insertIndex) {
  pickerTarget = { blocks: targetBlocks, index: insertIndex };
  pickerSearch.value = '';
  renderPickerList('');
  pickerOverlay.classList.add('open');
  setTimeout(() => pickerSearch.focus(), 50);
}

function closePicker() {
  pickerOverlay.classList.remove('open');
  pickerTarget = null;
}

function renderPickerList(query) {
  const q = query.toLowerCase();
  let html = '';

  for (const [catKey, catDef] of Object.entries(BLOCK_CATEGORIES)) {
    const items = Object.entries(BLOCK_TYPES)
      .filter(([type, def]) => def.category === catKey)
      .filter(([type, def]) => !q || def.label.toLowerCase().includes(q) || type.includes(q));

    if (items.length === 0) continue;

    html += `<div class="block-picker-category">${catDef.label}</div>`;
    for (const [type, def] of items) {
      html += `<div class="block-picker-item" data-type="${type}">
        <span class="bpi-dot" style="background:${catDef.color}"></span>
        <span>${def.label}</span>
      </div>`;
    }
  }

  pickerList.innerHTML = html;

  pickerList.querySelectorAll('.block-picker-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!pickerTarget) return;
      const type = item.dataset.type;
      const newBlock = createBlock(type);
      const { blocks, index } = pickerTarget;
      blocks.splice(index, 0, newBlock);
      // Auto-expand the new block
      expandedBlocks.add(`${index}`);
      closePicker();
      renderCanvas();
    });
  });
}

// (event listeners moved to attachEvents())

// --- Drag & drop ---

let dragData = null;

function onDragStart(e, parentBlocks, index) {
  dragData = { parentBlocks, index };
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', ''); // Required for Firefox
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e, targetBlocks, targetIndex) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!dragData) return;

  // Same list reorder
  if (dragData.parentBlocks === targetBlocks) {
    const [moved] = dragData.parentBlocks.splice(dragData.index, 1);
    const adjustedIndex = dragData.index < targetIndex ? targetIndex - 1 : targetIndex;
    targetBlocks.splice(adjustedIndex, 0, moved);
  } else {
    // Cross-container move
    const [moved] = dragData.parentBlocks.splice(dragData.index, 1);
    targetBlocks.splice(targetIndex, 0, moved);
  }

  dragData = null;
  renderCanvas();
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragData = null;
}

// --- Variables panel ---

// (event listener moved to attachEvents())

function renderVars() {
  varsList.innerHTML = '';
  for (const [key, val] of Object.entries(flow.variables)) {
    const row = document.createElement('div');
    row.className = 'var-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = key;
    nameInput.placeholder = 'name';
    nameInput.style.maxWidth = '120px';

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.value = val;
    valInput.placeholder = 'value';

    const delBtn = document.createElement('button');
    delBtn.className = 'var-delete';
    delBtn.textContent = '\u00d7';

    // Update on blur
    const oldKey = key;
    nameInput.addEventListener('blur', () => {
      const newKey = nameInput.value.trim();
      if (!newKey) return;
      if (newKey !== oldKey) {
        delete flow.variables[oldKey];
      }
      flow.variables[newKey] = valInput.value;
    });
    valInput.addEventListener('blur', () => {
      const k = nameInput.value.trim();
      if (k) flow.variables[k] = valInput.value;
    });
    delBtn.addEventListener('click', () => {
      delete flow.variables[nameInput.value.trim() || oldKey];
      renderVars();
    });

    row.appendChild(nameInput);
    row.appendChild(valInput);
    row.appendChild(delBtn);
    varsList.appendChild(row);
  }
}

// (event listener moved to attachEvents())

// --- Element Picker ---

async function startElementPicker(inputEl, btnEl) {
  const currentTab = await findTargetTab();
  if (!currentTab) {
    alert('No target tab found. Open a web page in this window first.');
    return;
  }

  btnEl.classList.add('active');
  btnEl.textContent = '...';

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: pickerScript,
      world: 'MAIN'
    });

    if (results && results[0] && results[0].result) {
      inputEl.value = results[0].result;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch (err) {
    console.error('Element picker failed:', err);
    alert('Cannot pick element on this page. Try a different tab.');
  }

  btnEl.classList.remove('active');
  btnEl.textContent = '\uD83C\uDFAF';
}

// This function runs in the target page context
function pickerScript() {
  return new Promise((resolve) => {
    const highlight = document.createElement('div');
    highlight.id = '__tabsy_picker_highlight';
    highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #0078d4;background:rgba(0,120,212,0.1);border-radius:2px;transition:all 0.05s ease;display:none;';

    const tooltip = document.createElement('div');
    tooltip.id = '__tabsy_picker_tooltip';
    tooltip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#1e1e1e;color:#d4d4d4;padding:5px 10px;border-radius:4px;font:11px/1.4 monospace;max-width:350px;display:none;white-space:pre-wrap;word-break:break-all;';

    const cursorStyle = document.createElement('style');
    cursorStyle.id = '__tabsy_picker_style';
    cursorStyle.textContent = '* { cursor: crosshair !important; }';

    document.head.appendChild(cursorStyle);
    document.body.appendChild(highlight);
    document.body.appendChild(tooltip);

    let lastEl = null;
    let resolved = false;
    // 在同一個位置的所有元素（用 Alt/Shift 滾動輪切換深度）
    let elemStack = [];
    let depthIndex = 0;

    function isPicker(el) {
      return el && el.id && el.id.startsWith('__tabsy_picker');
    }

    function getPageElements(x, y) {
      // 隱藏 picker 元素，取得真正的頁面元素堆疊
      highlight.style.display = 'none';
      tooltip.style.display = 'none';
      const all = document.elementsFromPoint(x, y);
      // 過濾掉 picker 元素、html、body
      const filtered = all.filter(el =>
        !isPicker(el) && el !== document.documentElement && el !== document.body
      );
      highlight.style.display = '';
      tooltip.style.display = '';
      return filtered;
    }

    function getSelector(el) {
      if (!el || isPicker(el)) return '';
      if (el === document.body) return 'body';
      if (el === document.documentElement) return 'html';

      // 1. ID
      if (el.id && !el.id.startsWith('__')) return `#${CSS.escape(el.id)}`;

      const tag = el.tagName.toLowerCase();

      // 2. 唯一 class
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('__'));
        for (const cls of classes) {
          const sel = `${tag}.${CSS.escape(cls)}`;
          try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
        }
        if (classes.length > 1) {
          const sel = `${tag}${classes.map(c => `.${CSS.escape(c)}`).join('')}`;
          try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
        }
      }

      // 3. 屬性
      for (const attr of ['name', 'type', 'role', 'aria-label', 'placeholder', 'href', 'src', 'alt', 'title', 'value']) {
        const val = el.getAttribute(attr);
        if (val && val.length < 80) {
          const sel = `${tag}[${attr}="${CSS.escape(val)}"]`;
          try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
        }
      }
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-') && attr.value && attr.value.length < 80) {
          const sel = `${tag}[${attr.name}="${CSS.escape(attr.value)}"]`;
          try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
        }
      }

      // 4. 短文字內容（按鈕、連結等常用這個來找）
      if (['a', 'button', 'label', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th'].includes(tag)) {
        const txt = el.textContent?.trim();
        if (txt && txt.length > 0 && txt.length < 40 && el.children.length === 0) {
          // 用 XPath text() 的 CSS 近似：找同 tag 同文字的元素
          const sameTag = [...document.querySelectorAll(tag)].filter(e => e.textContent?.trim() === txt);
          if (sameTag.length === 1) {
            // 無法純用 CSS 選文字，改用 class+nth 組合
          }
        }
      }

      // 5. nth-of-type（相對路徑）
      const parent = el.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(c => c.tagName === el.tagName);
        const parentSel = getSelector(parent);
        if (!parentSel) return tag;
        if (siblings.length === 1) {
          const sel = `${parentSel} > ${tag}`;
          return sel;
        }
        const idx = siblings.indexOf(el) + 1;
        return `${parentSel} > ${tag}:nth-of-type(${idx})`;
      }

      return tag;
    }

    function showHighlight(el) {
      if (!el) return;
      lastEl = el;
      const rect = el.getBoundingClientRect();
      highlight.style.display = 'block';
      highlight.style.left = rect.left + 'px';
      highlight.style.top = rect.top + 'px';
      highlight.style.width = rect.width + 'px';
      highlight.style.height = rect.height + 'px';

      const sel = getSelector(el);
      const tagInfo = `<${el.tagName.toLowerCase()}${el.className ? '.' + el.className.toString().split(' ')[0] : ''}>`;
      tooltip.style.display = 'block';
      tooltip.textContent = `${sel}\n${tagInfo}  ${Math.round(rect.width)}×${Math.round(rect.height)}  [depth ${depthIndex + 1}/${elemStack.length}]`;
    }

    function onMove(e) {
      const elems = getPageElements(e.clientX, e.clientY);
      if (elems.length === 0) return;

      elemStack = elems;
      depthIndex = 0; // 滑鼠移動時重設到最上層
      showHighlight(elems[0]);
      tooltip.style.left = Math.min(e.clientX + 14, window.innerWidth - 360) + 'px';
      tooltip.style.top = Math.min(e.clientY + 22, window.innerHeight - 50) + 'px';
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(lastEl ? (getSelector(lastEl) || '') : '');
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve('');
        return;
      }
      // Alt+上/下 或 滾輪 切換深度
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && elemStack.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'ArrowDown') {
          // 往下層（更深的子元素 → 但 elemStack 是從上到下，index 0 是最上層）
          // 這裡 "下層" = 往 parent = index 增加
          depthIndex = Math.min(depthIndex + 1, elemStack.length - 1);
        } else {
          // 往上層（回到更深的子元素）
          depthIndex = Math.max(depthIndex - 1, 0);
        }
        showHighlight(elemStack[depthIndex]);
      }
    }

    function onWheel(e) {
      if (elemStack.length <= 1) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY > 0) {
        // 滾下 → 往父元素
        depthIndex = Math.min(depthIndex + 1, elemStack.length - 1);
      } else {
        // 滾上 → 往子元素
        depthIndex = Math.max(depthIndex - 1, 0);
      }
      showHighlight(elemStack[depthIndex]);
    }

    function cleanup() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('wheel', onWheel, true);
      highlight.remove();
      tooltip.remove();
      cursorStyle.remove();
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  });
}

// --- Save ---

// (event listener moved to attachEvents())

// ============================================================
// Debugger
// ============================================================

let debuggerBar, dbgRun, dbgStep, dbgPause, dbgStop, dbgStateLabel, dbgStateInfo,
    bottomPanels, panelVars, panelLog, panelTimeline, varsCountBadge,
    logCountBadge, tlCountBadge, panelsClose;

let debugRunner = null;
let debugLogCount = 0;
let prevVarsSnapshot = {};

// (panel tab + close event listeners moved to attachEvents())

// --- Find target tab (current window's active tab) ---
async function findTargetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('chrome://')) {
    return tab;
  }
  // Side panel 的 currentWindow 就是使用者正在看的視窗
  // 如果 active tab 是 extension 頁面，找同視窗的其他 tab
  const win = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: win.id });
  return tabs.find(t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://')) || null;
}

// --- Start debugger ---
function startDebugger(stepMode) {
  debuggerBar.classList.add('active');
  bottomPanels.classList.add('active');
  canvas.style.paddingBottom = '45vh';
}

function stopDebugger() {
  if (debugRunner && (debugRunner.state === RunState.RUNNING || debugRunner.state === RunState.PAUSED)) {
    debugRunner.stop();
  }
  debugRunner = null;
  clearBlockHighlights();
  updateDbgButtons('idle');
}

function clearBlockHighlights() {
  canvas.querySelectorAll('.block-card').forEach(c => {
    c.classList.remove('dbg-current', 'dbg-paused', 'dbg-done', 'dbg-error');
  });
}

function updateDbgButtons(state) {
  const isRunning = state === RunState.RUNNING || state === 'running';
  const isPaused = state === RunState.PAUSED || state === 'paused';
  const isIdle = state === 'idle' || state === RunState.IDLE ||
                 state === RunState.DONE || state === RunState.ERROR ||
                 state === RunState.STOPPED;

  dbgRun.disabled = isRunning;
  dbgStep.disabled = isRunning; // can step when paused or idle
  dbgPause.disabled = !isRunning;
  dbgStop.disabled = isIdle;

  // Update state label
  const label = typeof state === 'string' ? state : 'idle';
  dbgStateLabel.textContent = label.toUpperCase();
  dbgStateLabel.className = `state-label ${label}`;
}

// --- Render variable inspector ---
function renderVarInspector(variables) {
  const entries = Object.entries(variables);
  varsCountBadge.textContent = entries.length;

  if (entries.length === 0) {
    panelVars.innerHTML = '<div class="var-inspector-empty">No variables</div>';
    return;
  }

  panelVars.innerHTML = entries.map(([k, v]) => {
    const changed = prevVarsSnapshot[k] !== undefined && prevVarsSnapshot[k] !== String(v);
    return `<div class="var-inspector-row">
      <span class="var-inspector-name">${escapeHtml(k)}</span>
      <span class="var-inspector-eq">=</span>
      <span class="var-inspector-val ${changed ? 'changed' : ''}">${escapeHtml(String(v))}</span>
    </div>`;
  }).join('');

  prevVarsSnapshot = {};
  entries.forEach(([k, v]) => { prevVarsSnapshot[k] = String(v); });
}

// --- Render log entry ---
function appendLogEntry(entry, type = 'info') {
  debugLogCount++;
  logCountBadge.textContent = debugLogCount;

  const div = document.createElement('div');
  div.className = 'log-entry';
  const time = new Date(entry.time).toLocaleTimeString();
  const icon = type === 'error' ? '&#10007;' : type === 'warn' ? '&#9888;' : '&#9679;';
  div.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-icon">${icon}</span>
    <span class="log-msg ${type}">${escapeHtml(entry.message)}</span>
  `;
  panelLog.appendChild(div);
  panelLog.scrollTop = panelLog.scrollHeight;
}

// --- Render timeline entry ---
function appendTimelineEntry(entry) {
  const tl = document.getElementById('panel-timeline');
  tlCountBadge.textContent = (debugRunner?.timeline.length || 0);

  const def = BLOCK_TYPES[entry.block.type];
  const div = document.createElement('div');
  div.className = 'tl-entry';
  div.innerHTML = `
    <span class="tl-index">${entry.index}</span>
    <span class="tl-dot ${entry.error ? 'err' : 'ok'}"></span>
    <span class="tl-label">${def?.label || entry.block.type} ${trunc(getBlockSummary(entry.block), 30)}</span>
    <span class="tl-duration">${entry.duration}ms</span>
    ${entry.error ? `<span class="tl-error">${escapeHtml(entry.error)}</span>` : ''}
  `;
  tl.appendChild(div);
  tl.scrollTop = tl.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Highlight block in canvas ---
function highlightBlock(index, cls) {
  const cards = canvas.querySelectorAll(':scope > .block-card, :scope > .connector + .block-card');
  // Simpler approach: get all top-level block-cards
  const allCards = canvas.querySelectorAll('.block-card');
  clearBlockHighlights();
  if (allCards[index]) {
    allCards[index].classList.add(cls);
    allCards[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// --- Reset panels for new run ---
function resetPanels() {
  debugLogCount = 0;
  prevVarsSnapshot = {};
  panelLog.innerHTML = '';
  panelTimeline.innerHTML = '';
  logCountBadge.textContent = '0';
  tlCountBadge.textContent = '0';
  clearBlockHighlights();
}

// --- Run flow in debugger ---
async function debugRun(stepMode = false) {
  readFlowFromUI();

  const tab = await findTargetTab();
  if (!tab) {
    alert('No target tab found. Open a web page first.');
    return;
  }

  // Stop any existing run
  if (debugRunner && (debugRunner.state === RunState.RUNNING || debugRunner.state === RunState.PAUSED)) {
    debugRunner.stop();
  }

  resetPanels();
  startDebugger(stepMode);
  updateDbgButtons('running');

  const runner = new FlowRunner(flow, tab.id);
  runner.stepMode = stepMode;
  debugRunner = runner;

  // Initialize variable inspector
  renderVarInspector(runner.variables);

  runner.onStateChange = (state) => {
    updateDbgButtons(state);
  };

  runner.onLog = (entry) => {
    appendLogEntry(entry, 'info');
  };

  runner.onBlockStart = (block, i, depth) => {
    const def = BLOCK_TYPES[block.type];
    const state = runner.stepMode && runner.state === RunState.PAUSED ? 'dbg-paused' : 'dbg-current';
    highlightBlock(i, state);
    dbgStateInfo.textContent = `Block ${i}: ${def?.label || block.type}`;
    appendLogEntry({
      time: new Date().toISOString(),
      message: `▶ ${def?.label || block.type} ${trunc(getBlockSummary(block), 40)}`
    }, 'info');
  };

  runner.onBlockEnd = (block, i, result, timelineEntry) => {
    // Mark block as done
    const allCards = canvas.querySelectorAll('.block-card');
    if (allCards[i]) {
      allCards[i].classList.remove('dbg-current', 'dbg-paused');
      allCards[i].classList.add(timelineEntry.error ? 'dbg-error' : 'dbg-done');
    }
    appendTimelineEntry(timelineEntry);
  };

  runner.onVariableChange = (vars) => {
    renderVarInspector(vars);
  };

  runner.onError = (err) => {
    appendLogEntry({ time: new Date().toISOString(), message: err.message }, 'error');
  };

  const result = await runner.run();

  // Final state update
  updateDbgButtons(result.state);
  renderVarInspector(result.variables);
  dbgStateInfo.textContent = result.error ? `Error: ${result.error}` :
    `Done in ${result.timeline.reduce((s, e) => s + e.duration, 0)}ms`;

  if (result.error) {
    appendLogEntry({ time: new Date().toISOString(), message: `Flow failed: ${result.error}` }, 'error');
  } else {
    appendLogEntry({ time: new Date().toISOString(), message: 'Flow completed successfully' }, 'info');
  }
}

// --- Debugger button handlers ---

// (debugger buttons, back button, keyboard shortcuts moved to attachEvents())

// --- attachEvents: called once on first mount ---
function attachEvents() {
  // Resolve debugger DOM refs
  debuggerBar = document.getElementById('debugger-bar');
  dbgRun = document.getElementById('dbg-run');
  dbgStep = document.getElementById('dbg-step');
  dbgPause = document.getElementById('dbg-pause');
  dbgStop = document.getElementById('dbg-stop');
  dbgStateLabel = document.getElementById('dbg-state-label');
  dbgStateInfo = document.getElementById('dbg-state-info');
  bottomPanels = document.getElementById('bottom-panels');
  panelVars = document.getElementById('panel-vars');
  panelLog = document.getElementById('panel-log');
  panelTimeline = document.getElementById('panel-timeline');
  varsCountBadge = document.getElementById('vars-count');
  logCountBadge = document.getElementById('log-count');
  tlCountBadge = document.getElementById('tl-count');
  panelsClose = document.getElementById('panels-close');

  // Picker
  pickerSearch.addEventListener('input', () => renderPickerList(pickerSearch.value));
  pickerOverlay.addEventListener('click', (e) => {
    if (e.target === pickerOverlay) closePicker();
  });

  // Variables panel
  varsToggle.addEventListener('click', () => {
    varsBody.classList.toggle('open');
    varsArrow.classList.toggle('open');
  });
  addVarBtn.addEventListener('click', () => {
    const name = `var${Object.keys(flow.variables).length + 1}`;
    flow.variables[name] = '';
    renderVars();
    const inputs = varsList.querySelectorAll('input[type="text"]');
    if (inputs.length >= 2) inputs[inputs.length - 2].focus();
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    readFlowFromUI();
    if (workspaceId) {
      await saveFlow(workspaceId, flow);
      saveBtn.textContent = 'Saved!';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
    }
  });

  // Test / debugger buttons
  testBtn.addEventListener('click', () => debugRun(false));
  dbgRun.addEventListener('click', () => {
    if (debugRunner && debugRunner.state === RunState.PAUSED) {
      debugRunner.stepMode = false;
      debugRunner.resume();
    } else {
      debugRun(false);
    }
  });
  dbgStep.addEventListener('click', () => {
    if (debugRunner && debugRunner.state === RunState.PAUSED) {
      debugRunner.step();
    } else {
      debugRun(true);
    }
  });
  dbgPause.addEventListener('click', () => {
    if (debugRunner && debugRunner.state === RunState.RUNNING) {
      debugRunner.pause();
    }
  });
  dbgStop.addEventListener('click', () => {
    stopDebugger();
  });

  // Panel tab switching
  document.querySelectorAll('#view-flow .panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#view-flow .panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('#view-flow .panel-content').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`#view-flow .panel-content[data-panel="${tab.dataset.panel}"]`).classList.add('active');
    });
  });
  panelsClose.addEventListener('click', () => {
    bottomPanels.classList.remove('active');
  });

  // Back button
  backBtn.addEventListener('click', () => {
    if (_onBack) _onBack();
  });

  // Keyboard shortcuts (only active when flow editor is shown)
  document.addEventListener('keydown', (e) => {
    if (!_mounted) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveBtn.click();
      return;
    }
    if (e.key === 'F5' && !e.shiftKey) {
      e.preventDefault();
      dbgRun.click();
      return;
    }
    if (e.key === 'F5' && e.shiftKey) {
      e.preventDefault();
      dbgStop.click();
      return;
    }
    if (e.key === 'F10') {
      e.preventDefault();
      dbgStep.click();
      return;
    }
    if (e.key === 'F6') {
      e.preventDefault();
      dbgPause.click();
      return;
    }
    if (e.key === 'Escape') {
      if (pickerOverlay.classList.contains('open')) closePicker();
    }
  });
}
