/* How Much I Owe – a local-first PWA for tracking money you owe.
 * Data lives in IndexedDB on the device. No backend, no build step. */
(() => {
'use strict';

const APP_VERSION = '1.0.0';
const CURRENCIES = ['SEK', 'EUR', 'USD', 'GBP', 'NOK', 'DKK', 'IRR', 'TRY', 'CHF', 'AED', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'PLN'];
const MAX_IMG = 1600;   // longest side for stored photos
const THUMB = 360;      // longest side for thumbnails
const JPEG_Q = 0.82;

/* =========================== IndexedDB =========================== */
const DB_NAME = 'how-much-i-owe';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('people')) db.createObjectStore('people', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('personId', 'personId');
      }
      if (!db.objectStoreNames.contains('images')) {
        const s = db.createObjectStore('images', { keyPath: 'id' });
        s.createIndex('personId', 'personId');
        s.createIndex('entryId', 'entryId');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => toast('Close other tabs of this app to finish updating.');
  });
  return dbPromise;
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transaction aborted')); });

async function getAll(store, index, key) {
  const db = await openDB();
  const s = db.transaction(store, 'readonly').objectStore(store);
  return reqP(index ? s.index(index).getAll(key) : s.getAll());
}
async function getOne(store, key) {
  const db = await openDB();
  return reqP(db.transaction(store, 'readonly').objectStore(store).get(key));
}
/** Run a set of writes in one transaction. ops: [{store, put}|{store, del}] */
async function writeOps(ops) {
  if (!ops.length) return;
  const db = await openDB();
  const stores = [...new Set(ops.map((o) => o.store))];
  const t = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const s = t.objectStore(o.store);
    if (o.put !== undefined) s.put(o.put); else s.delete(o.del);
  }
  return txDone(t);
}
async function getMeta(key, fallback) {
  const r = await getOne('meta', key);
  return r ? r.value : fallback;
}
const setMeta = (key, value) => writeOps([{ store: 'meta', put: { key, value } }]);

/* =========================== Utilities =========================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

/** Parse user-typed amount ("1 234,50", "1,234.50", "12.5") into integer minor units (cents). */
function parseAmount(str) {
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
function fmtMoney(cents, currency, { sign = false } = {}) {
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
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const sameYear = dt.getFullYear() === new Date().getFullYear();
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
function avatarColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const palette = ['#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#64748b'];
  return palette[h % palette.length];
}
const initials = (name) => (String(name).trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || '').join('') || '?').toUpperCase();

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>'
};

/* =========================== Domain =========================== */
/** Returns Map(currency -> cents). Positive = I owe them. */
function balanceOf(entries) {
  const m = new Map();
  for (const e of entries) {
    const v = e.type === 'repay' ? -e.amount : e.amount;
    m.set(e.currency, (m.get(e.currency) || 0) + v);
  }
  for (const [k, v] of m) if (v === 0) m.delete(k);
  return m;
}
function sortedBalances(m, defaultCur) {
  return [...m.entries()].sort((a, b) => (a[0] === defaultCur ? -1 : b[0] === defaultCur ? 1 : a[0].localeCompare(b[0])));
}
function balanceClass(c) { return c > 0 ? 'owe' : c < 0 ? 'owed' : 'settled'; }

