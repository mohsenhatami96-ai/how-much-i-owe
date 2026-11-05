/** Pure attachment helpers: mime/ext, badges, sizes, photo-mode config. No DOM / canvas. */

export const DOC_ACCEPT = 'image/*,application/pdf,.pdf,.heic,.doc,.docx,.xls,.xlsx,.txt';

export const MIME_BY_EXT = Object.freeze({
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pages: 'application/vnd.apple.pages', numbers: 'application/vnd.apple.numbers', key: 'application/vnd.apple.keynote',
  zip: 'application/zip', json: 'application/json', html: 'text/html', eml: 'message/rfc822',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
});

export const IMAGE_EXT = Object.freeze(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp']);
export const LARGE_FILE = 30 * 1024 * 1024;

export const PHOTO_MODES = Object.freeze({
  high: Object.freeze({ label: 'High detail', max: 2560, q: 0.82, pngQ: 0.9, hint: 'Up to 2560 px. Keeps small receipt text sharp and usually saves 90%+ of the space.' }),
  balanced: Object.freeze({ label: 'Balanced', max: 2048, q: 0.78, pngQ: 0.85, hint: 'Up to 2048 px. Smaller files, text still readable.' }),
  original: Object.freeze({ label: 'Original', max: Infinity, hint: 'No compression. Uses the most storage and makes backups big.' }),
});

export const DISPLAYABLE = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const EXT_BY_TYPE = Object.freeze({
  'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
});

/**
 * @param {unknown} name
 * @returns {string}
 */
export function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * @param {{ type?: string, name?: string }} file
 * @returns {string}
 */
export function mimeOf(file) {
  return file.type || MIME_BY_EXT[extOf(file.name)] || 'application/octet-stream';
}

/**
 * @param {{ kind?: string }} a
 * @returns {boolean}
 */
export function isImageAtt(a) {
  return !a.kind || a.kind === 'image';
}

/**
 * @param {{ name?: string, kind?: string }} a
 * @returns {string}
 */
export function attName(a) {
  return a.name || (isImageAtt(a) ? 'photo.jpg' : 'file');
}

/**
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function fmtBytes(n) {
  if (!n && n !== 0) return '?';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/**
 * @param {{ name?: string, type?: string }} a
 * @returns {{ ext: string, cls: string }}
 */
export function fileBadge(a) {
  const ext = (extOf(a.name) || (a.type || '').split('/').pop() || 'file').slice(0, 4).toUpperCase();
  const t = a.type || '';
  const cls = t === 'application/pdf' ? 'pdf'
    : /word|rtf|pages/.test(t) || /^(doc|docx|pages|rtf)$/i.test(ext) ? 'doc'
      : /sheet|excel|csv|numbers/.test(t) || /^(xls|xlsx|csv|numb)$/i.test(ext) ? 'xls'
        : t.startsWith('image/') ? 'img' : 'gen';
  return { ext, cls };
}

/**
 * @param {{ type?: string, name?: string }} file
 * @returns {boolean}
 */
export function looksImage(file) {
  return (file.type || '').startsWith('image/') || IMAGE_EXT.includes(extOf(file.name));
}

/**
 * Scale to fit max long side; never upscale.
 * @param {number} w
 * @param {number} h
 * @param {number} max
 * @returns {[number, number]}
 */
export function fitSize(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}
