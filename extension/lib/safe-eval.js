/**
 * Safe Expression Evaluator — 取代 new Function() / eval()
 *
 * 支援：
 *   - 數字、字串（'...' / "..."）、布林（true/false）、null、undefined
 *   - 變數查找（從 variables 物件）
 *   - 算術：+ - * / %
 *   - 比較：== != === !== < > <= >=
 *   - 邏輯：&& || !
 *   - 一元：- (負號)、! (非)
 *   - 括號分組
 *   - 三元運算：condition ? a : b
 *   - 屬性存取：variable.property, variable['key']
 *   - 字串拼接：'hello ' + name
 *
 * 不支援（安全考量）：
 *   - 函式呼叫（無 Function()、eval()、fetch() 等）
 *   - 賦值（=, +=, -=）
 *   - 物件/陣列字面量
 *   - delete / typeof / void / in / instanceof
 *   - 樣板字串
 */

// --- Tokenizer ---

const TOKEN = {
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  BOOLEAN: 'BOOLEAN',
  NULL: 'NULL',
  UNDEFINED: 'UNDEFINED',
  IDENT: 'IDENT',
  OP: 'OP',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  LBRACKET: 'LBRACKET',
  RBRACKET: 'RBRACKET',
  DOT: 'DOT',
  QUESTION: 'QUESTION',
  COLON: 'COLON',
  COMMA: 'COMMA',
  EOF: 'EOF'
};

function tokenize(expr) {
  const tokens = [];
  let i = 0;

  while (i < expr.length) {
    // Whitespace
    if (/\s/.test(expr[i])) { i++; continue; }

    // Number
    if (/\d/.test(expr[i]) || (expr[i] === '.' && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
      let num = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) { num += expr[i++]; }
      tokens.push({ type: TOKEN.NUMBER, value: Number(num) });
      continue;
    }

    // String
    if (expr[i] === '"' || expr[i] === "'") {
      const quote = expr[i++];
      let str = '';
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) { i++; str += expr[i++]; }
        else { str += expr[i++]; }
      }
      if (i < expr.length) i++; // skip closing quote
      tokens.push({ type: TOKEN.STRING, value: str });
      continue;
    }

    // Multi-char operators
    const two = expr.slice(i, i + 3);
    if (two === '===' || two === '!==') {
      tokens.push({ type: TOKEN.OP, value: two });
      i += 3; continue;
    }
    const pair = expr.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(pair)) {
      tokens.push({ type: TOKEN.OP, value: pair });
      i += 2; continue;
    }

    // Single-char operators and punctuation
    if ('+-*/%<>!'.includes(expr[i])) {
      tokens.push({ type: TOKEN.OP, value: expr[i++] });
      continue;
    }
    if (expr[i] === '(') { tokens.push({ type: TOKEN.LPAREN }); i++; continue; }
    if (expr[i] === ')') { tokens.push({ type: TOKEN.RPAREN }); i++; continue; }
    if (expr[i] === '[') { tokens.push({ type: TOKEN.LBRACKET }); i++; continue; }
    if (expr[i] === ']') { tokens.push({ type: TOKEN.RBRACKET }); i++; continue; }
    if (expr[i] === '.') { tokens.push({ type: TOKEN.DOT }); i++; continue; }
    if (expr[i] === '?') { tokens.push({ type: TOKEN.QUESTION }); i++; continue; }
    if (expr[i] === ':') { tokens.push({ type: TOKEN.COLON }); i++; continue; }
    if (expr[i] === ',') { tokens.push({ type: TOKEN.COMMA }); i++; continue; }

    // Identifier / keyword
    if (/[a-zA-Z_$]/.test(expr[i])) {
      let ident = '';
      while (i < expr.length && /[a-zA-Z0-9_$]/.test(expr[i])) { ident += expr[i++]; }
      if (ident === 'true') tokens.push({ type: TOKEN.BOOLEAN, value: true });
      else if (ident === 'false') tokens.push({ type: TOKEN.BOOLEAN, value: false });
      else if (ident === 'null') tokens.push({ type: TOKEN.NULL, value: null });
      else if (ident === 'undefined') tokens.push({ type: TOKEN.UNDEFINED, value: undefined });
      else tokens.push({ type: TOKEN.IDENT, value: ident });
      continue;
    }

    throw new Error(`Unexpected character: ${expr[i]} at position ${i}`);
  }

  tokens.push({ type: TOKEN.EOF });
  return tokens;
}

// --- Parser (recursive descent, produces result directly) ---

class Parser {
  constructor(tokens, variables) {
    this.tokens = tokens;
    this.variables = variables;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }

  consume(type) {
    const tok = this.tokens[this.pos];
    if (type && tok.type !== type) {
      throw new Error(`Expected ${type}, got ${tok.type}`);
    }
    this.pos++;
    return tok;
  }

  // Entry point
  parse() {
    const result = this.ternary();
    if (this.peek().type !== TOKEN.EOF) {
      throw new Error(`Unexpected token: ${JSON.stringify(this.peek())}`);
    }
    return result;
  }

