/** Pure money helpers: parse user input and format minor units. No DOM / storage. */

/**
 * Parse user-typed amount ("1 234,50", "1,234.50", "12.5") into integer minor units (cents).
 * Returns NaN for empty or invalid input (matches legacy app.js behavior).
 * @param {unknown} str
 * @returns {number}
 */
export function parseAmount(str) {
  let s = String(str || '').trim().replace(/[\s\u00a0\u202f']/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal separator.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const parts = s.split(',');
    // "1,234" (3 digits after single comma, more than 1 group or leading digits) is ambiguous; treat a single comma as decimal.
    s = parts.length === 2 ? parts[0] + '.' + parts[1] : parts.join('');
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return NaN;
  const n = Number(s);
  if (!isFinite(n)) return NaN;
  return Math.round(n * 100);
}

const fmtCache = new Map();

/**
 * Format integer minor units as a currency string (currencyDisplay: code).
 * @param {number} cents
 * @param {string} currency
 * @param {{ sign?: boolean }} [opts]
 * @returns {string}
 */
export function fmtMoney(cents, currency, { sign = false } = {}) {
  const whole = Math.abs(cents) % 100 === 0;
  const key = currency + (whole ? ':0' : ':2');
  let f = fmtCache.get(key);
  if (!f) {
    const d = whole ? 0 : 2;
    try { f = new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: d, maximumFractionDigits: d }); }
    catch { f = { format: (n) => `${currency} ${n.toFixed(d)}` }; }
    fmtCache.set(key, f);
  }
  const out = f.format(Math.abs(cents) / 100);
  if (!sign || cents === 0) return out;
  return (cents > 0 ? '+' : '−') + out;
}
