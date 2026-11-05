import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { avatarColor, initials, validatePersonInput, createPerson, updatePerson } from '../../domain/people.js';

describe('avatarColor', () => {
  it('is stable for the same name', () => {
    assert.equal(avatarColor('Ali'), avatarColor('Ali'));
    assert.equal(avatarColor('Mohsen Hatami'), avatarColor('Mohsen Hatami'));
  });

  it('returns a palette hex color', () => {
    const palette = ['#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#64748b'];
    assert.ok(palette.includes(avatarColor('Ali')));
    assert.ok(palette.includes(avatarColor('')));
    assert.ok(palette.includes(avatarColor('اسماعیل')));
  });

  it('differs for some distinct names (hash spreads)', () => {
    const colors = new Set(['Ali', 'Bob', 'Cara', 'Dana', 'Eve', 'Farid', 'Gina', 'Hadi'].map(avatarColor));
    assert.ok(colors.size >= 2);
  });
});

describe('initials', () => {
  it('takes up to two word initials, uppercased', () => {
    assert.equal(initials('Ali'), 'A');
    assert.equal(initials('Mohsen Hatami'), 'MH');
    assert.equal(initials('  ann  marie  smith '), 'AM');
  });

  it('handles empty and unicode', () => {
    assert.equal(initials(''), '?');
    assert.equal(initials('   '), '?');
    assert.equal(initials('علی رضایی'), 'عر');
  });
});

describe('validatePersonInput', () => {
  it('requires a non-empty trimmed name', () => {
    assert.deepEqual(validatePersonInput({ name: '', note: 'x' }), { ok: false, error: 'Please enter a name' });
    assert.deepEqual(validatePersonInput({ name: '   ', note: '' }), { ok: false, error: 'Please enter a name' });
  });

  it('trims name and note and caps lengths', () => {
    const longName = 'x'.repeat(100);
    const longNote = 'y'.repeat(600);
    const v = validatePersonInput({ name: '  Ali  ', note: '  brother  ' });
    assert.deepEqual(v, { ok: true, name: 'Ali', note: 'brother' });
    const capped = validatePersonInput({ name: longName, note: longNote });
    assert.equal(capped.ok, true);
    assert.equal(capped.name.length, 80);
    assert.equal(capped.note.length, 500);
  });
});

describe('createPerson / updatePerson', () => {
  it('creates a person record with timestamps', () => {
    const p = createPerson({ id: 'p1', name: ' Ali ', note: ' pal ', now: 1000 });
    assert.deepEqual(p, { id: 'p1', name: 'Ali', note: 'pal', createdAt: 1000, updatedAt: 1000 });
  });

  it('throws on invalid create', () => {
    assert.throws(() => createPerson({ id: 'p1', name: '  ', now: 1 }), /Please enter a name/);
  });

  it('updates name/note and updatedAt, preserves id/createdAt', () => {
    const base = { id: 'p1', name: 'Ali', note: '', createdAt: 100, updatedAt: 100 };
    const u = updatePerson(base, { name: 'Ali Reza', note: 'cousin' }, 200);
    assert.deepEqual(u, { id: 'p1', name: 'Ali Reza', note: 'cousin', createdAt: 100, updatedAt: 200 });
  });
});
