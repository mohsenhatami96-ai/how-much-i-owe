import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTRY_TYPES,
  normalizeEntryType,
  entryTitle,
  sortEntries,
  validateEntryInput,
  createEntry,
  updateEntry,
} from '../../domain/entries.js';

describe('ENTRY_TYPES / normalizeEntryType', () => {
  it('exposes borrow and repay only', () => {
    assert.deepEqual([...ENTRY_TYPES], ['borrow', 'repay']);
  });

  it('normalizes unknown types to borrow', () => {
    assert.equal(normalizeEntryType('repay'), 'repay');
    assert.equal(normalizeEntryType('borrow'), 'borrow');
    assert.equal(normalizeEntryType('lend'), 'borrow');
    assert.equal(normalizeEntryType(null), 'borrow');
    assert.equal(normalizeEntryType(undefined), 'borrow');
  });
});

describe('entryTitle', () => {
  it('prefers description, else Paid back / Borrowed', () => {
    assert.equal(entryTitle({ description: 'lunch', type: 'borrow' }), 'lunch');
    assert.equal(entryTitle({ description: '', type: 'repay' }), 'Paid back');
    assert.equal(entryTitle({ type: 'borrow' }), 'Borrowed');
    assert.equal(entryTitle({ description: null, type: 'repay' }), 'Paid back');
  });
});

describe('sortEntries', () => {
  it('sorts newest date first, then createdAt; mutates in place', () => {
    const a = { id: 'a', date: '2024-01-01', createdAt: 10 };
    const b = { id: 'b', date: '2024-02-01', createdAt: 1 };
    const c = { id: 'c', date: '2024-02-01', createdAt: 5 };
    const arr = [a, b, c];
    const out = sortEntries(arr);
    assert.equal(out, arr);
    assert.deepEqual(arr.map((e) => e.id), ['c', 'b', 'a']);
  });
});

describe('validateEntryInput', () => {
  it('rejects non-positive / non-finite amounts', () => {
    assert.equal(validateEntryInput({ amount: NaN, type: 'borrow', currency: 'SEK', description: '', date: '2024-01-01' }).ok, false);
    assert.equal(validateEntryInput({ amount: 0, type: 'borrow', currency: 'SEK', description: '', date: '2024-01-01' }).ok, false);
    assert.equal(validateEntryInput({ amount: -100, type: 'borrow', currency: 'SEK', description: '', date: '2024-01-01' }).ok, false);
    assert.match(validateEntryInput({ amount: 0, type: 'borrow', currency: 'SEK', description: '', date: '2024-01-01' }).error, /amount greater than 0/);
  });

  it('accepts valid input and normalizes fields', () => {
    const v = validateEntryInput({
      amount: 1250,
      type: 'repay',
      currency: 'eur',
      description: '  coffee  ',
      date: '2024-06-01',
    });
    assert.deepEqual(v, {
      ok: true,
      amount: 1250,
      type: 'repay',
      currency: 'EUR',
      description: 'coffee',
      date: '2024-06-01',
    });
  });

  it('caps description length and defaults empty date via fallbackDate', () => {
    const v = validateEntryInput({
      amount: 100,
      type: 'borrow',
      currency: 'SEK',
      description: 'z'.repeat(200),
      date: '',
      fallbackDate: '2024-01-02',
    });
    assert.equal(v.ok, true);
    assert.equal(v.description.length, 140);
    assert.equal(v.date, '2024-01-02');
  });
});

describe('createEntry / updateEntry', () => {
  it('creates an entry with required fields', () => {
    const e = createEntry({
      id: 'e1',
      personId: 'p1',
      amount: 500,
      type: 'borrow',
      currency: 'SEK',
      description: 'taxi',
      date: '2024-03-01',
      now: 42,
    });
    assert.deepEqual(e, {
      id: 'e1',
      personId: 'p1',
      type: 'borrow',
      amount: 500,
      currency: 'SEK',
      description: 'taxi',
      date: '2024-03-01',
      createdAt: 42,
      updatedAt: 42,
    });
  });

  it('throws on invalid create', () => {
    assert.throws(
      () => createEntry({ id: 'e1', personId: 'p1', amount: 0, type: 'borrow', currency: 'SEK', description: '', date: '2024-01-01', now: 1 }),
      /amount greater than 0/
    );
  });

  it('updates fields while preserving id/personId/createdAt', () => {
    const base = {
      id: 'e1', personId: 'p1', type: 'borrow', amount: 100, currency: 'SEK',
      description: 'a', date: '2024-01-01', createdAt: 10, updatedAt: 10,
    };
    const u = updateEntry(base, {
      amount: 200, type: 'repay', currency: 'EUR', description: 'b', date: '2024-02-01',
    }, 99);
    assert.equal(u.id, 'e1');
    assert.equal(u.personId, 'p1');
    assert.equal(u.createdAt, 10);
    assert.equal(u.updatedAt, 99);
    assert.equal(u.type, 'repay');
    assert.equal(u.amount, 200);
    assert.equal(u.currency, 'EUR');
    assert.equal(u.description, 'b');
    assert.equal(u.date, '2024-02-01');
  });
});
