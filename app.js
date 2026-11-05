/* How Much I Owe – a local-first PWA for tracking money you owe.
 * Data lives in IndexedDB on the device. No backend, no build step. */
import { parseAmount, fmtMoney } from './domain/money.js';
import { balanceOf } from './domain/balances.js';
import {
  PHOTO_MODES,
  isImageAtt,
  attName,
  fmtBytes,
} from './domain/attachments.js';
import {
  openDB,
  writeOps,
  txDone,
  createRepos,
  setBlockedHandler,
} from './storage/indexeddb.js';
import { $, esc, toast, ICON, navbarScroll } from './ui/dom.js';
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
import {
  processImage,
  canEncodeWebP,
  revokeAll,
} from './ui/images.js';
import { renderEntry as renderEntryView } from './ui/entry.js';
import { openViewer as openViewerView } from './ui/viewer.js';

(() => {
'use strict';

const APP_VERSION = '1.2.0';
const CURRENCIES = ['SEK', 'EUR', 'USD', 'GBP', 'NOK', 'DKK', 'IRR', 'TRY', 'CHF', 'AED', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'PLN'];

/* =========================== IndexedDB (via storage/indexeddb.js) =========================== */
const repos = createRepos();
const { people: peopleRepo, entries: entryRepo, attachments: attachmentRepo, meta: metaRepo } = repos;

/* =========================== Utilities =========================== */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

setBlockedHandler((msg) => toast(msg));



/* =========================== Domain =========================== */

/* ---------- Object URL bucket (owned by composition root) ---------- */
let viewUrls = [];

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
    viewUrls, saveAttachments, openViewer,
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
    deleteEntry, route, goBack, personHash, render,
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

function entryDeps() {
  return {
    peopleRepo, entryRepo, attachmentRepo, state, app, renderSeq,
    viewUrls, personHash, goBack, entrySheet, deleteEntry, saveAttachments, openViewer, render,
  };
}
async function renderEntry(pid, eid, seq) {
  return renderEntryView(entryDeps(), pid, eid, seq);
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


/* ---------- Full-screen viewer ---------- */
function openViewer(items, index, entryById) {
  return openViewerView({ attachmentRepo, render }, items, index, entryById);
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
window.oweApp = {
  parseAmount, balanceOf, buildExport, importData,
  processImage: (file, mode, opts) => processImage(file, mode ?? state.photoQuality, opts),
  canEncodeWebP, PHOTO_MODES, version: APP_VERSION
};

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
