/**
 * Flow Schema — 區塊類型定義與驗證
 *
 * Flow JSON 格式：
 * {
 *   id: string,
 *   name: string,
 *   match: string (URL pattern, optional),
 *   trigger: 'manual' | 'page_load' | 'page_idle',
 *   enabled: boolean,
 *   variables: { [key]: value },
 *   blocks: Block[]
 * }
 */

// --- 區塊類型定義 ---

export const BLOCK_TYPES = {
  // === 動作 ===
  click: {
    category: 'action',
    label: '👆 點擊',
    params: { selector: 'string' },
    defaults: { selector: '' }
  },
  fill: {
    category: 'action',
    label: '✏️ 填入文字',
    params: { selector: 'string', value: 'string', clearFirst: 'boolean' },
    defaults: { selector: '', value: '', clearFirst: true }
  },
  select: {
    category: 'action',
    label: '📋 選擇下拉選項',
    params: { selector: 'string', value: 'string' },
    defaults: { selector: '', value: '' }
  },
  check: {
    category: 'action',
    label: '☑️ 勾選/取消',
    params: { selector: 'string', checked: 'boolean' },
    defaults: { selector: '', checked: true }
  },
  scroll_to: {
    category: 'action',
    label: '📜 捲動到元素',
    params: { selector: 'string' },
    defaults: { selector: '' }
  },
  remove_element: {
    category: 'action',
    label: '🗑️ 移除元素',
    params: { selector: 'string' },
    defaults: { selector: '' }
  },
  set_attribute: {
    category: 'action',
    label: '🏷️ 設定屬性',
    params: { selector: 'string', attribute: 'string', value: 'string' },
    defaults: { selector: '', attribute: '', value: '' }
  },
  add_class: {
    category: 'action',
    label: '🎨 新增 CSS class',
    params: { selector: 'string', className: 'string' },
    defaults: { selector: '', className: '' }
  },
  remove_class: {
    category: 'action',
    label: '🎨 移除 CSS class',
    params: { selector: 'string', className: 'string' },
    defaults: { selector: '', className: '' }
  },
  inject_css: {
    category: 'action',
    label: '💅 注入 CSS',
    params: { css: 'string' },
    defaults: { css: '' }
  },
  navigate: {
    category: 'action',
    label: '🔗 導航到網址',
    params: { url: 'string' },
    defaults: { url: '' }
  },

  // === 等待 ===
  wait_element: {
    category: 'wait',
    label: '⏳ 等待元素出現',
    params: { selector: 'string', timeout: 'number' },
    defaults: { selector: '', timeout: 5000 }
  },
  wait_hidden: {
    category: 'wait',
    label: '⏳ 等待元素消失',
    params: { selector: 'string', timeout: 'number' },
    defaults: { selector: '', timeout: 5000 }
  },
  delay: {
    category: 'wait',
    label: '⏱️ 延遲等待',
    params: { ms: 'number' },
    defaults: { ms: 1000 }
  },

  // === 資料 ===
  get_text: {
    category: 'data',
    label: '📋 取得文字',
    params: { selector: 'string', variable: 'string' },
    defaults: { selector: '', variable: '' }
  },
  get_attribute: {
    category: 'data',
    label: '📋 取得屬性值',
    params: { selector: 'string', attribute: 'string', variable: 'string' },
    defaults: { selector: '', attribute: '', variable: '' }
  },
  get_value: {
    category: 'data',
    label: '📋 取得輸入值',
    params: { selector: 'string', variable: 'string' },
    defaults: { selector: '', variable: '' }
  },
  set_variable: {
    category: 'data',
    label: '📦 設定變數',
    params: { variable: 'string', value: 'string' },
    defaults: { variable: '', value: '' }
  },
  eval_expression: {
    category: 'data',
    label: '🧮 計算表達式',
    params: { expression: 'string', variable: 'string' },
    defaults: { expression: '', variable: '' }
  },

  // === 邏輯 ===
  if: {
    category: 'logic',
    label: '❓ 如果',
    params: { condition: 'condition' },
    defaults: {
      condition: { type: 'element_exists', selector: '' },
      then: [],
      else: []
    },
    hasChildren: true
  },
  loop: {
    category: 'logic',
    label: '🔄 迴圈',
    params: { times: 'number' },
    defaults: { times: 3, body: [] },
    hasChildren: true
  },
  loop_elements: {
    category: 'logic',
    label: '🔄 遍歷元素',
    params: { selector: 'string', itemVariable: 'string' },
    defaults: { selector: '', itemVariable: 'el', body: [] },
    hasChildren: true
  },
  try_catch: {
    category: 'logic',
    label: '🛡️ 嘗試/失敗',
    params: {},
    defaults: { try: [], catch: [] },
    hasChildren: true
  },
  break: {
    category: 'logic',
    label: '⏹️ 中斷迴圈',
    params: {}
  },

  // === 輸出 ===
  log: {
    category: 'output',
    label: '💬 記錄訊息',
    params: { message: 'string' },
    defaults: { message: '' }
  },
  alert: {
    category: 'output',
    label: '🔔 彈出提示',
    params: { message: 'string' },
    defaults: { message: '' }
  },

  // === 自訂 ===
  run_script: {
    category: 'custom',
    label: '⚡ 執行 JS 腳本',
    params: { code: 'string' },
    defaults: { code: '' }
  }
};

