import { avatarColor, initials } from '../domain/people.js';
import { entryTitle, sortEntries } from '../domain/entries.js';
import { balanceOf, sortedBalances, runningBalances, balanceClass } from '../domain/balances.js';
import { fmtMoney } from '../domain/money.js';
import { $, $$, esc, ICON, fmtDate, navbarScroll } from './dom.js';
import { tileHtml, thumbFor, pickFiles, processAttachments } from './images.js';

/**
 * Person screen.
 * @param {object} deps
 * @param {string} id
 * @param {number} seq
 */
export async function renderPerson(deps, id, seq) {
  const {
    peopleRepo, entryRepo, attachmentRepo, state, app, renderSeq,
    personSheet, entrySheet, goBack, entryHash,
    viewUrls, saveAttachments, openViewer,
  } = deps;
  const [person, entries, atts] = await Promise.all([peopleRepo.get(id), entryRepo.listByPerson(id), attachmentRepo.listByPerson(id)]);
  if (seq !== renderSeq) return;
  if (!person) { location.replace('#/'); return; }
  const dc = state.defaultCurrency;
  sortEntries(entries);
  atts.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const bal = sortedBalances(balanceOf(entries), dc);
  const entryIds = new Set(entries.map((e) => e.id));
  const countByEntry = new Map();
  for (const a of atts) if (a.entryId && entryIds.has(a.entryId)) countByEntry.set(a.entryId, (countByEntry.get(a.entryId) || 0) + 1);
  const general = atts.filter((a) => !a.entryId || !entryIds.has(a.entryId));
  const runAfter = runningBalances(entries);

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
          const n = countByEntry.get(e.id) || 0;
          return `<button class="row entry-row" data-id="${esc(e.id)}">
            <span class="entry-icon ${e.type}">${e.type === 'repay' ? '↑' : '↓'}</span>
            <span class="row-main">
              <div class="row-title">${esc(entryTitle(e))}</div>
              <div class="row-sub">${esc(fmtDate(e.date))} · ${e.type === 'repay' ? 'I paid back' : 'I borrowed'}${n ? ` <span class="clip-badge" data-testid="att-count" aria-label="${n} attachment${n > 1 ? 's' : ''}">${ICON.clip}${n}</span>` : ''}</div>
            </span>
            <span class="row-end ${e.type === 'repay' ? 'owed' : 'owe'}">${esc(fmtMoney(e.type === 'repay' ? -e.amount : e.amount, e.currency, { sign: true }))}
              <small>bal. ${esc(fmtMoney(runAfter.get(e.id), e.currency))}</small></span>
            ${ICON.chev}
          </button>`;
        }).join('')}
      </div>
      <p class="muted center" style="margin:8px 16px 0">Tap a transaction to see or attach its receipts &amp; documents.</p>` : `<div class="list"><div class="empty-inline">No transactions yet. Add what you borrowed or paid back — you can attach receipts and documents to each one.</div></div>`}

      <div class="section-title"><span>Other documents</span><button id="btn-add-photos">Add</button></div>
      <p class="muted" style="margin:-2px 16px 8px">For things not tied to one transaction (e.g. an agreement).</p>
      <div class="gallery" id="gallery">
        ${general.map((a, i) => tileHtml(a, thumbFor(a, viewUrls), { idx: i })).join('')}
        <button class="thumb add" id="btn-add-photos-2" aria-label="Add other documents">${ICON.plus}</button>
      </div>
    </main>
  `;
  $('#btn-back').onclick = () => goBack('#/');
  $('#btn-edit-person').onclick = () => personSheet(person);
  $('#btn-add-borrow').onclick = () => entrySheet(person, null, 'borrow');
  $('#btn-add-repay').onclick = () => entrySheet(person, null, 'repay');
  const addGeneral = async () => {
    const files = await pickFiles('docs');
    if (files.length) await saveAttachments(await processAttachments(files, state), person.id, null);
  };
  $('#btn-add-photos').onclick = addGeneral;
  $('#btn-add-photos-2').onclick = addGeneral;
  $$('.entry-row').forEach((b) => (b.onclick = () => { location.hash = entryHash(person.id, b.dataset.id); }));
  $$('#gallery .thumb[data-idx]').forEach((b) => (b.onclick = () => openViewer(general, Number(b.dataset.idx), new Map(entries.map((e) => [e.id, e])))));
  navbarScroll();
}
