/** Full-screen viewer for images and documents. */
import { entryTitle } from '../domain/entries.js';
import { fmtMoney } from '../domain/money.js';
import { isImageAtt, attName, fmtBytes, fileBadge } from '../domain/attachments.js';
import { $, esc, ICON, fmtDate, toast } from './dom.js';
import { getSheetEl } from './sheets.js';
import { blobUrl, revokeAll, shareOrDownload } from './images.js';

/**
 * @param {object} deps
 * @param {object[]} items
 * @param {number} index
 * @param {Map} entryById
 */
export function openViewer(deps, items, index, entryById) {
  const { attachmentRepo, render } = deps;
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
      im.onclick = (ev) => {
        const r = im.getBoundingClientRect();
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
