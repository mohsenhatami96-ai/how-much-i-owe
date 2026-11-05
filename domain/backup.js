/** Pure backup export/import payload helpers. No IndexedDB / DOM. */

import { isImageAtt, attName } from './attachments.js';

/**
 * @param {ArrayBuffer|ArrayBufferView} buf
 * @returns {string}
 */
export function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

/**
 * @param {string} b64
 * @returns {ArrayBuffer}
 */
export function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

/**
 * @param {unknown} v
 * @returns {ArrayBuffer|null}
 */
export function dataUrlToBuf(v) {
  if (typeof v !== 'string') return null;
  const i = v.indexOf('base64,');
  return b64ToBuf(i >= 0 ? v.slice(i + 7) : v);
}

/**
 * @param {{ key: string, value: unknown }[]} meta
 * @returns {Record<string, unknown>}
 */
export function settingsFromMeta(meta) {
  return Object.fromEntries((meta || []).filter((m) => m.key !== 'lastBackup').map((m) => [m.key, m.value]));
}

/**
 * Encode one stored attachment (bytes already as ArrayBuffer) into export shape.
 * @param {object} rest attachment fields without data/thumb buffers
 * @param {ArrayBuffer} buf full file bytes
 * @param {ArrayBuffer|null|undefined} thumbBuf
 */
export function encodeAttachmentForExport(rest, buf, thumbBuf) {
  const kind = isImageAtt(rest) ? 'image' : 'file';
  const type = rest.type || (kind === 'image' ? 'image/jpeg' : 'application/octet-stream');
  return {
    ...rest,
    kind,
    type,
    name: attName(rest),
    size: buf.byteLength,
    data: `data:${type};base64,${bufToB64(buf)}`,
    thumb: thumbBuf ? `data:image/jpeg;base64,${bufToB64(thumbBuf)}` : undefined,
  };
}

/**
 * @param {{
 *   people: object[],
 *   entries: object[],
 *   encodedImages: object[],
 *   meta: { key: string, value: unknown }[],
 *   appVersion: string,
 *   exportedAt: string,
 * }} args
 */
export function buildExportPayload({ people, entries, encodedImages, meta, appVersion, exportedAt }) {
  return {
    app: 'how-much-i-owe',
    format: 2, // 2 = attachments may be any file (kind:'file', stored as Blob); format 1 = images only
    appVersion,
    exportedAt,
    settings: settingsFromMeta(meta),
    people,
    entries,
    images: encodedImages || [],
  };
}

/**
 * @param {Date} [date]
 * @returns {string}
 */
export function backupFilename(date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `how-much-i-owe-backup-${stamp}.json`;
}

/**
 * @param {object} payload
 * @param {Date} [date]
 * @returns {{ json: string, filename: string, counts: { people: number, entries: number, images: number } }}
 */
export function serializeBackup(payload, date = new Date()) {
  const json = JSON.stringify(payload);
  return {
    json,
    filename: backupFilename(date),
    counts: {
      people: (payload.people || []).length,
      entries: (payload.entries || []).length,
      images: (payload.images || []).length,
    },
  };
}

/**
 * @param {string} text
 * @returns {object}
 */
export function parseBackupText(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!data || data.app !== 'how-much-i-owe' || !Array.isArray(data.people)) {
    throw new Error('This does not look like a How Much I Owe backup.');
  }
  return data;
}

/**
 * Normalize a parsed backup (format 1 or 2) into records ready to write to IndexedDB.
 * Images: kind image → ArrayBuffer data/thumb; kind file → Blob data.
 * @param {object} data
 * @returns {{ people: object[], entries: object[], images: object[], settings: Record<string, unknown> }}
 */
export function normalizeImport(data) {
  const people = (data.people || []).filter((p) => p && p.id && typeof p.name === 'string');
  const pids = new Set(people.map((p) => p.id));
  const entries = (data.entries || []).filter((e) => e && e.id && pids.has(e.personId)).map((e) => ({
    ...e,
    amount: Math.round(Number(e.amount)) || 0,
    currency: String(e.currency || 'SEK').toUpperCase(),
    type: e.type === 'repay' ? 'repay' : 'borrow',
  }));
  const eids = new Set(entries.map((e) => e.id));
  // Backwards compatible: format-1 backups only had images (no "kind").
  const images = (data.images || []).filter((im) => im && im.id && pids.has(im.personId) && im.data).map((im) => {
    const full = dataUrlToBuf(im.data);
    const entryId = im.entryId && eids.has(im.entryId) ? im.entryId : null;
    if (im.kind === 'file') {
      const type = im.type || (/^data:([^;,]+)/.exec(im.data) || [])[1] || 'application/octet-stream';
      const { thumb, ...rest } = im;
      return { ...rest, entryId, kind: 'file', type, name: im.name || 'document', data: new Blob([full], { type }), size: full.byteLength };
    }
    return {
      ...im,
      entryId,
      kind: 'image',
      data: full,
      thumb: im.thumb ? dataUrlToBuf(im.thumb) : full,
      type: im.type || 'image/jpeg',
      name: im.name || 'photo.jpg',
      size: im.size || full.byteLength,
    };
  });
  return {
    people,
    entries,
    images,
    settings: data.settings && typeof data.settings === 'object' ? { ...data.settings } : {},
  };
}
