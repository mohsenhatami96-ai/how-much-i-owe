/** Entry detail screen. */
import { entryTitle, sortEntries } from '../domain/entries.js';
import { runningBalances } from '../domain/balances.js';
import { fmtMoney } from '../domain/money.js';
import { $, $$, esc, ICON, fmtDate, navbarScroll } from './dom.js';
import {
  attachButtonsHtml,
  wireAttachButtons,
  processAttachments,
  tileHtml,
  thumbFor,
} from './images.js';

/**
 * @param {object} deps
 * @param {string} pid
 * @param {string} eid
 * @param {number} seq
 */
export async function renderEntry(deps, pid, eid, seq) {
  const {
    peopleRepo, entryRepo, attachmentRepo, state, app, renderSeq,
    viewUrls, personHash, goBack, entrySheet, deleteEntry, saveAttachments, openViewer,
  } = deps;
  const [person, entry, atts, entries] = await Promise.all([
    peopleRepo.get(pid), entryRepo.get(eid), attachmentRepo.listByEntry(eid), entryRepo.listByPerson(pid),
  ]);
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
  wireAttachButtons(app, async (files) => saveAttachments(await processAttachments(files, state), pid, eid));
  $$('#entry-atts .thumb[data-idx]').forEach((b) => (b.onclick = () => openViewer(atts, Number(b.dataset.idx), new Map([[entry.id, entry]]))));
  $('#btn-delete-entry').onclick = async () => {
    if (!(await deleteEntry(entry, atts))) return;
    goBack(personHash(pid));
    deps.render();
  };
  navbarScroll();
}
