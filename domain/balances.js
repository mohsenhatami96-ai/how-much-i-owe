/** Pure balance helpers. No DOM / storage.
 * Convention: positive cents = I owe them; negative = they owe me. */

/**
 * Net balance per currency from entries.
 * @param {Iterable<{type: string, amount: number, currency: string}>} entries
 * @returns {Map<string, number>} currency -> cents (zeros omitted)
 */
export function balanceOf(entries) {
  const m = new Map();
  for (const e of entries) {
    const v = e.type === 'repay' ? -e.amount : e.amount;
    m.set(e.currency, (m.get(e.currency) || 0) + v);
  }
  for (const [k, v] of m) if (v === 0) m.delete(k);
  return m;
}

/**
 * Sort balance map entries: default currency first, then code localeCompare.
 * @param {Map<string, number>} m
 * @param {string} defaultCur
 * @returns {[string, number][]}
 */
export function sortedBalances(m, defaultCur) {
  return [...m.entries()].sort((a, b) => (a[0] === defaultCur ? -1 : b[0] === defaultCur ? 1 : a[0].localeCompare(b[0])));
}

/**
 * CSS class for a net balance amount.
 * @param {number} c cents
 * @returns {'owe'|'owed'|'settled'}
 */
export function balanceClass(c) { return c > 0 ? 'owe' : c < 0 ? 'owed' : 'settled'; }

/**
 * Running balance after each entry. Input is newest-first; walks oldest→newest.
 * @param {Array<{id: string, type: string, amount: number, currency: string}>} entries
 * @returns {Map<string, number>} entryId -> balance in that entry's currency after it
 */
export function runningBalances(entries) {
  const running = new Map(), after = new Map();
  for (const e of [...entries].reverse()) {
    const v = (running.get(e.currency) || 0) + (e.type === 'repay' ? -e.amount : e.amount);
    running.set(e.currency, v);
    after.set(e.id, v);
  }
  return after;
}
