/**
 * Where the operator strip sits while an amount is being typed.
 * Coordinates match visualViewport.offsetTop (layout viewport).
 * innerHeight is intentionally unused: a stale window.innerHeight is what
 * opened the gap above the iOS keyboard.
 * @param {{ offsetTop: number, height: number, barHeight: number, innerHeight?: number }} box
 * @returns {number}
 */
export function operatorBarTop({ offsetTop, height, barHeight }) {
  return offsetTop + height - barHeight;
}

/**
 * Scroll offset that keeps the caret's right edge inside the expression line.
 * @param {{ caretRight: number, clientWidth: number, scrollWidth: number }} box
 * @returns {number}
 */
export function caretScrollLeft({ caretRight, clientWidth, scrollWidth }) {
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const desired = caretRight - clientWidth;
  return Math.max(0, Math.min(maxScroll, desired));
}