  // Ternary: expr ? expr : expr
  ternary() {
    let result = this.or();
    if (this.peek().type === TOKEN.QUESTION) {
      this.consume();
      const consequent = this.ternary();
      this.consume(TOKEN.COLON);
      const alternate = this.ternary();
      return result ? consequent : alternate;
    }
    return result;
  }

  // Logical OR: ||
  or() {
    let left = this.and();
    while (this.peek().type === TOKEN.OP && this.peek().value === '||') {
      this.consume();
      const right = this.and();
      left = left || right;
    }
    return left;
  }

  // Logical AND: &&
  and() {
    let left = this.equality();
    while (this.peek().type === TOKEN.OP && this.peek().value === '&&') {
      this.consume();
      const right = this.equality();
      left = left && right;
    }
    return left;
  }

  // Equality: == != === !==
  equality() {
    let left = this.comparison();
    while (this.peek().type === TOKEN.OP && ['==', '!=', '===', '!=='].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.comparison();
      if (op === '==') left = left == right;
      else if (op === '!=') left = left != right;
      else if (op === '===') left = left === right;
      else if (op === '!==') left = left !== right;
    }
    return left;
  }

  // Comparison: < > <= >=
  comparison() {
    let left = this.addition();
    while (this.peek().type === TOKEN.OP && ['<', '>', '<=', '>='].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.addition();
      if (op === '<') left = left < right;
      else if (op === '>') left = left > right;
      else if (op === '<=') left = left <= right;
      else if (op === '>=') left = left >= right;
    }
    return left;
  }

  // Addition / subtraction / string concat: + -
  addition() {
    let left = this.multiplication();
    while (this.peek().type === TOKEN.OP && ['+', '-'].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.multiplication();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  // Multiplication / division / modulo: * / %
  multiplication() {
    let left = this.unary();
    while (this.peek().type === TOKEN.OP && ['*', '/', '%'].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.unary();
      if (op === '*') left = left * right;
      else if (op === '/') left = left / right;
      else if (op === '%') left = left % right;
    }
    return left;
  }

  // Unary: - ! + (prefix)
  unary() {
    const tok = this.peek();
    if (tok.type === TOKEN.OP && tok.value === '!') {
      this.consume();
      return !this.unary();
    }
    if (tok.type === TOKEN.OP && tok.value === '-') {
      this.consume();
      return -this.unary();
    }
    if (tok.type === TOKEN.OP && tok.value === '+') {
      this.consume();
      return +this.unary();
    }
    return this.memberAccess();
  }

  // Member access: obj.prop, obj['key']
  memberAccess() {
    let obj = this.primary();
    while (true) {
      if (this.peek().type === TOKEN.DOT) {
        this.consume();
        const prop = this.consume(TOKEN.IDENT).value;
        if (obj == null) throw new Error(`Cannot read property '${prop}' of ${obj}`);
        obj = obj[prop];
      } else if (this.peek().type === TOKEN.LBRACKET) {
        this.consume();
        const key = this.ternary();
        this.consume(TOKEN.RBRACKET);
        if (obj == null) throw new Error(`Cannot read property '${key}' of ${obj}`);
        obj = obj[key];
      } else {
        break;
      }
    }
    return obj;
  }

  // Primary: literals, variables, parenthesized expressions
  primary() {
    const tok = this.peek();

    if (tok.type === TOKEN.NUMBER) { this.consume(); return tok.value; }
    if (tok.type === TOKEN.STRING) { this.consume(); return tok.value; }
    if (tok.type === TOKEN.BOOLEAN) { this.consume(); return tok.value; }
    if (tok.type === TOKEN.NULL) { this.consume(); return null; }
    if (tok.type === TOKEN.UNDEFINED) { this.consume(); return undefined; }

    if (tok.type === TOKEN.IDENT) {
      this.consume();
      // Block dangerous globals
      const blocked = [
        'eval', 'Function', 'constructor', '__proto__', 'prototype',
        'window', 'globalThis', 'self', 'document', 'chrome',
        'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
        'setTimeout', 'setInterval', 'require', 'import', 'process'
      ];
      if (blocked.includes(tok.value)) {
        throw new Error(`Access to '${tok.value}' is not allowed in expressions`);
      }
      if (!(tok.value in this.variables)) {
        return undefined; // unknown variable → undefined (like JS)
      }
      return this.variables[tok.value];
    }

    if (tok.type === TOKEN.LPAREN) {
      this.consume();
      const result = this.ternary();
      this.consume(TOKEN.RPAREN);
      return result;
    }

    throw new Error(`Unexpected token: ${tok.type} ${tok.value !== undefined ? JSON.stringify(tok.value) : ''}`);
  }
}

// --- Public API ---

/**
 * Safely evaluate an expression string with the given variables.
 * @param {string} expression - The expression to evaluate
 * @param {Object} variables - Variable name → value mapping
 * @returns {*} The result of the expression
 * @throws {Error} If the expression is invalid or uses blocked features
 */
export function safeEval(expression, variables = {}) {
  if (typeof expression !== 'string' || !expression.trim()) {
    throw new Error('Expression must be a non-empty string');
  }
  // Length limit to prevent DoS
  if (expression.length > 1000) {
    throw new Error('Expression too long (max 1000 characters)');
  }
  const tokens = tokenize(expression);
  const parser = new Parser(tokens, variables);
  return parser.parse();
}
