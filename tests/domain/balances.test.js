import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  balanceOf,
  sortedBalances,
  runningBalances,
  balanceClass,
} from '../../domain/balances.js';

const e = (partial) => ({
  id: partial.id || 'x',
  type: partial.type || 'borrow',
  amount: partial.amount,
  currency: partial.currency || 'SEK',
  ...partial,
});

describe('balanceOf', () => {
  it('returns empty Map for no entries', () => {
    const m = balanceOf([]);
    assert.ok(m instanceof Map);
    assert.equal(m.size, 0);
  });

  it('sums borrow as positive (I owe them) per currency', () => {
    const m = balanceOf([
      e({ amount: 10000, currency: 'SEK' }),
      e({ amount: 5000, currency: 'SEK' }),
      e({ amount: 2000, currency: 'EUR' }),
    ]);
    assert.equal(m.get('SEK'), 15000);
    assert.equal(m.get('EUR'), 2000);
    assert.equal(m.size, 2);
  });

  it('subtracts repay amounts', () => {
    const m = balanceOf([
      e({ type: 'borrow', amount: 10000, currency: 'SEK' }),
      e({ type: 'repay', amount: 3000, currency: 'SEK' }),
    ]);
    assert.equal(m.get('SEK'), 7000);
  });

  it('drops currencies that net to zero', () => {
    const m = balanceOf([
      e({ type: 'borrow', amount: 5000, currency: 'SEK' }),
      e({ type: 'repay', amount: 5000, currency: 'SEK' }),
      e({ type: 'borrow', amount: 100, currency: 'EUR' }),
    ]);
    assert.equal(m.has('SEK'), false);
    assert.equal(m.get('EUR'), 100);
    assert.equal(m.size, 1);
  });

  it('allows negative net (they owe me)', () => {
    const m = balanceOf([
      e({ type: 'repay', amount: 8000, currency: 'USD' }),
      e({ type: 'borrow', amount: 2000, currency: 'USD' }),
    ]);
    assert.equal(m.get('USD'), -6000);
  });
});

describe('sortedBalances', () => {
  it('puts default currency first, then localeCompare of codes', () => {
    const m = new Map([
      ['USD', 100],
      ['EUR', 200],
      ['SEK', 300],
      ['AED', 50],
    ]);
    const rows = sortedBalances(m, 'SEK');
    assert.deepEqual(rows.map(([c]) => c), ['SEK', 'AED', 'EUR', 'USD']);
    assert.equal(rows[0][1], 300);
  });

  it('returns empty array for empty map', () => {
    assert.deepEqual(sortedBalances(new Map(), 'SEK'), []);
  });

  it('keeps sole non-default currency alone', () => {
    const m = new Map([['EUR', -10]]);
    assert.deepEqual(sortedBalances(m, 'SEK'), [['EUR', -10]]);
  });
});

describe('balanceClass', () => {
  it('maps positive / negative / zero to owe / owed / settled', () => {
    assert.equal(balanceClass(1), 'owe');
    assert.equal(balanceClass(100), 'owe');
    assert.equal(balanceClass(-1), 'owed');
    assert.equal(balanceClass(-50), 'owed');
    assert.equal(balanceClass(0), 'settled');
  });
});

describe('runningBalances', () => {
  it('returns Map(entryId -> balance in that currency after the entry)', () => {
    // Input is newest-first (as sortEntries produces). Chronology:
    // oldest: borrow 100 SEK -> after = 100
    // then: repay 30 SEK -> after = 70
    // newest: borrow 20 EUR -> after = 20 (EUR)
    const entries = [
      e({ id: 'n', type: 'borrow', amount: 2000, currency: 'EUR' }),
      e({ id: 'm', type: 'repay', amount: 3000, currency: 'SEK' }),
      e({ id: 'o', type: 'borrow', amount: 10000, currency: 'SEK' }),
    ];
    const after = runningBalances(entries);
    assert.ok(after instanceof Map);
    assert.equal(after.get('o'), 10000);
    assert.equal(after.get('m'), 7000);
    assert.equal(after.get('n'), 2000);
  });

  it('does not mutate the input array order', () => {
    const entries = [
      e({ id: 'a', amount: 100, currency: 'SEK' }),
      e({ id: 'b', amount: 200, currency: 'SEK' }),
    ];
    const idsBefore = entries.map((x) => x.id);
    runningBalances(entries);
    assert.deepEqual(entries.map((x) => x.id), idsBefore);
  });

  it('tracks each currency independently across the timeline', () => {
    const entries = [
      e({ id: '3', type: 'repay', amount: 1000, currency: 'EUR' }),
      e({ id: '2', type: 'borrow', amount: 5000, currency: 'SEK' }),
      e({ id: '1', type: 'borrow', amount: 2000, currency: 'EUR' }),
    ];
    const after = runningBalances(entries);
    assert.equal(after.get('1'), 2000); // EUR after first
    assert.equal(after.get('2'), 5000); // SEK after second
    assert.equal(after.get('3'), 1000); // EUR after repay: 2000-1000
  });
});
