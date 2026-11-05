/** Browser image compression + attachment pick/tile helpers. */
import {
  DOC_ACCEPT,
  PHOTO_MODES,
  DISPLAYABLE,
  EXT_BY_TYPE,
  LARGE_FILE,
  mimeOf,
  extOf,
  isImageAtt,
  attName,
  fmtBytes,
  fileBadge,
  looksImage,
  fitSize,
} from '../domain/attachments.js';
import { $, $$, esc, ICON, toast } from './dom.js';

export { PHOTO_MODES, DOC_ACCEPT };

const THUMB = 360; // longest side for thumbnails

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image: ' + (file.name || 'unknown'))); };
    img.src = url;
  });
}

let webpProbe = null;
export function canEncodeWebP() {
  if (!webpProbe) webpProbe = new Promise((resolve) => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 4;
      c.getContext('2d').fillRect(0, 0, 4, 4);
      c.toBlob((b) => resolve(!!b && b.type === 'image/webp'), 'image/webp', 0.8);
    } catch { resolve(false); }
  });
  return webpProbe;
}

function encodeCanvas(canvas, type, q) {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b && b.type === type ? b : null), type, q); } catch { resolve(null); }
  });
}

/** High-quality resample: halve repeatedly while >= 2× the target, then one final smooth draw. */
function drawScaled(src, sw, sh, w, h, background = '#fff') {
  let cur = src, cw = sw, ch = sh;
  const temps = [];
  while (cw >= w * 2 && ch >= h * 2) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const t = document.createElement('canvas'); t.width = nw; t.height = nh;
    const tc = t.getContext('2d'); tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
    tc.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    temps.push(t); cur = t; cw = nw; ch = nh;
  }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, w, h);
  temps.forEach((t) => { t.width = t.height = 0; });
  return c;
}
const freeCanvas = (c) => { c.width = c.height = 0; };

/**
 * Compress a photo/screenshot. opts.format forces the lossy output type (used by tests).
 * @param {File} file
 * @param {string} mode
 * @param {{ format?: string }} [opts]
 */
export async function processImage(file, mode = 'high', opts = {}) {
  const cfg = PHOTO_MODES[mode] || PHOTO_MODES.high;
  const { img, url } = await loadImage(file);
  try {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('Image has no size');
    const origType = mimeOf(file);
    const origBuf = await file.arrayBuffer();
    const keepable = DISPLAYABLE.includes(origType);

    const [tw, th] = fitSize(w0, h0, THUMB);
    const tc = drawScaled(img, w0, h0, tw, th);
    const thumbBlob = await encodeCanvas(tc, 'image/jpeg', 0.8);
    freeCanvas(tc);

    let best = null;
    if (mode !== 'original' || !keepable) {
      const [w, h] = mode === 'original' ? [w0, h0] : fitSize(w0, h0, cfg.max);
      const c = drawScaled(img, w0, h0, w, h);
      const lossy = opts.format || ((await canEncodeWebP()) ? 'image/webp' : 'image/jpeg');
      const isPng = origType === 'image/png';
      const q = mode === 'original' ? 0.92 : isPng ? cfg.pngQ : cfg.q;
      const cands = [await encodeCanvas(c, lossy, q)];
      if (lossy !== 'image/jpeg' && !cands[0]) cands.push(await encodeCanvas(c, 'image/jpeg', q));
      if (isPng && (w !== w0 || h !== h0)) cands.push(await encodeCanvas(c, 'image/png'));
      freeCanvas(c);
      for (const b of cands) if (b && (!best || b.size < best.blob.size)) best = { blob: b, w, h };
      if (!best) throw new Error('Image encoding failed');
    }
    let data, type, width, height, keptOriginal = false;
    if (keepable && (!best || origBuf.byteLength <= best.blob.size)) {
      data = origBuf; type = origType; width = w0; height = h0; keptOriginal = true;
    } else {
      data = await best.blob.arrayBuffer(); type = best.blob.type; width = best.w; height = best.h;
    }
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return {
      kind: 'image', data, thumb: thumbBlob ? await thumbBlob.arrayBuffer() : null, type, width, height,
      name: `${base}.${EXT_BY_TYPE[type] || extOf(file.name) || 'img'}`, size: data.byteLength,
      origSize: origBuf.byteLength, origType, origWidth: w0, origHeight: h0, photoMode: mode, keptOriginal,
    };
  } finally { URL.revokeObjectURL(url); }
}

/** Non-image documents are stored unchanged as a Blob with their mime type and file name. */
export async function processDocument(file) {
  const type = mimeOf(file);
  const data = new Blob([await file.arrayBuffer()], { type });
  return { kind: 'file', data, type, name: file.name || 'document', size: data.size };
}

