import { avatarColor, initials } from '../domain/people.js';
import { balanceOf, sortedBalances, balanceClass } from '../domain/balances.js';
import { fmtMoney } from '../domain/money.js';
import { $, $$, esc, ICON, navbarScroll } from './dom.js';

/**
 * @param {object} deps
 * @param {number} seq
 */
export async function renderHome(deps, seq) {
  const {
    peopleRepo, entryRepo, metaRepo, state, app, renderSeq,
    personHash, personSheet, settingsSheet,
  } = deps;
  const [people, entries, lastBackup] = await Promise.all([peopleRepo.list(), entryRepo.list(), metaRepo.get('lastBackup', null)]);
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
  $$('.person-row').forEach((b) => (b.onclick = () => { location.hash = personHash(b.dataset.id); }));
  navbarScroll();
}
