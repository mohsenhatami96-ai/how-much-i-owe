import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { caretScrollLeft, operatorBarTop } from '../../ui/amount-layout.js';

describe('operatorBarTop', () => {
  it('sits the strip on the bottom of the visual viewport', () => {
    assert.equal(operatorBarTop({ offsetTop: 0, height: 844, barHeight: 76 }), 844 - 76);
    assert.equal(operatorBarTop({ offsetTop: 0, height: 367, barHeight: 80 }), 367 - 80);
  });

  it('follows a scrolled visual viewport', () => {
    const top = operatorBarTop({ offsetTop: 92, height: 360, barHeight: 76, innerHeight: 844 });
    assert.equal(top, 92 + 360 - 76);
  });

  it('ignores a stale innerHeight that would open a gap', () => {
    const fresh = operatorBarTop({ offsetTop: 92, height: 360, barHeight: 76, innerHeight: 844 });
    const stale = operatorBarTop({ offsetTop: 92, height: 360, barHeight: 76, innerHeight: 400 });
    assert.equal(stale, fresh);
    const staleBottom = Math.max(0, 400 - (92 + 360));
    assert.equal(staleBottom, 0);
    assert.notEqual(stale, 400 - staleBottom - 76);
  });
});

describe('caretScrollLeft', () => {
  it('keeps the caret at the right edge when the expression overflows', () => {
    assert.equal(caretScrollLeft({ caretRight: 420, clientWidth: 180, scrollWidth: 420 }), 240);
    assert.equal(caretScrollLeft({ caretRight: 50, clientWidth: 180, scrollWidth: 80 }), 0);
  });

  it('does not scroll past the expression', () => {
    assert.equal(caretScrollLeft({ caretRight: 500, clientWidth: 100, scrollWidth: 300 }), 200);
  });
});
