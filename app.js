/* How Much I Owe – a local-first PWA for tracking money you owe.
 * Data lives in IndexedDB on the device. No backend, no build step. */
import { parseAmount, fmtMoney } from './domain/money.js';
import { balanceOf, runningBalances } from './domain/balances.js';
import { entryTitle, sortEntries } from './domain/entries.js';
import {
  openDB,
  writeOps,
  txDone,
  createRepos,
  setBlockedHandler,
} from './storage/indexeddb.js';
import { $, $$, esc, fmtDate, toast, ICON, navbarScroll } from './ui/dom.js';
import { renderHome as renderHomeView } from './ui/home.js';
import { renderPerson as renderPersonView } from './ui/person.js';
import {
  openSheet,
  closeSheet,
  getSheetEl,
  currencyOptions as currencyOptionsView,
  personSheet as personSheetView,
  entrySheet as entrySheetView,
} from './ui/sheets.js';

(() => {
'use strict';

const APP_VERSION = '1.2.0';
const CURRENCIES = ['SEK', 'EUR', 'USD', 'GBP', 'NOK', 'DKK', 'IRR', 'TRY', 'CHF', 'AED', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'PLN'];
const THUMB = 360;      // longest side for thumbnails (kept separately from the stored photo)

/* =========================== IndexedDB (via storage/indexeddb.js) =========================== */
const repos = createRepos();
const { people: peopleRepo, entries: entryRepo, attachments: attachmentRepo, meta: metaRepo } = repos;

/* =========================== Utilities =========================== */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

setBlockedHandler((msg) => toast(msg));



/* =========================== Domain =========================== */

/* ---------- Attachments: images (downscaled) and any other file (stored as-is) ---------- */
const DOC_ACCEPT = 'image/*,application/pdf,.pdf,.heic,.doc,.docx,.xls,.xlsx,.txt';
const MIME_BY_EXT = {
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pages: 'application/vnd.apple.pages', numbers: 'application/vnd.apple.numbers', key: 'application/vnd.apple.keynote',
  zip: 'application/zip', json: 'application/json', html: 'text/html', eml: 'message/rfc822',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff'
};
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'];
const LARGE_FILE = 30 * 1024 * 1024;
const extOf = (name) => { const m = /\.([a-z0-9]{1,8})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; };
const mimeOf = (file) => file.type || MIME_BY_EXT[extOf(file.name)] || 'application/octet-stream';
const isImageAtt = (a) => !a.kind || a.kind === 'image';
function fmtBytes(n) {
  if (!n && n !== 0) return '?';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function fileBadge(a) {
  const ext = (extOf(a.name) || (a.type || '').split('/').pop() || 'file').slice(0, 4).toUpperCase();
  const t = a.type || '';
  const cls = t === 'application/pdf' ? 'pdf' : /word|rtf|pages/.test(t) || /^(doc|docx|pages|rtf)$/i.test(ext) ? 'doc'
    : /sheet|excel|csv|numbers/.test(t) || /^(xls|xlsx|csv|numb)$/i.test(ext) ? 'xls' : t.startsWith('image/') ? 'img' : 'gen';
  return { ext, cls };
}
const attName = (a) => a.name || (isImageAtt(a) ? 'photo.jpg' : 'file');

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image: ' + (file.name || 'unknown'))); };
    img.src = url;
  });
}
/* ---------- Photo compression ----------
 * Goal: keep small receipt / screenshot text crisp while saving space.
 * - never upscale; long side capped per quality mode
 * - high-quality step-down (halving) resampling
 * - WebP when the browser can encode it (checked via toBlob result type), else JPEG
 * - PNG screenshots: lossy (q≈0.9) vs. PNG, smallest wins
 * - never store something bigger than the original (original kept instead)
 * - EXIF orientation is applied by the browser when decoding (<img>, image-orientation: from-image) */