/**
 * @param {FileList|File[]} files
 * @param {{ photoQuality?: string }} [state]
 */
export async function processAttachments(files, state = { photoQuality: 'high' }) {
  const out = [];
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f.size > LARGE_FILE && !confirm(`“${f.name}” is ${fmtBytes(f.size)}. Large files use a lot of storage and make backups big. Attach anyway?`)) continue;
    toast(list.length > 1 ? `Adding ${i + 1} of ${list.length}…` : 'Adding…', 10000);
    try {
      if (looksImage(f)) {
        try { out.push(await processImage(f, state.photoQuality)); continue; }
        catch (err) { console.warn('Image could not be decoded, storing original file', err); }
      }
      out.push(await processDocument(f));
    } catch (err) { console.error(err); toast(err.message || 'Could not read file', 3000); }
  }
  if (out.length) {
    const imgs = out.filter((a) => a.kind === 'image' && a.origSize);
    const before = imgs.reduce((n, a) => n + a.origSize, 0), after = imgs.reduce((n, a) => n + a.size, 0);
    const what = out.length === 1 ? (imgs.length ? 'Photo saved' : 'File attached') : `${out.length} attachments saved`;
    toast(imgs.length ? `${what} · ${fmtBytes(before)} → ${fmtBytes(after)}` : what, 3200);
  }
  return out;
}

/** Opens the native picker. mode: 'camera' | 'docs' | 'any'. */
export function pickFiles(mode = 'docs') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (mode === 'camera') { input.accept = 'image/*'; input.setAttribute('capture', 'environment'); }
    else if (mode === 'docs') { input.accept = DOC_ACCEPT; input.multiple = true; }
    else input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve([...(input.files || [])]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export function attachButtonsHtml(prefix) {
  return `<div class="attach-buttons">
    <button type="button" class="attach-btn" data-pick="camera" id="${prefix}-camera">${ICON.camera}<span>Camera</span></button>
    <button type="button" class="attach-btn" data-pick="docs" id="${prefix}-docs">${ICON.clip}<span>Photos &amp; docs</span></button>
    <button type="button" class="attach-btn" data-pick="any" id="${prefix}-any">${ICON.folder}<span>Other file</span></button>
  </div>`;
}

export function wireAttachButtons(root, onFiles) {
  $$('.attach-btn', root).forEach((b) => (b.onclick = async () => {
    const files = await pickFiles(b.dataset.pick);
    if (files.length) await onFiles(files);
  }));
}

/** Thumbnail (images) or file tile (documents). */
export function tileHtml(a, url, { remove = null, idx = null, caption = null } = {}) {
  const inner = isImageAtt(a)
    ? `<img src="${url}" alt="">`
    : (() => { const b = fileBadge(a); return `<span class="file-tile"><span class="ext ${b.cls}">${esc(b.ext)}</span><span class="fname">${esc(attName(a))}</span><span class="fsize">${esc(fmtBytes(a.size))}</span></span>`; })();
  const tag = idx !== null ? 'button' : 'div';
  return `<${tag} class="thumb${isImageAtt(a) ? '' : ' doc'}" ${idx !== null ? `data-idx="${idx}" aria-label="Open ${esc(attName(a))}"` : ''}>
    ${inner}
    ${caption ? `<span class="badge">${esc(caption)}</span>` : ''}
    ${remove ? `<span role="button" tabindex="0" class="remove" data-key="${esc(remove)}" aria-label="Remove ${esc(attName(a))}">✕</span>` : ''}
  </${tag}>`;
}

export const toBlob = (data, type) => (data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' }));

export async function shareOrDownload(a) {
  const file = new File([toBlob(a.data, a.type)], attName(a), { type: a.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.share) {
    let can = false; try { can = navigator.canShare({ files: [file] }); } catch { can = false; }
    if (can) {
      try { await navigator.share({ files: [file], title: attName(a) }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url; link.download = attName(a); link.rel = 'noopener';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function blobUrl(data, type = 'image/jpeg', bucket) {
  const u = URL.createObjectURL(toBlob(data, type));
  bucket.push(u);
  return u;
}

export function revokeAll(bucket) {
  bucket.forEach((u) => URL.revokeObjectURL(u));
  bucket.length = 0;
}

export const thumbFor = (a, bucket) => (isImageAtt(a) ? (a.thumb ? blobUrl(a.thumb, 'image/jpeg', bucket) : blobUrl(a.data, a.type, bucket)) : null);
