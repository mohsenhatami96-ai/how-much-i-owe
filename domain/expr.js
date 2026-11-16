/** Pure amount expressions. No DOM, no eval, no Function. */

import { parseAmount } from './money.js';

const MAX_LEN = 200;
const INVALID = 'Enter a valid amount';
const DIV_ZERO = "Can't divide by zero";

/**
 * @param {unknown} input
 * @returns {{ status: 'ok', cents: number } | { status: 'empty' } | { status: 'incomplete', error: string } | { status: 'error', error: string }}
 */
export function evaluateAmount(input) {
  const normalized = normalize(input);
  if (!normalized) return { status: 'empty' };
  if (normalized.length > MAX_LEN) return malformed();

  if (/^[\d.,]+$/.test(normalized)) {
    const cents = parseAmount(normalized);
    if (!Number.isNaN(cents) && Number.isSafeInteger(cents)) return { status: 'ok', cents };
    if (normalized === '.' || normalized === ',') return incomplete();
    return malformed();
  }

  const tok = tokenize(normalized);
  if (tok.status) return tok;
  const parsed = parseExpr(tok.tokens, 0);
  if (parsed.status !== 'ok') return parsed;
  if (parsed.i !== tok.tokens.length) return malformed();
  if (!Number.isFinite(parsed.value)) return malformed();
  let cents = Math.round(parsed.value * 100);
  if (Object.is(cents, -0)) cents = 0;
  if (!Number.isSafeInteger(cents)) return malformed();
  return { status: 'ok', cents };
}

/**
 * Preview line for a computed cent amount. Always two decimals.
 * @param {number} cents
 * @returns {string}
 */
