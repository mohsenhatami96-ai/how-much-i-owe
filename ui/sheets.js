/** Bottom sheets: shell + person/entry forms. */
import { createPerson, updatePerson } from '../domain/people.js';
import { createEntry, updateEntry } from '../domain/entries.js';
import { parseAmount } from '../domain/money.js';
import { $, $$, esc, ICON, toast } from './dom.js';

let sheetEl = null;
export const getSheetEl = () => sheetEl;

export function openSheet({ title, left = 'Cancel', right = null, body, onRight, onMount }) {
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
export function closeSheet(immediate) {
  if (!sheetEl) return;
  const el = sheetEl; sheetEl = null;
  document.body.style.overflow = '';
  if (el._cleanup) el._cleanup();
  el.remove();
}

export function currencyOptions(selected, currencies) {
  const list = currencies.includes(selected) ? currencies : [selected, ...currencies];
  return list.map((c) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
}

/**
 * @param {object} deps
 * @param {object|null} person
 */
export function personSheet(deps, person = null) {
  const {
    peopleRepo, deletePerson, personHash, render, uid,
  } = deps;
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
      let rec;
      try {
        const now = Date.now();
        rec = editing
          ? updatePerson(person, { name, note }, now)
          : createPerson({ id: uid(), name, note, now });
      } catch (err) {
        toast(err.message || 'Please enter a name');
        $('#p-name', ov).focus();
        return;
      }
      await peopleRepo.put(rec);
      closeSheet();
      if (!editing) location.hash = personHash(rec.id);
      else render();
    }
  });
}

/**
 * Entry sheet. Attachment gallery deps injected (Task 6 will own those).
 * @param {object} deps
 * @param {object} person
 * @param {object|null} entry
 * @param {string} defaultType
 */
export async function entrySheet(deps, person, entry = null, defaultType = 'borrow') {
  const {
    attachmentRepo, metaRepo, state, currencies, writeOps, uid, todayISO,
    attachButtonsHtml, wireAttachButtons, processAttachments, tileHtml, thumbFor,
    deleteEntry, route, goBack, personHash, render, revokeAll,
  } = deps;
  const editing = !!entry;
  const existing = editing ? (await attachmentRepo.listByEntry(entry.id)).sort((a, b) => a.createdAt - b.createdAt) : [];
  const sheetUrls = [];
  let type = entry?.type || defaultType;
  const pending = [];          // newly added attachments, saved together with the transaction
  const removed = new Set();   // ids of existing attachments to delete on save
  const lastCur = await metaRepo.get('lastCurrency:' + person.id, null);
  const currency = entry?.currency || lastCur || state.defaultCurrency;
  const amountStr = editing ? (entry.amount / 100).toLocaleString(undefined, { useGrouping: false, maximumFractionDigits: 2 }) : '';

  const ov = openSheet({
    title: editing ? 'Edit transaction' : 'New transaction',
    right: 'Save',
    body: `
      <div class="segmented" role="tablist">
        <button data-type="borrow" class="${type === 'borrow' ? 'on' : ''}" role="tab">I borrowed</button>
        <button data-type="repay" class="${type === 'repay' ? 'on' : ''}" role="tab">I paid back</button>
      </div>
      <div class="field-group">
        <div class="field amount-field">
          <input id="e-amount" type="text" inputmode="decimal" placeholder="0" autocomplete="off" value="${esc(amountStr)}" aria-label="Amount">
          <select id="e-currency" aria-label="Currency">${currencyOptions(currency, currencies)}</select>
        </div>
      </div>
      <div class="field-group">
        <div class="field"><label for="e-desc">Description</label><input id="e-desc" type="text" placeholder="What for?" maxlength="140" value="${esc(entry?.description || '')}" enterkeyhint="done"></div>
        <div class="field"><label for="e-date">Date</label><input id="e-date" type="date" value="${esc(entry?.date || todayISO())}"></div>
      </div>
      <div class="form-label">Attach documents</div>
      <div class="attach-box" id="e-attach">
        <div class="gallery" id="e-gallery"></div>
        ${attachButtonsHtml('e')}
        <p class="muted center" style="margin:10px 0 0">Receipts, screenshots, PDFs, Word/Excel files… saved with this transaction.</p>
      </div>
      ${editing ? `<button class="btn danger mt" style="width:100%" id="e-delete">${ICON.trash} Delete transaction</button>` : ''}
    `,
    onMount: (ov) => {
      $$('.segmented button', ov).forEach((b) => (b.onclick = () => {
        type = b.dataset.type;
        $$('.segmented button', ov).forEach((x) => x.classList.toggle('on', x === b));
      }));
      if (!editing) setTimeout(() => $('#e-amount', ov).focus(), 50);
      const del = $('#e-delete', ov);
      if (del) del.onclick = async () => {
        if (!(await deleteEntry(entry, existing))) return;
        closeSheet();
        if (route().name === 'entry') goBack(personHash(person.id));
        render();
      };
    },
    onRight: async (ov) => {
      const amount = parseAmount($('#e-amount', ov).value);
      const cur = $('#e-currency', ov).value;
      const now = Date.now();
      let rec;
      try {
        const fields = {
          amount, type, currency: cur,
          description: $('#e-desc', ov).value.trim(),
          date: $('#e-date', ov).value,
          fallbackDate: todayISO(),
        };
        rec = editing
          ? updateEntry(entry, fields, now)
          : createEntry({ id: uid(), personId: person.id, now, ...fields });
      } catch (err) {
        toast(err.message || 'Enter an amount greater than 0');
        $('#e-amount', ov).focus();
        return;
      }
      await writeOps([
        { store: 'entries', put: rec },
        ...pending.map((p, i) => ({ store: 'images', put: { id: uid(), personId: person.id, entryId: rec.id, createdAt: now + i, ...p.rec } })),
        ...[...removed].map((id) => ({ store: 'images', del: id })),
        { store: 'meta', put: { key: 'lastCurrency:' + person.id, value: cur } }
      ]);
      closeSheet();
      const n = pending.length;
      toast(editing ? 'Transaction updated' : `Transaction added${n ? ` with ${n} attachment${n > 1 ? 's' : ''}` : ''}`);
      render();
    }
  });
  ov._cleanup = () => revokeAll(sheetUrls);

  const gal = $('#e-gallery', ov);
  const shown = existing.map((a) => ({ a, url: thumbFor(a, sheetUrls) }));
  function drawGallery() {
    const items = [
      ...shown.filter((t) => !removed.has(t.a.id)).map((t) => ({ key: 'x:' + t.a.id, a: t.a, url: t.url })),
      ...pending.map((p, i) => ({ key: 'p:' + i, a: p.rec, url: p.url }))
    ];
    gal.innerHTML = items.map((it) => tileHtml(it.a, it.url, { remove: it.key })).join('');
    gal.classList.toggle('hidden', !items.length);
    $$('.remove', gal).forEach((b) => (b.onclick = () => {
      const k = b.dataset.key.slice(0, 1), v = b.dataset.key.slice(2);
      if (k === 'x') removed.add(v); else pending.splice(Number(v), 1);
      drawGallery();
    }));
  }
  wireAttachButtons($('#e-attach', ov), async (files) => {
    const recs = await processAttachments(files);
    for (const rec of recs) pending.push({ rec, url: thumbFor(rec, sheetUrls) });
    if (sheetEl === ov) drawGallery();
  });
  drawGallery();
}
