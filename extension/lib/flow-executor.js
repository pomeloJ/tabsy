/**
 * Flow Executor — 透過 chrome.scripting.executeScript 在目標 tab 執行 DOM 操作
 *
 * 每個方法都接收 tabId，把操作函式注入到目標頁面執行。
 * 離線安裝模式，可使用完整 scripting API。
 */

// --- 內部：注入並執行函式 ---

async function exec(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: 'MAIN' // 在頁面 context 中執行，可存取頁面 JS 變數
  });
  if (results && results[0]) {
    if (results[0].error) throw new Error(results[0].error.message);
    return results[0].result;
  }
  return undefined;
}

// --- DOM 查詢 ---

export async function elementExists(tabId, selector) {
  return exec(tabId, (sel) => !!document.querySelector(sel), [selector]);
}

export async function elementVisible(tabId, selector) {
  return exec(tabId, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }, [selector]);
}

export async function countElements(tabId, selector) {
  return exec(tabId, (sel) => document.querySelectorAll(sel).length, [selector]);
}

// --- 動作 ---

export async function click(tabId, selector) {
  return exec(tabId, (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.click();
    return true;
  }, [selector]);
}

export async function fill(tabId, selector, value, clearFirst = true) {
  return exec(tabId, (sel, val, clear) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    if (clear) el.value = '';
    // 模擬真實輸入事件
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, val);
    } else {
      el.value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, [selector, value, clearFirst]);
}

export async function selectOption(tabId, selector, value) {
  return exec(tabId, (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, [selector, value]);
}

export async function setChecked(tabId, selector, checked) {
  return exec(tabId, (sel, chk) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    if (el.checked !== chk) el.click();
    return true;
  }, [selector, checked]);
}

export async function scrollTo(tabId, selector) {
  return exec(tabId, (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }, [selector]);
}

export async function removeElement(tabId, selector) {
  return exec(tabId, (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.remove();
    return true;
  }, [selector]);
}

export async function setAttribute(tabId, selector, attribute, value) {
  return exec(tabId, (sel, attr, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.setAttribute(attr, val);
    return true;
  }, [selector, attribute, value]);
}

export async function addClass(tabId, selector, className) {
  return exec(tabId, (sel, cls) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.classList.add(cls);
    return true;
  }, [selector, className]);
}

export async function removeClass(tabId, selector, className) {
  return exec(tabId, (sel, cls) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.classList.remove(cls);
    return true;
  }, [selector, className]);
}

export async function injectCSS(tabId, css) {
  await chrome.scripting.insertCSS({ target: { tabId }, css });
  return true;
}

export async function navigateTo(tabId, url) {
  // Only allow http/https to prevent javascript: and data: URL injection
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Blocked navigation to unsafe URL scheme: ${url}`);
  }
  await chrome.tabs.update(tabId, { url });
  return true;
}

// --- 資料擷取 ---

export async function getText(tabId, selector) {
  return exec(tabId, (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    return el.textContent.trim();
  }, [selector]);
}

export async function getAttribute(tabId, selector, attribute) {
  return exec(tabId, (sel, attr) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    return el.getAttribute(attr);
  }, [selector, attribute]);
}

export async function getValue(tabId, selector) {
  return exec(tabId, (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    return el.value;
  }, [selector]);
}

// --- 等待 ---

export async function waitForElement(tabId, selector, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const exists = await elementExists(tabId, selector);
    if (exists) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for element: ${selector} (${timeout}ms)`);
}

export async function waitForHidden(tabId, selector, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const exists = await elementExists(tabId, selector);
    if (!exists) return true;
    const visible = await elementVisible(tabId, selector);
    if (!visible) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for element to hide: ${selector} (${timeout}ms)`);
}

// --- 條件判斷 ---

export async function evaluateCondition(tabId, condition, variables) {
  switch (condition.type) {
    case 'element_exists':
      return elementExists(tabId, condition.selector);
    case 'element_visible':
      return elementVisible(tabId, condition.selector);
    case 'element_hidden': {
      const visible = await elementVisible(tabId, condition.selector);
      return !visible;
    }
    case 'text_contains': {
      const text = await getText(tabId, condition.selector);
      return text.includes(condition.text);
    }
    case 'text_equals': {
      const text = await getText(tabId, condition.selector);
      return text === condition.text;
    }
    case 'url_contains': {
      const tab = await chrome.tabs.get(tabId);
      return tab.url.includes(condition.text);
    }
    case 'url_matches': {
      const tab = await chrome.tabs.get(tabId);
      try {
        return new RegExp(condition.pattern).test(tab.url);
      } catch {
        return false;
      }
    }
    case 'variable_equals':
      return String(variables[condition.variable] ?? '') === condition.value;
    case 'variable_contains':
      return String(variables[condition.variable] ?? '').includes(condition.value);
    case 'expression':
      return exec(tabId, (code) => {
        return !!eval(code);
      }, [condition.code]);
    default:
      throw new Error(`Unknown condition type: ${condition.type}`);
  }
}

// --- 自訂腳本 ---

export async function runScript(tabId, code) {
  return exec(tabId, (c) => eval(c), [code]);
}

// --- 彈出提示 ---

export async function showAlert(tabId, message) {
  return exec(tabId, (msg) => { alert(msg); return true; }, [message]);
}

// --- 安全表達式（在 extension context，不使用 eval / new Function） ---

import { safeEval } from './safe-eval.js';

export function evalExpression(expression, variables) {
  return safeEval(expression, variables);
}
