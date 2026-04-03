/**
 * Flow Runner — 逐塊解析執行 flow JSON
 *
 * 用法：
 *   const runner = new FlowRunner(flow, tabId);
 *   runner.onLog = (msg) => console.log(msg);
 *   runner.onBlockStart = (block, index) => { };
 *   runner.onBlockEnd = (block, index, result) => { };
 *   const result = await runner.run();
 */

import { interpolate } from './flow-schema.js';
import * as executor from './flow-executor.js';

// --- 執行狀態 ---

export const RunState = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  DONE: 'done',
  ERROR: 'error'
};

// --- 特殊信號 ---

class BreakSignal {
  constructor() { this.type = 'break'; }
}

// --- FlowRunner ---

export class FlowRunner {
  constructor(flow, tabId) {
    this.flow = flow;
    this.tabId = tabId;
    this.variables = { ...flow.variables };
    this.state = RunState.IDLE;
    this.logs = [];
    this.timeline = []; // { block, index, startTime, endTime, duration, result, error }
    this.error = null;
    this.blockIndex = 0;
    this.blockDepth = 0; // 巢狀深度追蹤
    this.currentBlock = null;
    this.stepMode = false; // true = 每塊自動暫停
    this._pausePromise = null;
    this._pauseResolve = null;

    // 回呼（外部可覆寫）
    this.onLog = null;
    this.onBlockStart = null;
    this.onBlockEnd = null;
    this.onStateChange = null;
    this.onError = null;
    this.onVariableChange = null;
  }

  // --- 公開方法 ---

  async run() {
    if (this.state === RunState.RUNNING) return;
    this.state = RunState.RUNNING;
    this._emitState();
    this.logs = [];
    this.error = null;

    try {
      await this._runBlocks(this.flow.blocks);
      if (this.state === RunState.STOPPED) return this._result();
      this.state = RunState.DONE;
      this._emitState();
    } catch (err) {
      this.error = err.message;
      this.state = RunState.ERROR;
      this._emitState();
      this.onError?.(err);
    }
    return this._result();
  }

  stop() {
    this.state = RunState.STOPPED;
    this._emitState();
    // 如果暫停中，resume 讓它跑到 stop 檢查
    if (this._pauseResolve) this._pauseResolve();
  }

  pause() {
    if (this.state !== RunState.RUNNING) return;
    this.state = RunState.PAUSED;
    this._emitState();
    this._pausePromise = new Promise(r => { this._pauseResolve = r; });
  }

  resume() {
    if (this.state !== RunState.PAUSED) return;
    this.state = RunState.RUNNING;
    this._emitState();
    if (this._pauseResolve) {
      this._pauseResolve();
      this._pauseResolve = null;
      this._pausePromise = null;
    }
  }

  // 單步執行：resume 一次，然後自動暫停在下一塊
  step() {
    this.stepMode = true;
    if (this.state === RunState.PAUSED) {
      this.resume();
    }
  }

  // --- 內部：執行區塊列表 ---

  async _runBlocks(blocks) {
    this.blockDepth++;
    for (let i = 0; i < blocks.length; i++) {
      // 檢查停止/暫停
      if (this.state === RunState.STOPPED) { this.blockDepth--; return; }
      if (this.state === RunState.PAUSED) await this._pausePromise;
      if (this.state === RunState.STOPPED) { this.blockDepth--; return; }

      // Step mode：每塊執行前自動暫停
      if (this.stepMode && this.state === RunState.RUNNING) {
        this.state = RunState.PAUSED;
        this._emitState();
        this._pausePromise = new Promise(r => { this._pauseResolve = r; });
        await this._pausePromise;
        if (this.state === RunState.STOPPED) { this.blockDepth--; return; }
      }

      const block = blocks[i];
      this.blockIndex = i;
      this.currentBlock = block;
      this.onBlockStart?.(block, i, this.blockDepth);

      const startTime = performance.now();
      let result, blockError = null;

      try {
        result = await this._runBlock(block);
      } catch (err) {
        blockError = err;
        throw err; // 讓外層 catch 處理
      } finally {
        const endTime = performance.now();
        const entry = {
          block, index: i, depth: this.blockDepth,
          startTime, endTime, duration: Math.round(endTime - startTime),
          result: blockError ? undefined : result,
          error: blockError?.message || null
        };
        this.timeline.push(entry);
        this.onBlockEnd?.(block, i, result, entry);
        // 變數變更通知
        this.onVariableChange?.({ ...this.variables });
      }

      // break 信號往上傳遞
      if (result instanceof BreakSignal) { this.blockDepth--; return result; }
    }
    this.blockDepth--;
  }

  // --- 內部：執行單個區塊 ---

