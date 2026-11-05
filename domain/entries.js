/** Pure entry helpers: types borrow/repay, titles, sort, create/validate. No DOM / storage. */

export const ENTRY_TYPES = Object.freeze(['borrow', 'repay']);

const DESC_MAX = 140;

/**
 * @param {unknown} type
 * @returns {'borrow'|'repay'}
 */
export function normalizeEntryType(type) {
  return type === 'repay' ? 'repay' : 'borrow';
}

/**
 * @param {{ description?: unknown, type?: string }} e
 * @returns {string}
 */
export function entryTitle(e) {
  return e.description || (e.type === 'repay' ? 'Paid back' : 'Borrowed');
}

/**
 * Sort newest date first, then createdAt. Mutates and returns the array (legacy behavior).
 * @template {{ date?: string, createdAt?: number }} T
 * @param {T[]} entries
 * @returns {T[]}
 */
export function sortEntries(entries) {
  return entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * @param {{ amount: number, type?: unknown, currency?: unknown, description?: unknown, date?: unknown, fallbackDate?: string }} input
 */
export function validateEntryInput({ amount, type, currency, description, date, fallbackDate } = {}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Enter an amount greater than 0' };
  }
  const cur = String(currency || 'SEK').toUpperCase();
  const desc = String(description ?? '').trim().slice(0, DESC_MAX);
  const d = String(date || '').trim() || String(fallbackDate || '');
  return {
    ok: true,
    amount,
    type: normalizeEntryType(type),
    currency: cur,
    description: desc,
    date: d,
  };
}

/**
 * @param {{ id: string, personId: string, amount: number, type?: string, currency?: string, description?: string, date?: string, fallbackDate?: string, now?: number }} opts
 */
export function createEntry({ id, personId, amount, type, currency, description = '', date, fallbackDate, now = Date.now() }) {
  const v = validateEntryInput({ amount, type, currency, description, date, fallbackDate });
  if (!v.ok) throw new Error(v.error);
  return {
    id,
    personId,
    type: v.type,
    amount: v.amount,
    currency: v.currency,
    description: v.description,
    date: v.date,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @param {object} entry
 * @param {{ amount: number, type?: string, currency?: string, description?: string, date?: string, fallbackDate?: string }} fields
 * @param {number} [now]
 */
export function updateEntry(entry, fields, now = Date.now()) {
  const v = validateEntryInput(fields);
  if (!v.ok) throw new Error(v.error);
  return {
    ...entry,
    type: v.type,
    amount: v.amount,
    currency: v.currency,
    description: v.description,
    date: v.date,
    updatedAt: now,
  };
}
