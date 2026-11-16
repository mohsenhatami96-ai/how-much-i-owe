/** Amount field: live preview and the operator row above the keyboard. */

import {
  applyAmountKey,
  evaluateAmount,
  formatAmountInput,
  formatAmountPreview,
} from '../domain/expr.js';

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

function buzz() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(10);
  } catch {
    /* Vibration API missing or blocked. */
  }
}

function keyboardOffset() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
}

function placeBar() {
  if (!bar) return;
  const offset = keyboardOffset();
  bar.style.bottom = `${offset}px`;
  bar.style.paddingBottom = offset > 0 ? '0px' : '';
}

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'amount-ops hidden';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Amount operators');
  bar.innerHTML = KEYS.map((k) =>
    `<button type="button" data-key="${k.key}" aria-label="${k.name}" tabindex="-1">${k.label}</button>`
  ).join('');
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
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', placeBar);
    window.visualViewport.addEventListener('scroll', placeBar);
  }
  window.addEventListener('resize', placeBar);
  return bar;
}

export function hideAmountOps() {
  activeInput = null;
  document.body.classList.remove('amount-ops-on');
  if (bar) bar.classList.add('hidden');
}

/**
 * @param {HTMLInputElement} input
 */
export function showAmountOps(input) {
  activeInput = input;
  const el = ensureBar();
  el.classList.remove('hidden');
  document.body.classList.add('amount-ops-on');
  placeBar();
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
      return;
    }
    const result = evaluateAmount(input.value);
    if (result.status === 'ok') {
      lastCents = result.cents;
      preview.textContent = formatAmountPreview(result.cents);
      return;
    }
    if (result.status === 'empty') lastCents = null;
    preview.classList.add('is-stale');
    preview.textContent = lastCents == null ? PLACEHOLDER : formatAmountPreview(lastCents);
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
      input.removeEventListener('blur', onBlur);
      if (activeInput === input) hideAmountOps();
    },
  };
}
