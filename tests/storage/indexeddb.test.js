import 'fake-indexeddb/auto';
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDB,
  getAll,
  getOne,
  writeOps,
  getMeta,
  setMeta,
  createRepos,
  resetDbPromise,
  DB_NAME,
  DB_VERSION,
} from '../../storage/indexeddb.js';

async function wipeDb() {
  resetDbPromise();
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
  resetDbPromise();
}

describe('storage/indexeddb', () => {
  before(async () => {
    await wipeDb();
  });

  beforeEach(async () => {
    await wipeDb();
    await openDB();
  });

  afterEach(async () => {
    await wipeDb();
  });

  it('opens DB how-much-i-owe v1 with people/entries/images/meta stores', async () => {
    const db = await openDB();
    assert.equal(db.name, 'how-much-i-owe');
    assert.equal(db.version, DB_VERSION);
    assert.equal(DB_VERSION, 1);
    assert.ok(db.objectStoreNames.contains('people'));
    assert.ok(db.objectStoreNames.contains('entries'));
    assert.ok(db.objectStoreNames.contains('images'));
    assert.ok(db.objectStoreNames.contains('meta'));
  });

  it('put/get/delete people and entries via helpers', async () => {
    const person = { id: 'p1', name: 'Ada', createdAt: 1 };
    const entry = { id: 'e1', personId: 'p1', type: 'borrow', amount: 1000, currency: 'SEK', date: '2026-01-01', createdAt: 2 };

    await writeOps([
      { store: 'people', put: person },
      { store: 'entries', put: entry },
    ]);

    assert.deepEqual(await getOne('people', 'p1'), person);
    assert.deepEqual(await getOne('entries', 'e1'), entry);

    const people = await getAll('people');
    assert.equal(people.length, 1);
    assert.equal(people[0].name, 'Ada');

    const byPerson = await getAll('entries', 'personId', 'p1');
    assert.equal(byPerson.length, 1);
    assert.equal(byPerson[0].id, 'e1');

    await writeOps([
      { store: 'entries', del: 'e1' },
      { store: 'people', del: 'p1' },
    ]);
    assert.equal(await getOne('people', 'p1'), undefined);
    assert.equal(await getOne('entries', 'e1'), undefined);
    assert.equal((await getAll('people')).length, 0);
    assert.equal((await getAll('entries')).length, 0);
  });

  it('meta get/set with fallback', async () => {
    assert.equal(await getMeta('missing', 'SEK'), 'SEK');
    await setMeta('defaultCurrency', 'EUR');
    assert.equal(await getMeta('defaultCurrency', 'SEK'), 'EUR');
  });

  it('repos mirror store semantics for people and entries', async () => {
    const { people, entries, attachments, meta } = createRepos();
    await people.put({ id: 'p2', name: 'Bob', createdAt: 3 });
    await entries.put({ id: 'e2', personId: 'p2', type: 'repay', amount: 500, currency: 'EUR', date: '2026-02-01', createdAt: 4 });
    await attachments.put({ id: 'a1', personId: 'p2', entryId: 'e2', kind: 'image', createdAt: 5, data: new Uint8Array([1, 2]) });

    assert.equal((await people.list()).length, 1);
    assert.equal((await people.get('p2')).name, 'Bob');
    assert.equal((await entries.listByPerson('p2')).length, 1);
    assert.equal((await attachments.listByEntry('e2')).length, 1);

    await meta.set('lastCurrency:p2', 'EUR');
    assert.equal(await meta.get('lastCurrency:p2', null), 'EUR');

    await entries.delete('e2');
    await attachments.delete('a1');
    await people.delete('p2');
    assert.equal((await people.list()).length, 0);
  });
});
