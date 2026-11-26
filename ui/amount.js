/** Amount field: live preview and the operator row above the keyboard. */

import {
  applyAmountKey,
  evaluateAmount,
  formatAmountInput,
  formatAmountPreview,
} from '../domain/expr.js';
import { caretScrollLeft, operatorBarTop } from './amount-layout.js';

const PLACEHOLDER = '= …';

const BACKSPACE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8.6 5.1h10.1A2.2 2.2 0 0 1 20.9 7.3v9.4a2.2 2.2 0 0 1-2.2 2.2H8.6L2.3 12l6.3-6.9z"/><path fill="none" stroke="var(--card)" stroke-width="1.8" stroke-linecap="round" d="M11.1 9.2l4.5 4.5M15.6 9.2l-4.5 4.5"/></svg>';

const KEYS = [
  { key: '+', label: '+', name: 'Add' },
  { key: '-', label: '\u2212', name: 'Subtract' },
  { key: '*', label: '\u00d7', name: 'Multiply' },
  { key: '/', label: '\u00f7', name: 'Divide' },
  { key: 'paren', label: '( )', name: 'Parentheses' },
  { key: 'back', label: BACKSPACE_SVG, name: 'Backspace' },
];

let bar = null;
let activeInput = null;
let placeTimer = 0;

function buzz() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(10);
  } catch {
    /* Vibration API missing or blocked. */
  }
}

function placeBar() {
  if (!bar || bar.classList.contains('hidden')) return;
  const vv = window.visualViewport;
  const offsetTop = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : document.documentElement.clientHeight;
  const barHeight = bar.getBoundingClientRect().height || bar.offsetHeight;
  if (!barHeight) return;
  const top = operatorBarTop({ offsetTop, height, barHeight });
  bar.style.top = `${top}px`;
  bar.style.bottom = 'auto';
  if (activeInput && activeInput.isConnected) revealAmountField(activeInput);
}

function schedulePlace() {
  placeBar();
  requestAnimationFrame(placeBar);
  clearTimeout(placeTimer);
  placeTimer = setTimeout(placeBar, 300);
}

/** Re-measure after a viewport change. Used by the page and by tests. */
export function relayoutAmountOps() {
  schedulePlace();
}

/**
 * Keep the amount field inside the visible area, just above the strip.
 * Best-effort: the readout on the strip is what stays readable if iOS scrolls anyway.
 * @param {HTMLInputElement} input
 */
function revealAmountField(input) {
  const scroller = input.closest('.sheet-body');
  if (!scroller || !bar) return;
  const barTop = bar.getBoundingClientRect().top;
  const rect = input.getBoundingClientRect();
  const preview = input.parentElement?.querySelector('.amount-preview');
  const bottom = preview ? preview.getBoundingClientRect().bottom : rect.bottom;
  if (bottom > barTop - 8) scroller.scrollTop += bottom - (barTop - 8);
  else if (rect.top < 8) scroller.scrollTop -= 8 - rect.top;
}

