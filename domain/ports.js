/**
 * Storage port contracts for How Much I Owe.
 * Domain and UI depend on these shapes; only storage/ implements them against IndexedDB.
 * No runtime code — JSDoc only.
 */

/**
 * @typedef {{ id: string, name: string, note?: string, createdAt: number, [k: string]: unknown }} Person
 * @typedef {{ id: string, personId: string, type: 'borrow'|'repay', amount: number, currency: string, date: string, note?: string, createdAt: number, [k: string]: unknown }} Entry
 * @typedef {{ id: string, personId: string, entryId?: string|null, createdAt: number, [k: string]: unknown }} Attachment
 * @typedef {{ key: string, value: unknown }} MetaRow
 */

/**
 * @typedef {Object} PeopleRepo
 * @property {() => Promise<Person[]>} list
 * @property {(id: string) => Promise<Person|undefined>} get
 * @property {(person: Person) => Promise<void>} put
 * @property {(id: string) => Promise<void>} delete
 */

/**
 * @typedef {Object} EntryRepo
 * @property {() => Promise<Entry[]>} list
 * @property {(personId: string) => Promise<Entry[]>} listByPerson
 * @property {(id: string) => Promise<Entry|undefined>} get
 * @property {(entry: Entry) => Promise<void>} put
 * @property {(id: string) => Promise<void>} delete
 */

/**
 * @typedef {Object} AttachmentRepo
 * @property {() => Promise<Attachment[]>} list
 * @property {(personId: string) => Promise<Attachment[]>} listByPerson
 * @property {(entryId: string) => Promise<Attachment[]>} listByEntry
 * @property {(att: Attachment) => Promise<void>} put
 * @property {(id: string) => Promise<void>} delete
 */

/**
 * @typedef {Object} MetaRepo
 * @property {() => Promise<MetaRow[]>} list
 * @property {(key: string, fallback?: unknown) => Promise<unknown>} get
 * @property {(key: string, value: unknown) => Promise<void>} set
 */

/**
 * @typedef {Object} Repos
 * @property {PeopleRepo} people
 * @property {EntryRepo} entries
 * @property {AttachmentRepo} attachments
 * @property {MetaRepo} meta
 */

/**
 * Multi-store write op for a single atomic transaction.
 * @typedef {{ store: string, put: unknown } | { store: string, del: IDBValidKey }} WriteOp
 */

export {};
