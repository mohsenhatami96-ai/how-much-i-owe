import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAmount } from '../../domain/money.js';
import { createEntry } from '../../domain/entries.js';
import {
  applyAmountKey,
  evaluateAmount,
  formatAmountInput,
  formatAmountPreview,
} from '../../domain/expr.js';

describe('evaluateAmount', () => {
  it('evaluates addition, subtraction, multiplication, and division', () => {
    assert.deepEqual(evaluateAmount('120+35.5'), { status: 'ok', cents: 15550 });
    assert.deepEqual(evaluateAmount('2*45-10'), { status: 'ok', cents: 8000 });
    assert.deepEqual(evaluateAmount('300/3'), { status: 'ok', cents: 10000 });
    assert.deepEqual(evaluateAmount('(40+60)*1.25'), { status: 'ok', cents: 12500 });
  });

  it('respects precedence and parentheses', () => {
    assert.equal(evaluateAmount('2+3*4').cents, 1400);
    assert.equal(evaluateAmount('(2+3)*4').cents, 2000);
    assert.equal(evaluateAmount('100-20-30').cents, 5000);
    assert.equal(evaluateAmount('8/4/2').cents, 100);
    assert.equal(evaluateAmount('((2+3)*4)').cents, 2000);
  });

  it('accepts a comma as the decimal separator', () => {
    assert.equal(evaluateAmount('120+35,5').cents, 15550);
    assert.equal(evaluateAmount('1,50').cents, 150);
    assert.equal(evaluateAmount('(40+60)*1,25').cents, 12500);
    assert.equal(evaluateAmount('1.234,50+1').cents, 123550);
  });

  it('tolerates spaces and the symbols × ÷ −', () => {
    assert.equal(evaluateAmount('120 + 35.5').cents, 15550);
    assert.equal(evaluateAmount('1 250 + 50').cents, 130000);
    assert.equal(evaluateAmount('2×45−10').cents, 8000);
    assert.equal(evaluateAmount('300÷3').cents, 10000);
    assert.equal(evaluateAmount('10–2').cents, 800);
    assert.equal(evaluateAmount('120\u00a0+\u00a035,5').cents, 15550);
    assert.equal(evaluateAmount("1'200+50").cents, 125000);
  });

  it('matches parseAmount for plain numbers', () => {
    const samples = ['1234.56', '12.5', '100', '0', '00.5', '5.', '1,234.56', '1.234,56', '12,3', '1,234', '1 234,56', "1'234.5", '12\u202f345'];
    for (const sample of samples) {
      const cents = parseAmount(sample);
      assert.equal(evaluateAmount(sample).status, 'ok', sample);
      assert.equal(evaluateAmount(sample).cents, cents, sample);
    }
  });

  it('rounds the final result to cents', () => {
    assert.equal(evaluateAmount('10/4').cents, 250);
    assert.equal(evaluateAmount('1/3').cents, 33);
    assert.equal(evaluateAmount('2/3').cents, 67);
    assert.equal(evaluateAmount('0.1+0.2').cents, 30);
    assert.equal(evaluateAmount('19.99+0.01').cents, 2000);
  });

  it('returns a finite integer and never NaN or Infinity', () => {
    const ok = evaluateAmount('(40+60)*1.25');
    assert.equal(Number.isSafeInteger(ok.cents), true);
    const bad = evaluateAmount('1/0');
    assert.equal(bad.status, 'error');
    assert.equal(Object.hasOwn(bad, 'cents'), false);
    assert.equal(evaluateAmount('1/(2-2)').status, 'error');
    assert.match(evaluateAmount('1/0').error, /divide by zero/i);
  });

  it('treats a trailing operator or unclosed parenthesis as incomplete', () => {
    for (const sample of ['120+', '120+ ', '(40+60', '(', '120*', '120/', '+', '-', '1+2*(']) {
      const result = evaluateAmount(sample);
      assert.equal(result.status, 'incomplete', sample);
      assert.equal(Object.hasOwn(result, 'cents'), false, sample);
    }
  });

  it('rejects malformed input and empty input without a number', () => {
    assert.equal(evaluateAmount('').status, 'empty');
    assert.equal(evaluateAmount('   ').status, 'empty');
    assert.equal(evaluateAmount(null).status, 'empty');
    for (const sample of ['abc', '1.2.3', ')', '()', '12+*3', '*12', '1/0']) {
      assert.equal(evaluateAmount(sample).status, 'error', sample);
      assert.equal(typeof evaluateAmount(sample).error, 'string', sample);
    }
  });

  it('allows a negative result as a number so save can reject it', () => {
    assert.deepEqual(evaluateAmount('10-30'), { status: 'ok', cents: -2000 });
  });

  it('saves the evaluated cents through createEntry, not the expression', () => {
    const result = evaluateAmount('120+35.5');
    const entry = createEntry({
      id: 'e1',
      personId: 'p1',
      amount: result.cents,
      type: 'borrow',
      currency: 'SEK',
      description: 'lunch',
      date: '2026-11-16',
      now: 1,
    });
    assert.equal(entry.amount, 15550);
    assert.equal(typeof entry.amount, 'number');
    assert.equal(JSON.stringify(entry).includes('120+35.5'), false);
  });
});