export function formatAmountPreview(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const major = Math.trunc(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  return `= ${neg ? '-' : ''}${major}.${minor}`;
}

/**
 * Plain number written back into the field. Trailing zeros dropped.
 * @param {number} cents
 * @returns {string}
 */
export function formatAmountInput(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const major = Math.trunc(abs / 100);
  const minor = abs % 100;
  let body;
  if (minor === 0) body = String(major);
  else if (minor % 10 === 0) body = `${major}.${minor / 10}`;
  else body = `${major}.${String(minor).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

const KEY_CHAR = {
  '+': '+',
  '-': '\u2212',
  '*': '\u00d7',
  '/': '\u00f7',
};

/**
 * Apply an operator-row key to an amount string.
 * `paren` inserts ")" when an "(" before the cursor is unclosed, otherwise "(".
 * @param {string} value
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @param {'+'|'-'|'*'|'/'|'paren'|'back'} key
 * @returns {{ value: string, cursor: number }}
 */
export function applyAmountKey(value, selectionStart, selectionEnd, key) {
  const text = String(value ?? '');
  const len = text.length;
  const start = clamp(selectionStart, len);
  const end = clamp(selectionEnd, len);
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  if (key === 'back') {
    if (a !== b) return { value: text.slice(0, a) + text.slice(b), cursor: a };
    if (a === 0) return { value: text, cursor: 0 };
    return { value: text.slice(0, a - 1) + text.slice(b), cursor: a - 1 };
  }
  const ch = key === 'paren' ? smartParen(text, a) : KEY_CHAR[key];
  if (!ch) return { value: text, cursor: a };
  return { value: text.slice(0, a) + ch + text.slice(b), cursor: a + ch.length };
}

/**
 * @param {string} text
 * @param {number} cursor
 * @returns {string}
 */
function smartParen(text, cursor) {
  let depth = 0;
  for (let i = 0; i < cursor; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
  }
  return depth > 0 ? ')' : '(';
}

/**
 * @param {number} n
 * @param {number} len
 */
function clamp(n, len) {
  const i = Number.isFinite(n) ? n : len;
  return Math.max(0, Math.min(len, i));
}

/**
 * @param {unknown} input
 * @returns {string}
 */
function normalize(input) {
  return String(input ?? '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\u00d7/g, '*')
    .replace(/\u00f7/g, '/')
    .replace(/[\s\u00a0\u202f\u2007\u2009']/g, '');
}

function incomplete() {
  return { status: 'incomplete', error: INVALID };
}

function malformed() {
  return { status: 'error', error: INVALID };
}

/**
 * Decimal number using the same comma/dot rules as parseAmount, without rounding.
 * @param {string} raw
 * @returns {number}
 */
function toMajor(raw) {
  let s = String(raw || '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const parts = s.split(',');
    s = parts.length === 2 ? parts[0] + '.' + parts[1] : parts.join('');
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.' || s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @param {string} s
 */
function tokenize(s) {
  /** @type {{ kind: 'op', op: string } | { kind: 'num', value: number }[]} */
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '(' || c === ')') {
      tokens.push({ kind: 'op', op: c });
      i += 1;
      continue;
    }
    if ((c >= '0' && c <= '9') || c === '.' || c === ',') {
      let j = i + 1;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.' || s[j] === ',')) j += 1;
      const raw = s.slice(i, j);
      const value = toMajor(raw);
      if (Number.isNaN(value)) {
        if ((raw === '.' || raw === ',') && j === s.length) return incomplete();
        return malformed();
      }
      tokens.push({ kind: 'num', value });
      i = j;
      continue;
    }
    return malformed();
  }
  return { tokens };
}

/**
 * @param {{ kind: string, op?: string }} token
 * @param {string} a
 * @param {string} b
 */
function isOp(token, a, b) {
  return token.kind === 'op' && (token.op === a || token.op === b);
}

/**
 * @param {any[]} tokens
 * @param {number} i
 */
function parseExpr(tokens, i) {
  let left = parseTerm(tokens, i);
  if (left.status !== 'ok') return left;
  while (left.i < tokens.length && isOp(tokens[left.i], '+', '-')) {
    const op = tokens[left.i].op;
    const right = parseTerm(tokens, left.i + 1);
    if (right.status !== 'ok') return right;
    const value = op === '+' ? left.value + right.value : left.value - right.value;
    if (!Number.isFinite(value)) return malformed();
    left = { status: 'ok', value, i: right.i };
  }
  return left;
}

/**
 * @param {any[]} tokens
 * @param {number} i
 */
function parseTerm(tokens, i) {
  let left = parseUnary(tokens, i);
  if (left.status !== 'ok') return left;
  while (left.i < tokens.length && isOp(tokens[left.i], '*', '/')) {
    const op = tokens[left.i].op;
    const right = parseUnary(tokens, left.i + 1);
    if (right.status !== 'ok') return right;
    if (op === '/' && right.value === 0) return { status: 'error', error: DIV_ZERO };
    const value = op === '*' ? left.value * right.value : left.value / right.value;
    if (!Number.isFinite(value)) return malformed();
    left = { status: 'ok', value, i: right.i };
  }
  return left;
}

/**
 * @param {any[]} tokens
 * @param {number} i
 */
function parseUnary(tokens, i) {
  if (i >= tokens.length) return incomplete();
  const t = tokens[i];
  if (t.kind === 'op' && (t.op === '+' || t.op === '-')) {
    const rhs = parseUnary(tokens, i + 1);
    if (rhs.status !== 'ok') return rhs;
    const value = t.op === '-' ? -rhs.value : rhs.value;
    if (!Number.isFinite(value)) return malformed();
    return { status: 'ok', value, i: rhs.i };
  }
  return parsePrimary(tokens, i);
}

/**
 * @param {any[]} tokens
 * @param {number} i
 */
function parsePrimary(tokens, i) {
  if (i >= tokens.length) return incomplete();
  const t = tokens[i];
  if (t.kind === 'num') return { status: 'ok', value: t.value, i: i + 1 };
  if (t.kind === 'op' && t.op === '(') {
    if (i + 1 >= tokens.length) return incomplete();
    if (tokens[i + 1].kind === 'op' && tokens[i + 1].op === ')') return malformed();
    const inner = parseExpr(tokens, i + 1);
    if (inner.status !== 'ok') return inner;
    if (inner.i >= tokens.length) return incomplete();
    if (!(tokens[inner.i].kind === 'op' && tokens[inner.i].op === ')')) return malformed();
    return { status: 'ok', value: inner.value, i: inner.i + 1 };
  }
  return malformed();
}