/* ---------- Image processing ---------- */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image: ' + (file.name || 'unknown'))); };
    img.src = url;
  });
}
function canvasToBlob(canvas, q) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), 'image/jpeg', q));
}
async function scaleTo(img, max) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; // flatten transparent PNGs onto white for JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await canvasToBlob(c, JPEG_Q);
  c.width = c.height = 0; // free memory early on iOS
  return { blob, w, h };
}
/** Downscale a File to max 1600px JPEG + a thumbnail. Returns ArrayBuffers (most robust in Safari IDB). */
async function processImage(file) {
  const { img, url } = await loadImage(file);
  try {
    const full = await scaleTo(img, MAX_IMG);
    const thumb = await scaleTo(img, THUMB);
    return {
      data: await full.blob.arrayBuffer(), thumb: await thumb.blob.arrayBuffer(),
      type: 'image/jpeg', width: full.w, height: full.h, name: file.name || 'photo.jpg'
    };
  } finally { URL.revokeObjectURL(url); }
}
async function processFiles(files) {
  const out = [];
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    if (list.length > 1) toast(`Processing photo ${i + 1} of ${list.length}…`, 10000);
    else toast('Processing photo…', 10000);
    try { out.push(await processImage(list[i])); }
    catch (err) { console.error(err); toast(err.message, 3000); }
  }
  if (out.length) toast(out.length === 1 ? 'Photo added' : `${out.length} photos added`);
  return out;
}
/** Opens the native picker (camera / photo library on iPhone). */
function pickImages() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve([...(input.files || [])]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

/* ---------- Object URL management ---------- */
let viewUrls = [];
function blobUrl(buf, type = 'image/jpeg', bucket = viewUrls) {
  const u = URL.createObjectURL(new Blob([buf], { type }));
  bucket.push(u);
  return u;
}
function revokeAll(bucket) { bucket.forEach((u) => URL.revokeObjectURL(u)); bucket.length = 0; }

/* =========================== Rendering =========================== */
const app = $('#app');
let state = { defaultCurrency: 'SEK' };

function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/p\/([^/?]+)/);
  return m ? { name: 'person', id: decodeURIComponent(m[1]) } : { name: 'home' };
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const r = route();
  const prevUrls = viewUrls; viewUrls = [];
  try {
    if (r.name === 'person') await renderPerson(r.id, seq);
    else await renderHome(seq);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<main><div class="empty"><div class="big">⚠️</div><h2>Something went wrong</h2><p>${esc(err.message)}</p></div></main>`;
  }
  revokeAll(prevUrls);
}

function navbarScroll() {
  const nb = $('.navbar');
  if (nb) nb.classList.toggle('scrolled', window.scrollY > 4);
}
window.addEventListener('scroll', navbarScroll, { passive: true });

async function renderHome(seq) {
  const [people, entries, lastBackup] = await Promise.all([getAll('people'), getAll('entries'), getMeta('lastBackup', null)]);
  if (seq !== renderSeq) return;
  const byPerson = new Map(people.map((p) => [p.id, []]));
  for (const e of entries) if (byPerson.has(e.personId)) byPerson.get(e.personId).push(e);
  const total = balanceOf(entries.filter((e) => byPerson.has(e.personId)));
  const dc = state.defaultCurrency;

  const rows = people.map((p) => ({ p, bal: balanceOf(byPerson.get(p.id)), count: byPerson.get(p.id).length }));
  // Sort: people I owe most (default currency) first, then by name.
  rows.sort((a, b) => {
    const av = a.bal.get(dc) || 0, bv = b.bal.get(dc) || 0;
    const aOpen = a.bal.size > 0, bOpen = b.bal.size > 0;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (bv !== av) return bv - av;
    return a.p.name.localeCompare(b.p.name);
  });

  const tot = sortedBalances(total, dc);
  const main = tot.find(([c]) => c === dc) || tot[0];
  const heroLabel = !main ? 'All settled' : main[1] > 0 ? 'You owe in total' : 'Owed to you in total';
  const heroAmount = main ? fmtMoney(main[1], main[0]) : fmtMoney(0, dc);
  const others = tot.filter((t) => t !== main);

  const needsBackup = entries.length > 0 && (!lastBackup || Date.now() - lastBackup > 14 * 864e5);

  app.innerHTML = `
    <header class="navbar">
      <div class="nav-row">
        <span class="nav-spacer"></span>
        <span class="nav-title"></span>
        <button class="nav-btn" id="btn-settings" aria-label="Settings & backup">${ICON.gear}</button>
      </div>
      <h1 class="large-title">How Much I Owe</h1>
    </header>
    <main>
      <section class="hero" data-testid="total">
        <div class="hero-label">${heroLabel}</div>
        <div class="hero-amount" id="total-amount">${esc(heroAmount)}</div>
        <div class="hero-sub">
          ${others.map(([c, v]) => `<div>${v > 0 ? 'You owe' : 'Owed to you'} ${esc(fmtMoney(v, c))}</div>`).join('')}
          ${!tot.length ? `<div>${people.length ? 'You don’t owe anyone 🎉' : 'Add someone to get started'}</div>` : ''}
        </div>
      </section>
      ${needsBackup ? `<div class="banner"><span>💾 ${lastBackup ? 'Last backup ' + new Date(lastBackup).toLocaleDateString() : 'No backup yet'}. iOS can clear app data.</span><button id="btn-backup-now">Back up</button></div>` : ''}
      ${people.length ? `
        <div class="section-title"><span>People</span></div>
        <div class="list" id="people-list">
          ${rows.map(({ p, bal, count }) => {
            const bs = sortedBalances(bal, dc);
            const first = bs[0];
            return `<button class="row person-row" data-id="${esc(p.id)}">
              <span class="avatar" style="background:${avatarColor(p.name)}">${esc(initials(p.name))}</span>
              <span class="row-main">
                <div class="row-title">${esc(p.name)}</div>
                <div class="row-sub">${esc(p.note || (count ? `${count} entr${count === 1 ? 'y' : 'ies'}` : 'No entries yet'))}</div>
              </span>
              <span class="row-end ${first ? balanceClass(first[1]) : 'settled'}" data-testid="person-balance">
                ${first ? esc(fmtMoney(first[1], first[0])) : 'Settled'}
                ${bs.length > 1 ? bs.slice(1, 3).map(([c, v]) => `<small class="${balanceClass(v)}">${v < 0 ? 'owes you ' : ''}${esc(fmtMoney(v, c))}</small>`).join('') + (bs.length > 3 ? `<small>+${bs.length - 3} more</small>` : '') : first ? `<small>${first[1] > 0 ? 'you owe' : 'owes you'}</small>` : ''}
              </span>
              ${ICON.chev}
            </button>`;
          }).join('')}
        </div>` : `
        <div class="empty">
          <div class="big">🤝</div>
          <h2>No one here yet</h2>
          <p>Tap <b>+</b> to add a friend or family member you owe money to.</p>
        </div>`}
    </main>
    <button class="fab" id="btn-add-person" aria-label="Add person">${ICON.plus}</button>
  `;
  $('#btn-add-person').onclick = () => personSheet();
  $('#btn-settings').onclick = () => settingsSheet();
  const bn = $('#btn-backup-now'); if (bn) bn.onclick = () => settingsSheet();
  $$('.person-row').forEach((b) => (b.onclick = () => { location.hash = '#/p/' + encodeURIComponent(b.dataset.id); }));
  navbarScroll();
}

async function renderPerson(id, seq) {
  const [person, entries, images] = await Promise.all([getOne('people', id), getAll('entries', 'personId', id), getAll('images', 'personId', id)]);
  if (seq !== renderSeq) return;
  if (!person) { location.replace('#/'); return; }
  const dc = state.defaultCurrency;
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  images.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const bal = sortedBalances(balanceOf(entries), dc);
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const imgsByEntry = new Map();
  for (const im of images) if (im.entryId) { if (!imgsByEntry.has(im.entryId)) imgsByEntry.set(im.entryId, []); imgsByEntry.get(im.entryId).push(im); }
  const thumbUrl = new Map(images.map((im) => [im.id, blobUrl(im.thumb || im.data, im.type)]));

  // Running balance per currency (chronological), shown under each entry.
  const running = new Map();
  const chrono = [...entries].reverse();
  const runAfter = new Map();
  for (const e of chrono) {
    const v = (running.get(e.currency) || 0) + (e.type === 'repay' ? -e.amount : e.amount);
    running.set(e.currency, v);
    runAfter.set(e.id, v);
  }

  app.innerHTML = `
    <header class="navbar">
      <div class="nav-row">
        <button class="nav-btn" id="btn-back" aria-label="Back to people">${ICON.back}<span>People</span></button>
        <span class="nav-title">${esc(person.name)}</span>
        <button class="nav-btn" id="btn-edit-person">Edit</button>
      </div>
    </header>
    <main>
      <section class="hero person">
        <div class="avatar lg" style="background:${avatarColor(person.name)}">${esc(initials(person.name))}</div>
        <div class="hero-label">${!bal.length ? 'All settled' : bal[0][1] > 0 ? 'You owe ' + esc(person.name) : esc(person.name) + ' owes you'}</div>
        <div class="hero-amount ${bal.length ? balanceClass(bal[0][1]) : 'settled'}" id="person-balance">${bal.length ? esc(fmtMoney(bal[0][1], bal[0][0])) : esc(fmtMoney(0, dc))}</div>
        <div class="hero-sub muted">${bal.slice(1).map(([c, v]) => `<div class="${balanceClass(v)}">${v > 0 ? 'You owe' : 'Owes you'} ${esc(fmtMoney(v, c))}</div>`).join('')}</div>
        ${person.note ? `<div class="note">${esc(person.note)}</div>` : ''}
      </section>

      <div class="actions">
        <button class="btn borrow" id="btn-add-borrow">${ICON.plus} I borrowed</button>
        <button class="btn repay" id="btn-add-repay">${ICON.plus} I paid back</button>
      </div>

      <div class="section-title"><span>History</span><span>${entries.length || ''}</span></div>
      ${entries.length ? `<div class="list entries" id="entries-list">
        ${entries.map((e) => {
          const ims = imgsByEntry.get(e.id) || [];
          const rb = runAfter.get(e.id);
          return `<button class="row entry-row" data-id="${esc(e.id)}">
            <span class="entry-icon ${e.type}">${e.type === 'repay' ? '↑' : '↓'}</span>
            <span class="row-main">
              <div class="row-title">${esc(e.description || (e.type === 'repay' ? 'Paid back' : 'Borrowed'))}</div>
              <div class="row-sub">${esc(fmtDate(e.date))} · ${e.type === 'repay' ? 'I paid back' : 'I borrowed'}</div>
              ${ims.length ? `<div class="mini-thumbs">${ims.slice(0, 4).map((im) => `<img src="${thumbUrl.get(im.id)}" alt="">`).join('')}</div>` : ''}
            </span>
            <span class="row-end ${e.type === 'repay' ? 'owed' : 'owe'}">${esc(fmtMoney(e.type === 'repay' ? -e.amount : e.amount, e.currency, { sign: true }))}
              <small>bal. ${esc(fmtMoney(rb, e.currency))}</small></span>
          </button>`;
        }).join('')}
      </div>` : `<div class="list"><div class="empty-inline">No entries yet. Add what you borrowed or paid back.</div></div>`}

      <div class="section-title"><span>Photos &amp; receipts</span><button id="btn-add-photos">Add</button></div>
      <div class="gallery" id="gallery">
        ${images.map((im, i) => {
          const e = im.entryId ? entryById.get(im.entryId) : null;
          return `<button class="thumb" data-idx="${i}" aria-label="View photo">
            <img src="${thumbUrl.get(im.id)}" alt="" loading="lazy">
            ${e ? `<span class="badge">${esc(e.description || fmtDate(e.date))}</span>` : ''}
          </button>`;
        }).join('')}
        <button class="thumb add" id="btn-add-photos-2" aria-label="Add photos">${ICON.camera}</button>
      </div>
      <p class="muted center mt">Photos can come from the camera or your photo library.</p>
    </main>
  `;
  $('#btn-back').onclick = () => { if (sessionStorage.getItem('navFromHome') === '1') history.back(); else location.hash = '#/'; };
  $('#btn-edit-person').onclick = () => personSheet(person);
  $('#btn-add-borrow').onclick = () => entrySheet(person, null, 'borrow');
  $('#btn-add-repay').onclick = () => entrySheet(person, null, 'repay');
  const addGeneral = async () => {
    const files = await pickImages();
    if (!files.length) return;
    const processed = await processFiles(files);
    const now = Date.now();
    await writeOps(processed.map((p, i) => ({ store: 'images', put: { id: uid(), personId: person.id, entryId: null, createdAt: now + i, ...p } })));
    render();
  };
  $('#btn-add-photos').onclick = addGeneral;
  $('#btn-add-photos-2').onclick = addGeneral;
  $$('.entry-row').forEach((b) => (b.onclick = () => entrySheet(person, entryById.get(b.dataset.id))));
  $$('#gallery .thumb[data-idx]').forEach((b) => (b.onclick = () => openViewer(images, Number(b.dataset.idx), entryById)));
  navbarScroll();
}

/* =========================== Sheets =========================== */
let sheetEl = null;
function openSheet({ title, left = 'Cancel', right = null, body, onRight, onMount }) {
  closeSheet(true);
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head">
        <button class="nav-btn" data-act="left">${esc(left)}</button>
        <span class="nav-title">${esc(title)}</span>
        ${right ? `<button class="nav-btn bold" data-act="right">${esc(right)}</button>` : '<span class="nav-spacer"></span>'}
      </div>
      <div class="sheet-body">${body}</div>
    </div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  sheetEl = ov;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
  $('[data-act="left"]', ov).onclick = () => closeSheet();
  const rb = $('[data-act="right"]', ov);
  if (rb && onRight) rb.onclick = async () => {
    if (rb.disabled) return;
    rb.disabled = true;
    try { await onRight(ov); } catch (err) { console.error(err); toast(err.message || String(err), 3500); } finally { rb.disabled = false; }
  };
  if (onMount) onMount(ov);
  return ov;
}
function closeSheet(immediate) {
  if (!sheetEl) return;
  const el = sheetEl; sheetEl = null;
  document.body.style.overflow = '';
  if (el._cleanup) el._cleanup();
  el.remove();
}

function currencyOptions(selected) {
  const list = CURRENCIES.includes(selected) ? CURRENCIES : [selected, ...CURRENCIES];
  return list.map((c) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
}

function personSheet(person = null) {
  const editing = !!person;
  openSheet({
    title: editing ? 'Edit person' : 'New person',
    right: editing ? 'Save' : 'Add',
    body: `
      <div class="field-group">
        <div class="field"><label for="p-name">Name</label><input id="p-name" type="text" autocomplete="off" autocapitalize="words" placeholder="e.g. Ali" value="${esc(person?.name || '')}" maxlength="80" enterkeyhint="done"></div>
        <div class="field"><label for="p-note">Note</label><textarea id="p-note" placeholder="Optional (e.g. brother, Swish number…)" maxlength="500">${esc(person?.note || '')}</textarea></div>
      </div>
      ${editing ? `<button class="btn danger" style="width:100%" id="p-delete">${ICON.trash} Delete person</button>
      <p class="muted center">Deleting removes all entries and photos for this person.</p>` : ''}
    `,
    onMount: (ov) => {
      const input = $('#p-name', ov);
      setTimeout(() => { if (!editing) input.focus(); }, 50);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-act="right"]', ov).click(); } });
      const del = $('#p-delete', ov);
      if (del) del.onclick = async () => {
        if (!confirm(`Delete ${person.name} and all of their entries and photos? This cannot be undone.`)) return;
        await deletePerson(person.id);
        closeSheet();
        toast(`${person.name} deleted`);
        location.hash = '#/';
        render();
      };
    },
    onRight: async (ov) => {
      const name = $('#p-name', ov).value.trim();
      const note = $('#p-note', ov).value.trim();
      if (!name) { toast('Please enter a name'); $('#p-name', ov).focus(); return; }
      const now = Date.now();
      const rec = editing ? { ...person, name, note, updatedAt: now } : { id: uid(), name, note, createdAt: now, updatedAt: now };
      await writeOps([{ store: 'people', put: rec }]);
      closeSheet();
      if (!editing) { sessionStorage.setItem('navFromHome', '1'); location.hash = '#/p/' + encodeURIComponent(rec.id); }
      else render();
    }
  });
}

async function deletePerson(id) {
  const [entries, images] = await Promise.all([getAll('entries', 'personId', id), getAll('images', 'personId', id)]);
  await writeOps([
    { store: 'people', del: id },
    ...entries.map((e) => ({ store: 'entries', del: e.id })),
    ...images.map((i) => ({ store: 'images', del: i.id }))
  ]);
}

async function entrySheet(person, entry = null, defaultType = 'borrow') {
  const editing = !!entry;
  const existing = editing ? (await getAll('images', 'entryId', entry.id)).sort((a, b) => a.createdAt - b.createdAt) : [];
  const sheetUrls = [];
  let type = entry?.type || defaultType;
  const pending = [];          // newly processed images, not yet saved
  const removed = new Set();   // ids of existing images to delete on save
  const lastCur = await getMeta('lastCurrency:' + person.id, null);
  const currency = entry?.currency || lastCur || state.defaultCurrency;
  const amountStr = editing ? (entry.amount / 100).toLocaleString(undefined, { useGrouping: false, maximumFractionDigits: 2 }) : '';

  const ov = openSheet({
    title: editing ? 'Edit entry' : 'New entry',
    right: 'Save',
    body: `
      <div class="segmented" role="tablist">
        <button data-type="borrow" class="${type === 'borrow' ? 'on' : ''}" role="tab">I borrowed</button>
        <button data-type="repay" class="${type === 'repay' ? 'on' : ''}" role="tab">I paid back</button>
      </div>
      <div class="field-group">
        <div class="field amount-field">
          <input id="e-amount" type="text" inputmode="decimal" placeholder="0" autocomplete="off" value="${esc(amountStr)}" aria-label="Amount">
          <select id="e-currency" aria-label="Currency">${currencyOptions(currency)}</select>
        </div>
      </div>
      <div class="field-group">
        <div class="field"><label for="e-desc">Description</label><input id="e-desc" type="text" placeholder="What for?" maxlength="140" value="${esc(entry?.description || '')}" enterkeyhint="done"></div>
        <div class="field"><label for="e-date">Date</label><input id="e-date" type="date" value="${esc(entry?.date || todayISO())}"></div>
      </div>
      <div class="form-label">Photos for this entry</div>
      <div class="gallery" id="e-gallery"></div>
      ${editing ? `<button class="btn danger mt" style="width:100%" id="e-delete">${ICON.trash} Delete entry</button>` : ''}
    `,
    onMount: (ov) => {
      $$('.segmented button', ov).forEach((b) => (b.onclick = () => {
        type = b.dataset.type;
        $$('.segmented button', ov).forEach((x) => x.classList.toggle('on', x === b));
      }));
      if (!editing) setTimeout(() => $('#e-amount', ov).focus(), 50);
      const del = $('#e-delete', ov);
      if (del) del.onclick = async () => {
        const n = existing.length;
        if (!confirm(`Delete this entry${n ? ` and its ${n} photo${n > 1 ? 's' : ''}` : ''}?`)) return;
        await writeOps([{ store: 'entries', del: entry.id }, ...existing.map((im) => ({ store: 'images', del: im.id }))]);
        closeSheet();
        toast('Entry deleted');
        render();
      };
    },
    onRight: async (ov) => {
      const amount = parseAmount($('#e-amount', ov).value);
      if (!Number.isFinite(amount) || amount <= 0) { toast('Enter an amount greater than 0'); $('#e-amount', ov).focus(); return; }
      const cur = $('#e-currency', ov).value;
      const now = Date.now();
      const rec = {
        ...(entry || { id: uid(), personId: person.id, createdAt: now }),
        type, amount, currency: cur,
        description: $('#e-desc', ov).value.trim(),
        date: $('#e-date', ov).value || todayISO(),
        updatedAt: now
      };
      await writeOps([
        { store: 'entries', put: rec },
        ...pending.map((p, i) => ({ store: 'images', put: { id: uid(), personId: person.id, entryId: rec.id, createdAt: now + i, ...p.img } })),
        ...[...removed].map((id) => ({ store: 'images', del: id })),
        { store: 'meta', put: { key: 'lastCurrency:' + person.id, value: cur } }
      ]);
      closeSheet();
      toast(editing ? 'Entry updated' : 'Entry added');
      render();
    }
  });
  ov._cleanup = () => revokeAll(sheetUrls);

  const gal = $('#e-gallery', ov);
  const thumbs = existing.map((im) => ({ id: im.id, url: blobUrl(im.thumb || im.data, im.type, sheetUrls) }));
  function drawGallery() {
    const items = [
      ...thumbs.filter((t) => !removed.has(t.id)).map((t) => ({ key: 'x:' + t.id, url: t.url })),
      ...pending.map((p, i) => ({ key: 'p:' + i, url: p.url }))
    ];
    gal.innerHTML = items.map((it) => `<div class="thumb"><img src="${it.url}" alt=""><button class="remove" data-key="${esc(it.key)}" aria-label="Remove photo">✕</button></div>`).join('') +
      `<button class="thumb add" id="e-add-photo" aria-label="Add photos">${ICON.camera}</button>`;
    $$('.remove', gal).forEach((b) => (b.onclick = () => {
      const [k, v] = [b.dataset.key.slice(0, 1), b.dataset.key.slice(2)];
      if (k === 'x') removed.add(v); else pending.splice(Number(v), 1);
      drawGallery();
    }));
    $('#e-add-photo', gal).onclick = async () => {
      const files = await pickImages();
      if (!files.length) return;
      const processed = await processFiles(files);
      for (const img of processed) pending.push({ img, url: blobUrl(img.thumb, img.type, sheetUrls) });
      if (sheetEl === ov) drawGallery();
    };
  }
  drawGallery();
}

/* ---------- Full-screen image viewer ---------- */
function openViewer(images, index, entryById) {
  const urls = [];
  let i = index;
  const v = document.createElement('div');
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.innerHTML = `
    <div class="viewer-bar">
      <button class="nav-btn" data-act="close" aria-label="Close">${ICON.close}</button>
      <span class="viewer-count"></span>
      <button class="nav-btn del" data-act="delete" aria-label="Delete photo">${ICON.trash}</button>
    </div>
    <div class="viewer-stage"><img alt="Photo"></div>
    <div class="viewer-caption"></div>`;
  document.body.appendChild(v);
  document.body.style.overflow = 'hidden';
  const img = $('img', v);
  function show() {
    const im = images[i];
    revokeAll(urls);
    img.src = blobUrl(im.data, im.type, urls);
    $('.viewer-count', v).textContent = images.length > 1 ? `${i + 1} of ${images.length}` : '';
    const e = im.entryId ? entryById.get(im.entryId) : null;
    $('.viewer-caption', v).textContent = e
      ? `${e.description || (e.type === 'repay' ? 'Paid back' : 'Borrowed')} · ${fmtDate(e.date)} · ${fmtMoney(e.amount, e.currency)}`
      : `General photo · added ${new Date(im.createdAt).toLocaleDateString()}`;
  }
  function close() { revokeAll(urls); v.remove(); document.body.style.overflow = sheetEl ? 'hidden' : ''; document.removeEventListener('keydown', onKey); }
  const step = (d) => { if (images.length > 1) { i = (i + d + images.length) % images.length; show(); } };
  function onKey(e) { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); }
  document.addEventListener('keydown', onKey);
  $('[data-act="close"]', v).onclick = close;
  $('[data-act="delete"]', v).onclick = async () => {
    if (!confirm('Delete this photo?')) return;
    await writeOps([{ store: 'images', del: images[i].id }]);
    images.splice(i, 1);
    toast('Photo deleted');
    if (!images.length) { close(); render(); return; }
    i = Math.min(i, images.length - 1);
    show();
    render();
  };
  // Swipe left/right to navigate, swipe down to close.
  let sx = 0, sy = 0, multi = false;
  v.addEventListener('touchstart', (e) => { multi = e.touches.length > 1; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  v.addEventListener('touchend', (e) => {
    if (multi) return;
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
  const [people, entries, images, meta] = await Promise.all([getAll('people'), getAll('entries'), getAll('images'), getAll('meta')]);
  const data = {
    app: 'how-much-i-owe',
    format: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: Object.fromEntries(meta.filter((m) => m.key !== 'lastBackup').map((m) => [m.key, m.value])),
    people, entries,
    images: images.map(({ data, thumb, ...rest }) => ({
      ...rest,
      data: `data:${rest.type || 'image/jpeg'};base64,${bufToB64(data)}`,
      thumb: thumb ? `data:image/jpeg;base64,${bufToB64(thumb)}` : undefined
    }))
  };
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
  const images = (data.images || []).filter((im) => im && im.id && pids.has(im.personId) && im.data).map((im) => {
    const full = dataUrlToBuf(im.data);
    return { ...im, data: full, thumb: im.thumb ? dataUrlToBuf(im.thumb) : full, type: im.type || 'image/jpeg' };
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
  return { people: people.length, entries: entries.length, images: images.length };
}

function fmtBytes(n) {
  if (!n && n !== 0) return '?';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

async function settingsSheet() {
  const [lastBackup, persisted, est] = await Promise.all([
    getMeta('lastBackup', null),
    navigator.storage && navigator.storage.persisted ? navigator.storage.persisted().catch(() => false) : false,
    navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(() => null) : null
  ]);
  let prepared = null;
  openSheet({
    title: 'Settings & backup',
    left: 'Done',
    body: `
      <div class="field-group">
        <div class="field"><label for="s-cur" class="wide">Default currency</label><select id="s-cur">${currencyOptions(state.defaultCurrency)}</select></div>
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
        <div class="field settings-row"><span>Storage used</span><span class="val">${est ? esc(fmtBytes(est.usage)) : 'unknown'}</span></div>
        <div class="field settings-row"><span>Persistent storage</span><span class="val">${persisted ? 'Granted' : 'Not granted'}</span></div>
        <div class="field settings-row"><span>Version</span><span class="val">${APP_VERSION}</span></div>
      </div>
      <p class="muted center">All data stays on this device. Nothing is uploaded.</p>
    `,
    onMount: (ov) => {
      $('#s-cur', ov).onchange = async (e) => {
        state.defaultCurrency = e.target.value;
        await setMeta('defaultCurrency', state.defaultCurrency);
        toast(`Default currency: ${state.defaultCurrency}`);
        render();
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
        await setMeta('lastBackup', Date.now());
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
          $('#s-counts', ov).textContent = `Backup contains ${c.people} people, ${c.entries} entries and ${c.images} photos.`;
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
          if (!confirm('Importing replaces ALL current people, entries and photos with the backup. Continue?')) return;
          try {
            toast('Importing…', 10000);
            const c = await importData(await f.text());
            closeSheet();
            toast(`Imported ${c.people} people, ${c.entries} entries, ${c.images} photos`, 3000);
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
window.oweApp = { parseAmount, balanceOf, buildExport, importData, version: APP_VERSION };

window.addEventListener('hashchange', () => { closeSheet(); if (route().name === 'home') sessionStorage.removeItem('navFromHome'); render(); window.scrollTo(0, 0); });
document.addEventListener('click', (e) => {
  const row = e.target.closest && e.target.closest('.person-row');
  if (row) sessionStorage.setItem('navFromHome', '1');
}, true);

async function boot() {
  try {
    state.defaultCurrency = await getMeta('defaultCurrency', 'SEK');
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
}
boot();
})();