const PHOTO_MODES = {
  high: { label: 'High detail', max: 2560, q: 0.82, pngQ: 0.9, hint: 'Up to 2560 px. Keeps small receipt text sharp and usually saves 90%+ of the space.' },
  balanced: { label: 'Balanced', max: 2048, q: 0.78, pngQ: 0.85, hint: 'Up to 2048 px. Smaller files, text still readable.' },
  original: { label: 'Original', max: Infinity, hint: 'No compression. Uses the most storage and makes backups big.' }
};
const DISPLAYABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
let webpProbe = null;
function canEncodeWebP() {
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
const fitSize = (w, h, max) => { const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; };
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
  temps.forEach((t) => { t.width = t.height = 0; }); // free memory early on iOS
  return c;
}
const freeCanvas = (c) => { c.width = c.height = 0; };
const EXT_BY_TYPE = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };

/** Compress a photo/screenshot. opts.format forces the lossy output type (used by tests). */
async function processImage(file, mode = state.photoQuality, opts = {}) {
  const cfg = PHOTO_MODES[mode] || PHOTO_MODES.high;
  const { img, url } = await loadImage(file);
  try {
    const w0 = img.naturalWidth, h0 = img.naturalHeight; // already EXIF-oriented
    if (!w0 || !h0) throw new Error('Image has no size');
    const origType = mimeOf(file);
    const origBuf = await file.arrayBuffer();
    const keepable = DISPLAYABLE.includes(origType);

    const [tw, th] = fitSize(w0, h0, THUMB);
    const tc = drawScaled(img, w0, h0, tw, th);
    const thumbBlob = await encodeCanvas(tc, 'image/jpeg', 0.8);
    freeCanvas(tc);

    let best = null; // { blob, w, h }
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
      origSize: origBuf.byteLength, origType, origWidth: w0, origHeight: h0, photoMode: mode, keptOriginal
    };
  } finally { URL.revokeObjectURL(url); }
}
/** Non-image documents are stored unchanged as a Blob with their mime type and file name. */
async function processDocument(file) {
  const type = mimeOf(file);
  // Copy the bytes into a fresh Blob: picker-backed File objects can be short-lived on iOS.
  const data = new Blob([await file.arrayBuffer()], { type });
  return { kind: 'file', data, type, name: file.name || 'document', size: data.size };
}
async function processAttachments(files) {
  const out = [];
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f.size > LARGE_FILE && !confirm(`“${f.name}” is ${fmtBytes(f.size)}. Large files use a lot of storage and make backups big. Attach anyway?`)) continue;
    toast(list.length > 1 ? `Adding ${i + 1} of ${list.length}…` : 'Adding…', 10000);
    const looksImage = (f.type || '').startsWith('image/') || IMAGE_EXT.includes(extOf(f.name));
    try {
      if (looksImage) {
        try { out.push(await processImage(f)); continue; }
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
/** Opens the native picker. mode: 'camera' | 'docs' (photos + documents) | 'any' (iOS Files, any type). */
function pickFiles(mode = 'docs') {
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
function attachButtonsHtml(prefix) {
  return `<div class="attach-buttons">
    <button type="button" class="attach-btn" data-pick="camera" id="${prefix}-camera">${ICON.camera}<span>Camera</span></button>
    <button type="button" class="attach-btn" data-pick="docs" id="${prefix}-docs">${ICON.clip}<span>Photos &amp; docs</span></button>
    <button type="button" class="attach-btn" data-pick="any" id="${prefix}-any">${ICON.folder}<span>Other file</span></button>
  </div>`;
}
function wireAttachButtons(root, onFiles) {
  $$('.attach-btn', root).forEach((b) => (b.onclick = async () => {
    const files = await pickFiles(b.dataset.pick); // must be first: needs the tap's user activation
    if (files.length) await onFiles(files);
  }));
}
/** Thumbnail (images) or file tile (documents). */
function tileHtml(a, url, { remove = null, idx = null, caption = null } = {}) {
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
const toBlob = (data, type) => (data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' }));
async function shareOrDownload(a) {
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

/* ---------- Object URL management ---------- */
let viewUrls = [];
function blobUrl(data, type = 'image/jpeg', bucket = viewUrls) {
  const u = URL.createObjectURL(toBlob(data, type));
  bucket.push(u);
  return u;
}
function revokeAll(bucket) { bucket.forEach((u) => URL.revokeObjectURL(u)); bucket.length = 0; }
const thumbFor = (a, bucket) => (isImageAtt(a) ? (a.thumb ? blobUrl(a.thumb, 'image/jpeg', bucket) : blobUrl(a.data, a.type, bucket)) : null);

/* =========================== Rendering =========================== */
const app = $('#app');
let state = { defaultCurrency: 'SEK', photoQuality: 'high' };

function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/p\/([^/?]+)(?:\/e\/([^/?]+))?/);
  if (!m) return { name: 'home' };
  return m[2] ? { name: 'entry', pid: decodeURIComponent(m[1]), eid: decodeURIComponent(m[2]) } : { name: 'person', id: decodeURIComponent(m[1]) };
}
const personHash = (pid) => '#/p/' + encodeURIComponent(pid);
const entryHash = (pid, eid) => personHash(pid) + '/e/' + encodeURIComponent(eid);

/* In-app navigation stack, so "Back" uses history.back() when it would land on the parent page. */
const navStack = [location.hash || '#/'];
function onHashNav() {
  const h = location.hash || '#/';
  if (navStack.length >= 2 && navStack[navStack.length - 2] === h) navStack.pop();
  else navStack.push(h);
}
function goBack(parent) {
  if (navStack.length >= 2 && navStack[navStack.length - 2] === parent) history.back();
  else location.hash = parent;
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const r = route();
  const prevUrls = viewUrls; viewUrls = [];
  try {
    if (r.name === 'entry') await renderEntry(r.pid, r.eid, seq);
    else if (r.name === 'person') await renderPerson(r.id, seq);
    else await renderHome(seq);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<main><div class="empty"><div class="big">⚠️</div><h2>Something went wrong</h2><p>${esc(err.message)}</p></div></main>`;
  }
  revokeAll(prevUrls);
}

window.addEventListener('scroll', navbarScroll, { passive: true });

function homeDeps() {
  return {
    peopleRepo, entryRepo, metaRepo, state, app, renderSeq,
    personHash, personSheet, settingsSheet,
  };
}
async function renderHome(seq) { return renderHomeView(homeDeps(), seq); }

function personDeps() {
  return {
    peopleRepo, entryRepo, attachmentRepo, state, app, renderSeq,
    personSheet, entrySheet, goBack, entryHash,
    tileHtml, thumbFor, viewUrls, pickFiles, processAttachments, saveAttachments, openViewer,
  };
}
async function renderPerson(id, seq) { return renderPersonView(personDeps(), id, seq); }

function personSheet(person = null) {
  return personSheetView({
    peopleRepo, deletePerson, personHash, render, uid,
  }, person);
}

function entrySheet(person, entry = null, defaultType = 'borrow') {
  return entrySheetView({
    attachmentRepo, metaRepo, state, currencies: CURRENCIES, writeOps, uid, todayISO,
    attachButtonsHtml, wireAttachButtons, processAttachments, tileHtml, thumbFor,
    deleteEntry, route, goBack, personHash, render, revokeAll,
  }, person, entry, defaultType);
}

function currencyOptions(selected) {
  return currencyOptionsView(selected, CURRENCIES);
}






async function saveAttachments(recs, personId, entryId) {
  if (!recs.length) return;
  const now = Date.now();
  await writeOps(recs.map((p, i) => ({ store: 'images', put: { id: uid(), personId, entryId, createdAt: now + i, ...p } })));
  render();
}

async function renderEntry(pid, eid, seq) {
  const [person, entry, atts, entries] = await Promise.all([peopleRepo.get(pid), entryRepo.get(eid), attachmentRepo.listByEntry(eid), entryRepo.listByPerson(pid)]);
  if (seq !== renderSeq) return;
  if (!person) { location.replace('#/'); return; }
  if (!entry || entry.personId !== pid) { location.replace(personHash(pid)); return; }
  atts.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const runAfter = runningBalances(sortEntries(entries));
  const signed = entry.type === 'repay' ? -entry.amount : entry.amount;
  const rb = runAfter.get(entry.id) || 0;

  app.innerHTML = `
    <header class="navbar">
      <div class="nav-row">
        <button class="nav-btn" id="btn-back" aria-label="Back to ${esc(person.name)}">${ICON.back}<span class="nav-back-label">${esc(person.name)}</span></button>
        <span class="nav-title">Transaction</span>
        <button class="nav-btn" id="btn-edit-entry">Edit</button>
      </div>
    </header>
    <main>
      <section class="hero person entry-hero">
        <div class="entry-icon lg ${entry.type}">${entry.type === 'repay' ? '↑' : '↓'}</div>
        <div class="hero-label">${entry.type === 'repay' ? 'I paid back ' : 'I borrowed from '}${esc(person.name)}</div>
        <div class="hero-amount ${entry.type === 'repay' ? 'owed' : 'owe'}" id="entry-amount">${esc(fmtMoney(signed, entry.currency, { sign: true }))}</div>
        <div class="entry-desc" id="entry-desc">${esc(entryTitle(entry))}</div>
        <div class="muted">${esc(fmtDate(entry.date))} · balance after: ${esc(fmtMoney(rb, entry.currency))}${rb < 0 ? ' (owes you)' : ''}</div>
      </section>

      <div class="section-title"><span>Receipts &amp; documents</span><span id="att-total">${atts.length || ''}</span></div>
      <div class="attach-box">
        ${atts.length ? `<div class="gallery" id="entry-atts">${atts.map((a, i) => tileHtml(a, thumbFor(a, viewUrls), { idx: i })).join('')}</div>`
          : `<div class="empty-inline" style="padding:6px 4px 14px">No attachments yet. Add a receipt, screenshot or document for this transaction.</div>`}
        ${attachButtonsHtml('d')}
      </div>
      <button class="btn danger mt" style="width:100%" id="btn-delete-entry">${ICON.trash} Delete transaction</button>
    </main>
  `;
  $('#btn-back').onclick = () => goBack(personHash(pid));
  $('#btn-edit-entry').onclick = () => entrySheet(person, entry);
  wireAttachButtons(app, async (files) => saveAttachments(await processAttachments(files), pid, eid));
  $$('#entry-atts .thumb[data-idx]').forEach((b) => (b.onclick = () => openViewer(atts, Number(b.dataset.idx), new Map([[entry.id, entry]]))));
  $('#btn-delete-entry').onclick = async () => {
    if (!(await deleteEntry(entry, atts))) return;
    goBack(personHash(pid));
    render();
  };
  navbarScroll();
}

async function deleteEntry(entry, atts) {
  const n = atts.length;
  if (!confirm(`Delete this transaction${n ? ` and its ${n} attachment${n > 1 ? 's' : ''}` : ''}?`)) return false;
  await writeOps([{ store: 'entries', del: entry.id }, ...atts.map((a) => ({ store: 'images', del: a.id }))]);
  toast('Transaction deleted');
  return true;
}



async function deletePerson(id) {
  const [entries, images] = await Promise.all([entryRepo.listByPerson(id), attachmentRepo.listByPerson(id)]);
  await writeOps([
    { store: 'people', del: id },
    ...entries.map((e) => ({ store: 'entries', del: e.id })),
    ...images.map((i) => ({ store: 'images', del: i.id }))
  ]);
}


/* ---------- Full-screen viewer for images and documents ---------- */
function openViewer(items, index, entryById) {
  const urls = [];
  let i = index;
  const v = document.createElement('div');
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.innerHTML = `
    <div class="viewer-bar">
      <button class="nav-btn" data-act="close" aria-label="Close">${ICON.close}</button>
      <span class="viewer-count"></span>
      <button class="nav-btn del" data-act="delete" aria-label="Delete attachment">${ICON.trash}</button>
    </div>
    <div class="viewer-stage"></div>
    <div class="viewer-caption"></div>
    <div class="viewer-actions">
      <button class="viewer-btn" data-act="share">${ICON.share}<span>Share / Save</span></button>
      <a class="viewer-btn" data-act="open" target="_blank" rel="noopener">${ICON.open}<span>Open</span></a>
    </div>`;
  document.body.appendChild(v);
  document.body.style.overflow = 'hidden';
  const stage = $('.viewer-stage', v);
  function fileCard(a, msg) {
    const b = fileBadge(a);
    return `<div class="viewer-file"><span class="ext big ${b.cls}">${esc(b.ext)}</span>
      <div class="vf-name">${esc(attName(a))}</div><div class="vf-meta">${esc(fmtBytes(a.size))} · ${esc(a.type || 'unknown type')}</div>
      <p>${esc(msg)}</p></div>`;
  }
  function show() {
    const a = items[i];
    revokeAll(urls);
    const url = blobUrl(a.data, a.type, urls);
    const t = a.type || '';
    stage.classList.remove('zoom');
    if (isImageAtt(a)) {
      stage.innerHTML = `<img alt="${esc(attName(a))}" src="${url}" title="Tap to zoom">`;
      const im = $('img', stage);
      // Tap toggles between fit-to-screen and ~100% detail (1 image px = 1 device px on 2× screens).
      im.onclick = (ev) => {
        const r = im.getBoundingClientRect(); // measure the fitted size before switching modes
        const zoomed = stage.classList.toggle('zoom');
        if (!zoomed) { im.style.width = ''; return; }
        const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
        im.style.width = Math.max(r.width, im.naturalWidth / 2) + 'px';
        requestAnimationFrame(() => {
          stage.scrollLeft = fx * im.offsetWidth - stage.clientWidth / 2;
          stage.scrollTop = fy * im.offsetHeight - stage.clientHeight / 2;
        });
      };
    } else if (t === 'application/pdf' || t === 'text/plain') {
      stage.innerHTML = `<iframe class="doc-frame" title="${esc(attName(a))}" src="${url}"></iframe>`;
    } else if (t.startsWith('image/')) {
      stage.innerHTML = `<img alt="${esc(attName(a))}" src="${url}">`;
      $('img', stage).onerror = () => { stage.innerHTML = fileCard(a, 'This image format can’t be previewed here. Use Share / Save to open it in another app.'); };
    } else {
      stage.innerHTML = fileCard(a, 'No preview for this file type. Use Share / Save to open it in another app or save it to Files.');
    }
    const openA = $('[data-act="open"]', v);
    openA.href = url;
    openA.classList.toggle('hidden', isImageAtt(a));
    $('.viewer-count', v).textContent = items.length > 1 ? `${i + 1} of ${items.length}` : '';
    const e = a.entryId ? entryById.get(a.entryId) : null;
    $('.viewer-caption', v).textContent = (isImageAtt(a) ? '' : attName(a) + ' · ') + (e
      ? `${entryTitle(e)} · ${fmtDate(e.date)} · ${fmtMoney(e.amount, e.currency)}`
      : `Added ${new Date(a.createdAt).toLocaleDateString()}`);
  }
  function close() { revokeAll(urls); v.remove(); document.body.style.overflow = getSheetEl() ? 'hidden' : ''; document.removeEventListener('keydown', onKey); }
  const step = (d) => { if (items.length > 1) { i = (i + d + items.length) % items.length; show(); } };
  function onKey(e) { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); }
  document.addEventListener('keydown', onKey);
  $('[data-act="close"]', v).onclick = close;
  $('[data-act="share"]', v).onclick = () => shareOrDownload(items[i]);
  $('[data-act="delete"]', v).onclick = async () => {
    if (!confirm(`Delete “${attName(items[i])}”?`)) return;
    await attachmentRepo.delete(items[i].id);
    items.splice(i, 1);
    toast('Attachment deleted');
    render();
    if (!items.length) { close(); return; }
    i = Math.min(i, items.length - 1);
    show();
  };
  // Swipe left/right to navigate, swipe down to close.
  let sx = 0, sy = 0, multi = false;
  v.addEventListener('touchstart', (e) => { multi = e.touches.length > 1; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  v.addEventListener('touchend', (e) => {
    if (multi || stage.classList.contains('zoom')) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) close();
  }, { passive: true });
  show();
}

/* ---------- Settings, export & import ---------- */
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}
function dataUrlToBuf(v) {
  if (typeof v !== 'string') return null;
  const i = v.indexOf('base64,');
  return b64ToBuf(i >= 0 ? v.slice(i + 7) : v);
}

async function buildExport() {
  const [people, entries, images, meta] = await Promise.all([peopleRepo.list(), entryRepo.list(), attachmentRepo.list(), metaRepo.list()]);
  const data = {
    app: 'how-much-i-owe',
    format: 2, // 2 = attachments may be any file (kind:'file', stored as Blob); format 1 = images only
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: Object.fromEntries(meta.filter((m) => m.key !== 'lastBackup').map((m) => [m.key, m.value])),
    people, entries,
    images: []
  };
  for (const { data: bytes, thumb, ...rest } of images) {
    const kind = isImageAtt(rest) ? 'image' : 'file';
    const type = rest.type || (kind === 'image' ? 'image/jpeg' : 'application/octet-stream');
    const buf = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes;
    data.images.push({
      ...rest, kind, type, name: attName(rest), size: buf.byteLength,
      data: `data:${type};base64,${bufToB64(buf)}`,
      thumb: thumb ? `data:image/jpeg;base64,${bufToB64(thumb)}` : undefined
    });
  }
  const json = JSON.stringify(data);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return { json, filename: `how-much-i-owe-backup-${stamp}.json`, counts: { people: people.length, entries: entries.length, images: images.length } };
}

async function importData(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!data || data.app !== 'how-much-i-owe' || !Array.isArray(data.people)) throw new Error('This does not look like a How Much I Owe backup.');
  const people = data.people.filter((p) => p && p.id && typeof p.name === 'string');
  const pids = new Set(people.map((p) => p.id));
  const entries = (data.entries || []).filter((e) => e && e.id && pids.has(e.personId)).map((e) => ({
    ...e, amount: Math.round(Number(e.amount)) || 0, currency: String(e.currency || 'SEK').toUpperCase(), type: e.type === 'repay' ? 'repay' : 'borrow'
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
    return { ...im, entryId, kind: 'image', data: full, thumb: im.thumb ? dataUrlToBuf(im.thumb) : full, type: im.type || 'image/jpeg', name: im.name || 'photo.jpg', size: im.size || full.byteLength };
  });
  const db = await openDB();
  const t = db.transaction(['people', 'entries', 'images', 'meta'], 'readwrite');
  ['people', 'entries', 'images'].forEach((s) => t.objectStore(s).clear());
  const ms = t.objectStore('meta');
  people.forEach((p) => t.objectStore('people').put(p));
  entries.forEach((e) => t.objectStore('entries').put(e));
  images.forEach((im) => t.objectStore('images').put(im));
  for (const [key, value] of Object.entries(data.settings || {})) ms.put({ key, value });
  ms.put({ key: 'lastBackup', value: Date.now() }); // the imported file *is* a backup
  await txDone(t);
  if (data.settings && data.settings.defaultCurrency) state.defaultCurrency = data.settings.defaultCurrency;
  if (data.settings && PHOTO_MODES[data.settings.photoQuality]) state.photoQuality = data.settings.photoQuality;
  return { people: people.length, entries: entries.length, images: images.length };
}

async function attachmentStats() {
  const all = await attachmentRepo.list();
  let bytes = 0, photos = 0, files = 0, origBytes = 0, photoBytes = 0;
  for (const a of all) {
    const size = a.data instanceof Blob ? a.data.size : (a.data ? a.data.byteLength : 0);
    const thumb = a.thumb ? a.thumb.byteLength : 0;
    bytes += size + thumb;
    if (isImageAtt(a)) { photos++; photoBytes += size; origBytes += a.origSize || size; } else files++;
  }
  return { count: all.length, bytes, photos, files, saved: Math.max(0, origBytes - photoBytes) };
}

async function settingsSheet() {
  const [lastBackup, persisted, est, st] = await Promise.all([
    metaRepo.get('lastBackup', null),
    navigator.storage && navigator.storage.persisted ? navigator.storage.persisted().catch(() => false) : false,
    navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(() => null) : null,
    attachmentStats()
  ]);
  let prepared = null;
  const modeOptions = Object.entries(PHOTO_MODES).map(([k, m]) => `<option value="${k}" ${k === state.photoQuality ? 'selected' : ''}>${esc(m.label)}${k === 'high' ? ' (default)' : ''}</option>`).join('');
  openSheet({
    title: 'Settings & backup',
    left: 'Done',
    body: `
      <div class="field-group">
        <div class="field"><label for="s-cur" class="wide">Default currency</label><select id="s-cur">${currencyOptions(state.defaultCurrency)}</select></div>
        <div class="field"><label for="s-photo" class="wide">Photo quality</label><select id="s-photo">${modeOptions}</select></div>
      </div>
      <p class="hint" id="s-photo-hint">${esc(PHOTO_MODES[state.photoQuality].hint)} Applies to new photos.</p>
      <div class="field-group">
        <div class="field settings-row"><span>Attachments</span><span class="val" id="s-att-usage">${st.count ? `${st.count} · ${esc(fmtBytes(st.bytes))}` : 'none'}</span></div>
        ${st.photos ? `<div class="field settings-row"><span>Saved by compression</span><span class="val" id="s-att-saved">${esc(fmtBytes(st.saved))}</span></div>` : ''}
      </div>
      <div class="form-label">Backup</div>
      <div class="stack">
        <button class="btn primary" id="s-export">${ICON.share} Export backup (.json)</button>
        <button class="btn hidden" id="s-save">${ICON.share} Save backup file</button>
        <p class="muted center" id="s-counts" style="margin:0"></p>
        <button class="btn" id="s-import">Import backup…</button>
      </div>
      <p class="muted" style="margin:10px 16px 18px">
        Last backup: <b id="s-last">${lastBackup ? esc(new Date(lastBackup).toLocaleString()) : 'never'}</b>.<br>
        iOS may delete data of web apps that aren’t used for a while. Export a backup regularly and keep it in Files or iCloud Drive.
        Importing <b>replaces</b> all current data.
      </p>
      <div class="field-group">
        <div class="field settings-row"><span>Total storage used</span><span class="val">${est ? esc(fmtBytes(est.usage)) : 'unknown'}</span></div>
        <div class="field settings-row"><span>Persistent storage</span><span class="val">${persisted ? 'Granted' : 'Not granted'}</span></div>
        <div class="field settings-row"><span>Version</span><span class="val">${APP_VERSION}</span></div>
      </div>
      <p class="muted center">All data stays on this device. Nothing is uploaded.</p>
    `,
    onMount: (ov) => {
      $('#s-cur', ov).onchange = async (e) => {
        state.defaultCurrency = e.target.value;
        await metaRepo.set('defaultCurrency', state.defaultCurrency);
        toast(`Default currency: ${state.defaultCurrency}`);
        render();
      };
      $('#s-photo', ov).onchange = async (e) => {
        state.photoQuality = e.target.value;
        await metaRepo.set('photoQuality', state.photoQuality);
        $('#s-photo-hint', ov).textContent = PHOTO_MODES[state.photoQuality].hint + ' Applies to new photos.';
        toast(`Photo quality: ${PHOTO_MODES[state.photoQuality].label}`);
      };
      const saveBtn = $('#s-save', ov);
      const deliver = async () => {
        // Must run directly in a tap handler so iOS allows the share sheet.
        const file = new File([prepared.json], prepared.filename, { type: 'application/json' });
        let done = false;
        if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: 'How Much I Owe backup' }); done = true; }
          catch (err) { if (err && err.name === 'AbortError') return; }
        }
        if (!done) {
          const url = URL.createObjectURL(file);
          const a = document.createElement('a');
          a.href = url; a.download = prepared.filename; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
        await metaRepo.set('lastBackup', Date.now());
        $('#s-last', ov).textContent = new Date().toLocaleString();
        toast('Backup saved');
      };
      $('#s-export', ov).onclick = async () => {
        const b = $('#s-export', ov);
        b.disabled = true; b.textContent = 'Preparing…';
        try {
          prepared = await buildExport();
          const c = prepared.counts;
          b.innerHTML = `${ICON.share} Export backup (.json)`;
          saveBtn.classList.remove('hidden');
          saveBtn.innerHTML = `${ICON.share} Save backup file (${fmtBytes(prepared.json.length)})`;
          $('#s-counts', ov).textContent = `Backup contains ${c.people} people, ${c.entries} transactions and ${c.images} attachments.`;
          saveBtn.classList.add('primary'); b.classList.remove('primary');
          saveBtn.onclick = deliver;
          toast('Backup ready – tap “Save backup”');
        } catch (err) { console.error(err); toast('Export failed: ' + err.message, 3500); b.innerHTML = `${ICON.share} Export backup (.json)`; }
        finally { b.disabled = false; }
      };
      $('#s-import', ov).onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json,text/plain';
        input.style.display = 'none';
        input.onchange = async () => {
          const f = input.files && input.files[0];
          input.remove();
          if (!f) return;
          if (!confirm('Importing replaces ALL current people, transactions and attachments with the backup. Continue?')) return;
          try {
            toast('Importing…', 10000);
            const c = await importData(await f.text());
            closeSheet();
            toast(`Imported ${c.people} people, ${c.entries} transactions, ${c.images} attachments`, 3000);
            location.hash = '#/';
            render();
          } catch (err) { console.error(err); toast(err.message, 4000); }
        };
        document.body.appendChild(input);
        input.click();
      };
    }
  });
}

/* =========================== Boot =========================== */
// Expose a tiny API for tests / debugging.
window.oweApp = { parseAmount, balanceOf, buildExport, importData, processImage, canEncodeWebP, PHOTO_MODES, version: APP_VERSION };

window.addEventListener('hashchange', () => { onHashNav(); closeSheet(); render(); window.scrollTo(0, 0); });

async function boot() {
  try {
    state.defaultCurrency = await metaRepo.get('defaultCurrency', 'SEK');
    state.photoQuality = await metaRepo.get('photoQuality', 'high');
    if (!PHOTO_MODES[state.photoQuality]) state.photoQuality = 'high';
  } catch (err) {
    console.error(err);
    app.innerHTML = `<main><div class="empty"><div class="big">⚠️</div><h2>Storage unavailable</h2><p>This browser blocked IndexedDB (private mode?). ${esc(err.message || '')}</p></div></main>`;
    return;
  }
  await render();
  // Ask the browser not to evict our data (best effort; Safari decides heuristically).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch((err) => console.warn('SW registration failed', err)));
  // When an updated service worker takes over a page that was already controlled, reload once to pick up the new files.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded || getSheetEl()) return;
    reloaded = true;
    location.reload();
  });
}
boot();
})();

export {};