describe('formatAmountPreview', () => {
  it('formats cents as = major.minor with two decimals', () => {
    assert.equal(formatAmountPreview(15550), '= 155.50');
    assert.equal(formatAmountPreview(125000), '= 1250.00');
    assert.equal(formatAmountPreview(33), '= 0.33');
    assert.equal(formatAmountPreview(0), '= 0.00');
    assert.equal(formatAmountPreview(-2000), '= -20.00');
  });
});

describe('formatAmountInput', () => {
  it('resolves cents to a plain number the field can store', () => {
    assert.equal(formatAmountInput(15550), '155.5');
    assert.equal(formatAmountInput(15555), '155.55');
    assert.equal(formatAmountInput(10000), '100');
    assert.equal(formatAmountInput(50), '0.5');
    assert.equal(formatAmountInput(5), '0.05');
    assert.equal(formatAmountInput(-2000), '-20');
  });
});

describe('applyAmountKey', () => {
  it('inserts the operator at the cursor', () => {
    assert.deepEqual(applyAmountKey('12', 2, 2, '+'), { value: '12+', cursor: 3 });
    assert.deepEqual(applyAmountKey('1234', 2, 2, '*'), { value: '12×34', cursor: 3 });
    assert.deepEqual(applyAmountKey('12', 1, 1, '-'), { value: '1−2', cursor: 2 });
    assert.deepEqual(applyAmountKey('12', 2, 2, '/'), { value: '12÷', cursor: 3 });
  });

  it('inserts ) when an open parenthesis is unclosed before the cursor', () => {
    assert.deepEqual(applyAmountKey('(40+60', 6, 6, 'paren'), { value: '(40+60)', cursor: 7 });
    assert.deepEqual(applyAmountKey('((2)', 4, 4, 'paren'), { value: '((2))', cursor: 5 });
  });

  it('inserts ( when parentheses before the cursor are balanced', () => {
    assert.deepEqual(applyAmountKey('(40+60)', 7, 7, 'paren'), { value: '(40+60)(', cursor: 8 });
    assert.deepEqual(applyAmountKey('40+60', 0, 0, 'paren'), { value: '(40+60', cursor: 1 });
  });

  it('backspace deletes the selection or the character before the cursor', () => {
    assert.deepEqual(applyAmountKey('120+', 4, 4, 'back'), { value: '120', cursor: 3 });
    assert.deepEqual(applyAmountKey('120+35', 3, 5, 'back'), { value: '1205', cursor: 3 });
    assert.deepEqual(applyAmountKey('120', 0, 0, 'back'), { value: '120', cursor: 0 });
  });
});

describe('expr module safety', () => {
  it('does not evaluate with eval or Function', () => {
    const src = readFileSync(new URL('../../domain/expr.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\beval\s*\(/);
    assert.doesNotMatch(src, /\bnew\s+Function\b/);
    assert.doesNotMatch(src, /\bFunction\s*\(/);
  });
});
