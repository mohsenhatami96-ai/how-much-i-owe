/** Pure people helpers: avatar, initials, create/validate. No DOM / storage. */

const AVATAR_PALETTE = Object.freeze([
  '#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1',
  '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#64748b',
]);

const NAME_MAX = 80;
const NOTE_MAX = 500;

/**
 * Deterministic avatar background from a name.
 * @param {unknown} name
 * @returns {string} hex color
 */
export function avatarColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

/**
 * Up to two initials from a display name; '?' if empty.
 * @param {unknown} name
 * @returns {string}
 */
export function initials(name) {
  return (String(name).trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || '').join('') || '?').toUpperCase();
}

/**
 * @param {{ name?: unknown, note?: unknown }} input
 * @returns {{ ok: false, error: string } | { ok: true, name: string, note: string }}
 */
export function validatePersonInput({ name, note } = {}) {
  const n = String(name ?? '').trim();
  const noteTrim = String(note ?? '').trim();
  if (!n) return { ok: false, error: 'Please enter a name' };
  return { ok: true, name: n.slice(0, NAME_MAX), note: noteTrim.slice(0, NOTE_MAX) };
}

/**
 * @param {{ id: string, name: string, note?: string, now?: number }} opts
 */
export function createPerson({ id, name, note = '', now = Date.now() }) {
  const v = validatePersonInput({ name, note });
  if (!v.ok) throw new Error(v.error);
  return { id, name: v.name, note: v.note, createdAt: now, updatedAt: now };
}

/**
 * @param {object} person existing person record
 * @param {{ name: string, note?: string }} fields
 * @param {number} [now]
 */
export function updatePerson(person, { name, note = '' }, now = Date.now()) {
  const v = validatePersonInput({ name, note });
  if (!v.ok) throw new Error(v.error);
  return { ...person, name: v.name, note: v.note, updatedAt: now };
}
