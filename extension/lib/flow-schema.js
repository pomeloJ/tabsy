/**
 * Flow Schema — Block type definitions and validation
 *
 * Flow JSON format:
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

import { t } from './i18n.js';

// --- Block type definitions ---

export const BLOCK_TYPES = {
  // === Action ===
  click: {
    category: 'action',
    get label() { return t('block.click'); },
    params: { selector: 'string' },
    defaults: { selector: '' }
  },
  fill: {
    category: 'action',
    get label() { return t('block.fill'); },
    params: { selector: 'string', value: 'string', clearFirst: 'boolean' },
    defaults: { selector: '', value: '', clearFirst: true }
  },
  select: {
    category: 'action',
    get label() { return t('block.select'); },
    params: { selector: 'string', value: 'string' },
    defaults: { selector: '', value: '' }
  },
  check: {
    category: 'action',
    get label() { return t('block.check'); },
    params: { selector: 'string', checked: 'boolean' },
    defaults: { selector: '', checked: true }
  },
  scroll_to: {
    category: 'action',
    get label() { return t('block.scroll_to'); },
    params: { selector: 'string' },
    defaults: { selector: '' }
  },
  remove_element: {
    category: 'action',
    get label() { return t('block.remove_element'); },
    params: { selector: 'string' },
    defaults: { selector: '' }
  },
  set_attribute: {
    category: 'action',
    get label() { return t('block.set_attribute'); },
    params: { selector: 'string', attribute: 'string', value: 'string' },
    defaults: { selector: '', attribute: '', value: '' }
  },
  add_class: {
    category: 'action',
    get label() { return t('block.add_class'); },
    params: { selector: 'string', className: 'string' },
    defaults: { selector: '', className: '' }
  },
  remove_class: {
    category: 'action',
    get label() { return t('block.remove_class'); },
    params: { selector: 'string', className: 'string' },
    defaults: { selector: '', className: '' }
  },
  inject_css: {
    category: 'action',
    get label() { return t('block.inject_css'); },
    params: { css: 'string' },
    defaults: { css: '' }
  },
  navigate: {
    category: 'action',
    get label() { return t('block.navigate'); },
    params: { url: 'string' },
    defaults: { url: '' }
  },

  // === Wait ===
  wait_element: {
    category: 'wait',
    get label() { return t('block.wait_element'); },
    params: { selector: 'string', timeout: 'number' },
    defaults: { selector: '', timeout: 5000 }
  },
  wait_hidden: {
    category: 'wait',
    get label() { return t('block.wait_hidden'); },
    params: { selector: 'string', timeout: 'number' },
    defaults: { selector: '', timeout: 5000 }
  },
  delay: {
    category: 'wait',
    get label() { return t('block.delay'); },
    params: { ms: 'number' },
    defaults: { ms: 1000 }
  },

  // === Data ===
  get_text: {
    category: 'data',
    get label() { return t('block.get_text'); },
    params: { selector: 'string', variable: 'string' },
    defaults: { selector: '', variable: '' }
  },
  get_attribute: {
    category: 'data',
    get label() { return t('block.get_attribute'); },
    params: { selector: 'string', attribute: 'string', variable: 'string' },
    defaults: { selector: '', attribute: '', variable: '' }
  },
  get_value: {
    category: 'data',
    get label() { return t('block.get_value'); },
    params: { selector: 'string', variable: 'string' },
    defaults: { selector: '', variable: '' }
  },
  set_variable: {
    category: 'data',
    get label() { return t('block.set_variable'); },
    params: { variable: 'string', value: 'string' },
    defaults: { variable: '', value: '' }
  },
  eval_expression: {
    category: 'data',
    get label() { return t('block.eval_expression'); },
    params: { expression: 'string', variable: 'string' },
    defaults: { expression: '', variable: '' }
  },

  // === Logic ===
  if: {
    category: 'logic',
    get label() { return t('block.if'); },
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
    get label() { return t('block.loop'); },
    params: { times: 'number' },
    defaults: { times: 3, body: [] },
    hasChildren: true
  },
  loop_elements: {
    category: 'logic',
    get label() { return t('block.loop_elements'); },
    params: { selector: 'string', itemVariable: 'string' },
    defaults: { selector: '', itemVariable: 'el', body: [] },
    hasChildren: true
  },
  try_catch: {
    category: 'logic',
    get label() { return t('block.try_catch'); },
    params: {},
    defaults: { try: [], catch: [] },
    hasChildren: true
  },
  break: {
    category: 'logic',
    get label() { return t('block.break'); },
    params: {}
  },

  // === Output ===
  log: {
    category: 'output',
    get label() { return t('block.log'); },
    params: { message: 'string' },
    defaults: { message: '' }
  },
  alert: {
    category: 'output',
    get label() { return t('block.alert'); },
    params: { message: 'string' },
    defaults: { message: '' }
  },

  // === Custom ===
  run_script: {
    category: 'custom',
    get label() { return t('block.run_script'); },
    params: { code: 'string' },
    defaults: { code: '' }
  }
};

// --- Condition types (for IF blocks) ---

export const CONDITION_TYPES = {
  element_exists: {
    get label() { return t('cond.element_exists'); },
    params: { selector: 'string' }
  },
  element_visible: {
    get label() { return t('cond.element_visible'); },
    params: { selector: 'string' }
  },
  element_hidden: {
    get label() { return t('cond.element_hidden'); },
    params: { selector: 'string' }
  },
  text_contains: {
    get label() { return t('cond.text_contains'); },
    params: { selector: 'string', text: 'string' }
  },
  text_equals: {
    get label() { return t('cond.text_equals'); },
    params: { selector: 'string', text: 'string' }
  },
  url_contains: {
    get label() { return t('cond.url_contains'); },
    params: { text: 'string' }
  },
  url_matches: {
    get label() { return t('cond.url_matches'); },
    params: { pattern: 'string' }
  },
  variable_equals: {
    get label() { return t('cond.variable_equals'); },
    params: { variable: 'string', value: 'string' }
  },
  variable_contains: {
    get label() { return t('cond.variable_contains'); },
    params: { variable: 'string', value: 'string' }
  },
  expression: {
    get label() { return t('cond.expression'); },
    params: { code: 'string' }
  }
};

// --- Trigger types ---

export const TRIGGER_TYPES = {
  manual:    { get label() { return t('trigger.manual'); } },
  page_load: { get label() { return t('trigger.page_load'); } },
  page_idle: { get label() { return t('trigger.page_idle'); } }
};

// --- Block categories (for UI menu) ---

export const BLOCK_CATEGORIES = {
  action: { get label() { return t('cat.action'); }, color: '#107c10' },
  wait:   { get label() { return t('cat.wait'); },   color: '#ca5010' },
  data:   { get label() { return t('cat.data'); },   color: '#0078d4' },
  logic:  { get label() { return t('cat.logic'); },  color: '#881798' },
  output: { get label() { return t('cat.output'); }, color: '#038387' },
  custom: { get label() { return t('cat.custom'); }, color: '#69797e' }
};

// --- Create new flow ---

export function createFlow(name) {
  return {
    id: crypto.randomUUID(),
    name: name || t('newFlowName'),
    match: '',
    trigger: 'manual',
    enabled: true,
    variables: {},
    blocks: []
  };
}

// --- Create new block ---

export function createBlock(type) {
  const def = BLOCK_TYPES[type];
  if (!def) throw new Error(`Unknown block type: ${type}`);
  return { type, ...structuredClone(def.defaults) };
}

// --- Variable interpolation (supports {{var:name}} syntax) ---

export function interpolate(str, variables) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{var:(\w+)\}\}/g, (_, name) => {
    return variables[name] !== undefined ? String(variables[name]) : '';
  });
}
