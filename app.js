/* How Much I Owe – a local-first PWA for tracking money you owe.
 * Data lives in IndexedDB on the device. No backend, no build step. */
import { parseAmount, fmtMoney } from './domain/money.js';
import { balanceOf } from './domain/balances.js';
import { PHOTO_MODES } from './domain/attachments.js';
import {
  writeOps,
  createRepos,
  setBlockedHandler,
} from './storage/indexeddb.js';
import { $, esc, toast, ICON, navbarScroll } from './ui/dom.js';
import { renderHome as renderHomeView } from './ui/home.js';
import { renderPerson as renderPersonView } from './ui/person.js';
import {
  closeSheet,
  getSheetEl,
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
import {
  settingsSheet as settingsSheetView,
  buildExport as buildExportView,
  importData as importDataView,
} from './ui/settings.js';

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
function settingsDeps() {
  return {
    peopleRepo, entryRepo, attachmentRepo, metaRepo,
    state, currencies: CURRENCIES, appVersion: APP_VERSION, render,
  };
}
function settingsSheet() {
  return settingsSheetView(settingsDeps());
}
async function buildExport() {
  return buildExportView({
    peopleRepo, entryRepo, attachmentRepo, metaRepo, appVersion: APP_VERSION,
  });
}
async function importData(text) {
  return importDataView(text, { state });
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