// --- 條件類型（IF 區塊用） ---

export const CONDITION_TYPES = {
  element_exists: {
    label: '元素存在',
    params: { selector: 'string' }
  },
  element_visible: {
    label: '元素可見',
    params: { selector: 'string' }
  },
  element_hidden: {
    label: '元素隱藏',
    params: { selector: 'string' }
  },
  text_contains: {
    label: '文字包含',
    params: { selector: 'string', text: 'string' }
  },
  text_equals: {
    label: '文字等於',
    params: { selector: 'string', text: 'string' }
  },
  url_contains: {
    label: 'URL 包含',
    params: { text: 'string' }
  },
  url_matches: {
    label: 'URL 符合 pattern',
    params: { pattern: 'string' }
  },
  variable_equals: {
    label: '變數等於',
    params: { variable: 'string', value: 'string' }
  },
  variable_contains: {
    label: '變數包含',
    params: { variable: 'string', value: 'string' }
  },
  expression: {
    label: '自訂表達式',
    params: { code: 'string' }
  }
};

// --- 觸發類型 ---

export const TRIGGER_TYPES = {
  manual:    { label: '手動觸發' },
  page_load: { label: '頁面載入時' },
  page_idle: { label: '頁面閒置時 (document_idle)' }
};

// --- 區塊分類（給 UI 選單用） ---

export const BLOCK_CATEGORIES = {
  action: { label: '動作', color: '#107c10' },
  wait:   { label: '等待', color: '#ca5010' },
  data:   { label: '資料', color: '#0078d4' },
  logic:  { label: '邏輯', color: '#881798' },
  output: { label: '輸出', color: '#038387' },
  custom: { label: '自訂', color: '#69797e' }
};

// --- 建立新 flow ---

export function createFlow(name = '新流程') {
  return {
    id: crypto.randomUUID(),
    name,
    match: '',
    trigger: 'manual',
    enabled: true,
    variables: {},
    blocks: []
  };
}

// --- 建立新區塊 ---

export function createBlock(type) {
  const def = BLOCK_TYPES[type];
  if (!def) throw new Error(`Unknown block type: ${type}`);
  return { type, ...structuredClone(def.defaults) };
}

// --- 變數插值 (支援 {{var:name}} 語法) ---

export function interpolate(str, variables) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{var:(\w+)\}\}/g, (_, name) => {
    return variables[name] !== undefined ? String(variables[name]) : '';
  });
}
