/**
 * IndexedDB adapter for How Much I Owe.
 * DB name/version/stores/indexes and onupgradeneeded must stay identical to the
 * pre-refactor app — see docs/superpowers/specs/... §4 Data safety.
 *
 * @typedef {import('../domain/ports.js').Repos} Repos
 * @typedef {import('../domain/ports.js').WriteOp} WriteOp
 */

export const DB_NAME = 'how-much-i-owe';
export const DB_VERSION = 1;

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/** @type {((msg: string) => void)|null} */
let blockedHandler = null;

/** UI can register a toast (or similar) for multi-tab upgrade blocks. */
export function setBlockedHandler(fn) {
  blockedHandler = typeof fn === 'function' ? fn : null;
}

/** Test helper: drop the cached open promise so the next openDB is fresh. */
export function resetDbPromise() {
  dbPromise = null;
}

/**
 * Open (and cache) the app database. onupgradeneeded is copied verbatim from legacy app.js.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('people')) db.createObjectStore('people', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('personId', 'personId');
      }
      if (!db.objectStoreNames.contains('images')) {
        const s = db.createObjectStore('images', { keyPath: 'id' });
        s.createIndex('personId', 'personId');
        s.createIndex('entryId', 'entryId');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        if (typeof location !== 'undefined' && location && typeof location.reload === 'function') {
          location.reload();
        }
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => {
      if (blockedHandler) blockedHandler('Close other tabs of this app to finish updating.');
    };
  });
  return dbPromise;
}

export const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const txDone = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transaction aborted')); });

export async function getAll(store, index, key) {
  const db = await openDB();
  const s = db.transaction(store, 'readonly').objectStore(store);
  return reqP(index ? s.index(index).getAll(key) : s.getAll());
}

export async function getOne(store, key) {
  const db = await openDB();
  return reqP(db.transaction(store, 'readonly').objectStore(store).get(key));
}

/** Run a set of writes in one transaction. ops: [{store, put}|{store, del}] */
export async function writeOps(ops) {
  if (!ops.length) return;
  const db = await openDB();
  const stores = [...new Set(ops.map((o) => o.store))];
  const t = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const s = t.objectStore(o.store);
    if (o.put !== undefined) s.put(o.put); else s.delete(o.del);
  }
  return txDone(t);
}

export async function getMeta(key, fallback) {
  const r = await getOne('meta', key);
  return r ? r.value : fallback;
}

export const setMeta = (key, value) => writeOps([{ store: 'meta', put: { key, value } }]);

/**
 * Concrete repos implementing domain/ports.js contracts.
 * @returns {Repos}
 */
export function createRepos() {
  return {
    people: {
      list: () => getAll('people'),
      get: (id) => getOne('people', id),
      put: (person) => writeOps([{ store: 'people', put: person }]),
      delete: (id) => writeOps([{ store: 'people', del: id }]),
    },
    entries: {
      list: () => getAll('entries'),
      listByPerson: (personId) => getAll('entries', 'personId', personId),
      get: (id) => getOne('entries', id),
      put: (entry) => writeOps([{ store: 'entries', put: entry }]),
      delete: (id) => writeOps([{ store: 'entries', del: id }]),
    },
    attachments: {
      list: () => getAll('images'),
      listByPerson: (personId) => getAll('images', 'personId', personId),
      listByEntry: (entryId) => getAll('images', 'entryId', entryId),
      put: (att) => writeOps([{ store: 'images', put: att }]),
      delete: (id) => writeOps([{ store: 'images', del: id }]),
    },
    meta: {
      list: () => getAll('meta'),
      get: getMeta,
      set: setMeta,
    },
  };
}