  async _runBlock(block) {
    const tab = this.tabId;
    const v = this.variables;
    const $ = (s) => interpolate(s, v); // 變數插值捷徑

    switch (block.type) {
      // === 動作 ===

      case 'click':
        await executor.click(tab, $(block.selector));
        break;

      case 'fill':
        await executor.fill(tab, $(block.selector), $(block.value), block.clearFirst !== false);
        break;

      case 'select':
        await executor.selectOption(tab, $(block.selector), $(block.value));
        break;

      case 'check':
        await executor.setChecked(tab, $(block.selector), block.checked);
        break;

      case 'scroll_to':
        await executor.scrollTo(tab, $(block.selector));
        break;

      case 'remove_element':
        await executor.removeElement(tab, $(block.selector));
        break;

      case 'set_attribute':
        await executor.setAttribute(tab, $(block.selector), $(block.attribute), $(block.value));
        break;

      case 'add_class':
        await executor.addClass(tab, $(block.selector), $(block.className));
        break;

      case 'remove_class':
        await executor.removeClass(tab, $(block.selector), $(block.className));
        break;

      case 'inject_css':
        await executor.injectCSS(tab, $(block.css));
        break;

      case 'navigate':
        await executor.navigateTo(tab, $(block.url));
        // 等待頁面載入
        await new Promise(r => setTimeout(r, 500));
        break;

      // === 等待 ===

      case 'wait_element':
        await executor.waitForElement(tab, $(block.selector), block.timeout || 5000);
        break;

      case 'wait_hidden':
        await executor.waitForHidden(tab, $(block.selector), block.timeout || 5000);
        break;

      case 'delay':
        await new Promise(r => setTimeout(r, block.ms || 1000));
        break;

      // === 資料 ===

      case 'get_text': {
        const text = await executor.getText(tab, $(block.selector));
        if (block.variable) v[block.variable] = text;
        return text;
      }

      case 'get_attribute': {
        const val = await executor.getAttribute(tab, $(block.selector), $(block.attribute));
        if (block.variable) v[block.variable] = val;
        return val;
      }

      case 'get_value': {
        const val = await executor.getValue(tab, $(block.selector));
        if (block.variable) v[block.variable] = val;
        return val;
      }

      case 'set_variable':
        v[block.variable] = $(block.value);
        break;

      case 'eval_expression': {
        const result = executor.evalExpression($(block.expression), v);
        if (block.variable) v[block.variable] = result;
        return result;
      }

      // === 邏輯 ===

      case 'if': {
        const condResult = await executor.evaluateCondition(tab, block.condition, v);
        this._log(`IF ${block.condition.type} → ${condResult}`);
        const branch = condResult ? (block.then || []) : (block.else || []);
        const branchResult = await this._runBlocks(branch);
        if (branchResult instanceof BreakSignal) return branchResult;
        break;
      }

      case 'loop': {
        const times = Number(block.times) || 1;
        for (let i = 0; i < times; i++) {
          if (this.state === RunState.STOPPED) return;
          v['_loopIndex'] = i;
          v['_loopCount'] = i + 1;
          const result = await this._runBlocks(block.body || []);
          if (result instanceof BreakSignal) break;
        }
        break;
      }

      case 'loop_elements': {
        const count = await executor.countElements(tab, $(block.selector));
        for (let i = 0; i < count; i++) {
          if (this.state === RunState.STOPPED) return;
          v['_loopIndex'] = i;
          v['_loopCount'] = i + 1;
          // 把目前元素的 nth-child selector 存到變數
          v[block.itemVariable || 'el'] = `${$(block.selector)}:nth-of-type(${i + 1})`;
          const result = await this._runBlocks(block.body || []);
          if (result instanceof BreakSignal) break;
        }
        break;
      }

      case 'try_catch': {
        try {
          await this._runBlocks(block.try || []);
        } catch (err) {
          this._log(`TRY failed: ${err.message}, running CATCH`);
          v['_error'] = err.message;
          await this._runBlocks(block.catch || []);
        }
        break;
      }

      case 'break':
        return new BreakSignal();

      // === 輸出 ===

      case 'log':
        this._log($(block.message));
        break;

      case 'alert':
        await executor.showAlert(tab, $(block.message));
        break;

      // === 自訂 ===

      case 'run_script': {
        const result = await executor.runScript(tab, $(block.code));
        return result;
      }

      default:
        throw new Error(`Unknown block type: ${block.type}`);
    }
  }

  // --- 內部工具 ---

  _log(message) {
    const entry = { time: new Date().toISOString(), message };
    this.logs.push(entry);
    this.onLog?.(entry);
  }

  _emitState() {
    this.onStateChange?.(this.state);
  }

  _result() {
    return {
      state: this.state,
      variables: { ...this.variables },
      logs: [...this.logs],
      timeline: [...this.timeline],
      error: this.error
    };
  }
}

// --- 便捷函式：直接執行 flow ---

export async function runFlow(flow, tabId, callbacks = {}) {
  const runner = new FlowRunner(flow, tabId);
  if (callbacks.onLog) runner.onLog = callbacks.onLog;
  if (callbacks.onBlockStart) runner.onBlockStart = callbacks.onBlockStart;
  if (callbacks.onBlockEnd) runner.onBlockEnd = callbacks.onBlockEnd;
  if (callbacks.onStateChange) runner.onStateChange = callbacks.onStateChange;
  if (callbacks.onError) runner.onError = callbacks.onError;
  return runner.run();
}
