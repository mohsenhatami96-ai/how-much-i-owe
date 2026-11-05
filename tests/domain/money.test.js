import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, fmtMoney } from '../../domain/money.js';

describe('parseAmount', () => {
  it('parses plain decimals into cents', () => {
    assert.equal(parseAmount('1234.56'), 123456);
    assert.equal(parseAmount('12.5'), 1250);
    assert.equal(parseAmount('100'), 10000);
    assert.equal(parseAmount('0'), 0);
    assert.equal(parseAmount('00.5'), 50);
    assert.equal(parseAmount('5.'), 500);
  });

  it('treats the last of mixed comma/dot as the decimal separator', () => {
    assert.equal(parseAmount('1,234.56'), 123456);
    assert.equal(parseAmount('1.234,56'), 123456);
  });

  it('treats a single comma as decimal (EU style)', () => {
    assert.equal(parseAmount('12,3'), 1230);
    // Ambiguous US-style thousands: still treated as decimal per current impl
    assert.equal(parseAmount('1,234'), 123);
  });

  it('strips spaces, NBSP, narrow NBSP, and apostrophe grouping', () => {
    assert.equal(parseAmount('1 234,56'), 123456);
    assert.equal(parseAmount('1\u00a0234,50'), 123450);
    assert.equal(parseAmount('12\u202f345'), 1234500);
    assert.equal(parseAmount("1'234.5"), 123450);
  });

  it('returns NaN for empty, invalid, and negatives', () => {
    assert.ok(Number.isNaN(parseAmount('')));
    assert.ok(Number.isNaN(parseAmount('  ')));
    assert.ok(Number.isNaN(parseAmount('abc')));
    assert.ok(Number.isNaN(parseAmount('-5')));
    assert.ok(Number.isNaN(parseAmount('.')));
    assert.ok(Number.isNaN(parseAmount('1.2.3')));
    assert.ok(Number.isNaN(parseAmount(null)));
    assert.ok(Number.isNaN(parseAmount(undefined)));
  });
});

describe('fmtMoney', () => {
  // Locale on this box is en-US; currencyDisplay:code uses NBSP (U+00A0).
  const nbsp = '\u00a0';

  it('formats whole amounts with zero fraction digits', () => {
    assert.equal(fmtMoney(0, 'SEK'), `SEK${nbsp}0`);
    assert.equal(fmtMoney(10000, 'SEK'), `SEK${nbsp}100`);
    assert.equal(fmtMoney(100, 'EUR'), `EUR${nbsp}1`);
    assert.equal(fmtMoney(50000, 'IRR'), `IRR${nbsp}500`);
  });

  it('formats fractional amounts with two digits', () => {
    assert.equal(fmtMoney(12345, 'SEK'), `SEK${nbsp}123.45`);
    assert.equal(fmtMoney(123, 'EUR'), `EUR${nbsp}1.23`);
    assert.equal(fmtMoney(99, 'SEK'), `SEK${nbsp}0.99`);
  });

  it('uses absolute value; optional sign prefix (+ / U+2212)', () => {
    assert.equal(fmtMoney(100, 'SEK', { sign: true }), `+SEK${nbsp}1`);
    assert.equal(fmtMoney(-100, 'SEK', { sign: true }), `\u2212SEK${nbsp}1`);
    assert.equal(fmtMoney(0, 'SEK', { sign: true }), `SEK${nbsp}0`);
    assert.equal(fmtMoney(-12345, 'EUR', { sign: true }), `\u2212EUR${nbsp}123.45`);
    assert.equal(fmtMoney(-50, 'IRR', { sign: true }), `\u2212IRR${nbsp}0.50`);
    // sign defaults false
    assert.equal(fmtMoney(-100, 'SEK'), `SEK${nbsp}1`);
  });
});