function syncReadout(input) {
  if (!bar || !input) return;
  const expr = bar.querySelector('.amount-ops-expr');
  const result = bar.querySelector('.amount-ops-result');
  const preview = input.parentElement?.querySelector('.amount-preview');
  if (!expr || !result) return;
  const value = input.value;
  const cursor = input.selectionStart ?? value.length;
  expr.replaceChildren();
  const before = document.createElement('span');
  before.textContent = value.slice(0, cursor);
  const caret = document.createElement('span');
  caret.className = 'amount-ops-caret';
  const after = document.createElement('span');
  after.textContent = value.slice(cursor);
  expr.append(before, caret, after);
  result.textContent = preview ? preview.textContent : PLACEHOLDER;
  result.classList.toggle('is-stale', preview?.classList.contains('is-stale') ?? true);
  result.classList.toggle('is-error', preview?.classList.contains('is-error') ?? false);
  const caretRight = caret.offsetLeft + caret.offsetWidth;
  expr.scrollLeft = caretScrollLeft({
    caretRight,
    clientWidth: expr.clientWidth,
    scrollWidth: expr.scrollWidth,
  });
}

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'amount-ops hidden';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Amount operators');
  const keys = KEYS.map((k) =>
    `<button type="button" data-key="${k.key}" aria-label="${k.name}" tabindex="-1">${k.label}</button>`
  ).join('');
  bar.innerHTML = `
    <div class="amount-ops-readout" aria-hidden="true">
      <div class="amount-ops-expr"></div>
      <div class="amount-ops-result is-stale">${PLACEHOLDER}</div>
    </div>
    <div class="amount-ops-keys">${keys}</div>`;
  document.body.appendChild(bar);
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const btn = e.target.closest('button');
    if (!btn || !activeInput) return;
    buzz();
    const start = activeInput.selectionStart;
    const end = activeInput.selectionEnd;
    const next = applyAmountKey(
      activeInput.value,
      start ?? activeInput.value.length,
      end ?? activeInput.value.length,
      btn.dataset.key
    );
    activeInput.value = next.value;
    activeInput.setSelectionRange(next.cursor, next.cursor);
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    activeInput.focus();
  });
  const onViewport = () => schedulePlace();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewport);
    window.visualViewport.addEventListener('scroll', onViewport);
  }
  window.addEventListener('resize', onViewport);
  document.addEventListener('selectionchange', () => {
    if (activeInput && document.activeElement === activeInput) syncReadout(activeInput);
  });
  return bar;
}

export function hideAmountOps() {
  activeInput = null;
  document.body.classList.remove('amount-ops-on');
  clearTimeout(placeTimer);
  if (bar) bar.classList.add('hidden');
}

/**
 * @param {HTMLInputElement} input
 */
export function showAmountOps(input) {
  if (!input.isConnected) return;
  activeInput = input;
  const el = ensureBar();
  el.classList.remove('hidden');
  document.body.classList.add('amount-ops-on');
  syncReadout(input);
  schedulePlace();
}

/**
 * Live preview + operator row for one amount input.
 * @param {HTMLInputElement} input
 * @param {HTMLElement} preview
 */
export function bindAmountField(input, preview) {
  let lastCents = null;
  let saveError = null;

  const render = () => {
    preview.classList.remove('is-stale', 'is-error');
    if (saveError) {
      preview.textContent = saveError;
      preview.classList.add('is-error');
    } else {
      const result = evaluateAmount(input.value);
      if (result.status === 'ok') {
        lastCents = result.cents;
        preview.textContent = formatAmountPreview(result.cents);
      } else {
        if (result.status === 'empty') lastCents = null;
        preview.classList.add('is-stale');
        preview.textContent = lastCents == null ? PLACEHOLDER : formatAmountPreview(lastCents);
      }
    }
    if (activeInput === input) syncReadout(input);
  };

  const onFocus = () => showAmountOps(input);
  const onInput = () => {
    saveError = null;
    input.removeAttribute('aria-invalid');
    render();
  };
  const onBlur = () => {
    setTimeout(() => {
      if (document.activeElement === input) return;
      if (bar && bar.contains(document.activeElement)) {
        input.focus();
        return;
      }
      const result = evaluateAmount(input.value);
      if (result.status === 'ok') {
        const resolved = formatAmountInput(result.cents);
        if (resolved !== input.value) input.value = resolved;
        lastCents = result.cents;
        saveError = null;
        input.removeAttribute('aria-invalid');
      }
      if (activeInput === input) hideAmountOps();
      render();
    }, 0);
  };

  input.addEventListener('input', onInput);
  input.addEventListener('focus', onFocus);
  input.addEventListener('focusin', schedulePlace);
  input.addEventListener('blur', onBlur);
  render();

  return {
    /** Show the operator row. Safe to call if the field is already focused. */
    show() {
      showAmountOps(input);
    },
    /**
     * @param {string} message
     */
    showError(message) {
      saveError = message;
      input.setAttribute('aria-invalid', 'true');
      render();
    },
    destroy() {
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('focusin', schedulePlace);
      input.removeEventListener('blur', onBlur);
      if (activeInput === input) hideAmountOps();
    },
  };
}
