/** Settings sheet + backup export/import orchestration. */
import { PHOTO_MODES, isImageAtt, fmtBytes } from '../domain/attachments.js';
import {
  encodeAttachmentForExport,
  buildExportPayload,
  serializeBackup,
  parseBackupText,
  normalizeImport,
} from '../domain/backup.js';
import { openDB, txDone } from '../storage/indexeddb.js';
import { $, esc, ICON, toast } from './dom.js';
import { openSheet, closeSheet, currencyOptions } from './sheets.js';

/**
 * @param {object[]} all attachment records from the store
 * @returns {{ count: number, bytes: number, photos: number, files: number, saved: number }}
 */
export function attachmentStatsFromList(all) {
  let bytes = 0, photos = 0, files = 0, origBytes = 0, photoBytes = 0;
  for (const a of all) {
    const size = a.data instanceof Blob ? a.data.size : (a.data ? a.data.byteLength : 0);
    const thumb = a.thumb ? a.thumb.byteLength : 0;
    bytes += size + thumb;
    if (isImageAtt(a)) { photos++; photoBytes += size; origBytes += a.origSize || size; } else files++;
  }
  return { count: all.length, bytes, photos, files, saved: Math.max(0, origBytes - photoBytes) };
}

/**
 * @param {{ list: () => Promise<object[]> }} attachmentRepo
 */
export async function attachmentStats(attachmentRepo) {
  return attachmentStatsFromList(await attachmentRepo.list());
}

/**
 * Build a format-2 backup JSON from repos.
 * @param {{
 *   peopleRepo: { list: Function },
 *   entryRepo: { list: Function },
 *   attachmentRepo: { list: Function },
 *   metaRepo: { list: Function },
 *   appVersion: string,
 * }} deps
 */
export async function buildExport({ peopleRepo, entryRepo, attachmentRepo, metaRepo, appVersion }) {
  const [people, entries, images, meta] = await Promise.all([
    peopleRepo.list(), entryRepo.list(), attachmentRepo.list(), metaRepo.list(),
  ]);
  const encodedImages = [];
  for (const { data: bytes, thumb, ...rest } of images) {
    const buf = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes;
    const thumbBuf = thumb
      ? (thumb instanceof Blob ? await thumb.arrayBuffer() : thumb)
      : null;
    encodedImages.push(encodeAttachmentForExport(rest, buf, thumbBuf));
  }
  const now = new Date();
  const payload = buildExportPayload({
    people,
    entries,
    encodedImages,
    meta,
    appVersion,
    exportedAt: now.toISOString(),
  });
  return serializeBackup(payload, now);
}

/**
 * Replace all people/entries/images and merge settings from a backup JSON string.
 * @param {string} text
 * @param {{ state: { defaultCurrency: string, photoQuality: string } }} opts
 * @returns {Promise<{ people: number, entries: number, images: number }>}
 */
export async function importData(text, { state } = {}) {
  const data = parseBackupText(text);
  const { people, entries, images, settings } = normalizeImport(data);
  const db = await openDB();
  const t = db.transaction(['people', 'entries', 'images', 'meta'], 'readwrite');
  ['people', 'entries', 'images'].forEach((s) => t.objectStore(s).clear());
  const ms = t.objectStore('meta');
  people.forEach((p) => t.objectStore('people').put(p));
  entries.forEach((e) => t.objectStore('entries').put(e));
  images.forEach((im) => t.objectStore('images').put(im));
  for (const [key, value] of Object.entries(settings || {})) ms.put({ key, value });
  ms.put({ key: 'lastBackup', value: Date.now() }); // the imported file *is* a backup
  await txDone(t);
  if (state) {
    if (settings && settings.defaultCurrency) state.defaultCurrency = settings.defaultCurrency;
    if (settings && PHOTO_MODES[settings.photoQuality]) state.photoQuality = settings.photoQuality;
  }
  return { people: people.length, entries: entries.length, images: images.length };
}

/**
 * Open the Settings & backup sheet.
 * @param {{
 *   peopleRepo: object,
 *   entryRepo: object,
 *   attachmentRepo: object,
 *   metaRepo: object,
 *   state: { defaultCurrency: string, photoQuality: string },
 *   currencies: string[],
 *   appVersion: string,
 *   render: Function,
 * }} deps
 */
export async function settingsSheet(deps) {
  const {
    peopleRepo, entryRepo, attachmentRepo, metaRepo,
    state, currencies, appVersion, render,
  } = deps;

  const [lastBackup, persisted, est, st] = await Promise.all([
    metaRepo.get('lastBackup', null),
    navigator.storage && navigator.storage.persisted ? navigator.storage.persisted().catch(() => false) : false,
    navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(() => null) : null,
    attachmentStats(attachmentRepo),
  ]);
  let prepared = null;
  const modeOptions = Object.entries(PHOTO_MODES).map(([k, m]) => `<option value="${k}" ${k === state.photoQuality ? 'selected' : ''}>${esc(m.label)}${k === 'high' ? ' (default)' : ''}</option>`).join('');
  openSheet({
    title: 'Settings & backup',
    left: 'Done',
    body: `
      <div class="field-group">
        <div class="field"><label for="s-cur" class="wide">Default currency</label><select id="s-cur">${currencyOptions(state.defaultCurrency, currencies)}</select></div>
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
        <div class="field settings-row"><span>Version</span><span class="val">${appVersion}</span></div>
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
          prepared = await buildExport({ peopleRepo, entryRepo, attachmentRepo, metaRepo, appVersion });
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
            const c = await importData(await f.text(), { state });
            closeSheet();
            toast(`Imported ${c.people} people, ${c.entries} transactions, ${c.images} attachments`, 3000);
            location.hash = '#/';
            render();
          } catch (err) { console.error(err); toast(err.message, 4000); }
        };
        document.body.appendChild(input);
        input.click();
      };
    },
  });
}
