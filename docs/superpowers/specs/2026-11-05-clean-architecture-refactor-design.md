# How Much I Owe — Clean Architecture Refactor (Design Spec)

Date: 2026-11-05 · Status: Approved (Mohsen) · Baseline: `9c53e3c` (v1.2.0)

## 1. Goals
- Refactor `app.js` (~1213 lines) **in place** into ports & adapters: pure `domain/`, `storage/` IndexedDB adapter, `ui/` views, thin `app.js` composition root.
- Native ES modules, **no bundler, no build step**; deploy stays static on GitHub Pages.
- Identical user-visible behavior and **zero data loss**.
- Domain logic covered by fast unit tests (Node built-in `node:test`, no new dependencies).

## 2. Non-goals
- No greenfield rewrite, no framework, no TypeScript, no bundler.
- No IndexedDB schema change, no `DB_VERSION` bump, no data migration.
- No new features or visual changes; no change to backup file format (stays `format: 2`, still imports format 1).

## 3. Target layout
```
index.html               <script type="module" src="app.js">
app.js                   composition root: openDB → build repos → boot UI → register SW
domain/
  money.js               parseAmount, fmtMoney
  balances.js            balanceOf, sortedBalances, runningBalances, balanceClass
  people.js              person creation/validation, avatarColor
  entries.js             entry creation/validation (borrow/lend/repay types)
  attachments.js         attachment rules, fmtBytes, fileBadge (pure parts)
  backup.js              buildExport/parse import payload (pure; base64 helpers)
  ports.js               JSDoc contracts: PeopleRepo, EntryRepo, AttachmentRepo, MetaRepo, BackupStore
storage/
  indexeddb.js           openDB, getAll/getOne/writeOps; implements the ports
ui/
  dom.js                 toast, sheet open/close, shared helpers
  router.js              route, onHashNav, goBack, render dispatch
  home.js  person.js  entry.js  viewer.js  settings.js  sheets.js
  images.js              canvas/WebP/JPEG compression (browser-only adapter)
service-worker.js
tests/domain/*.test.js
tools/e2e-test.js        existing end-to-end check, kept
```
Dependency rule: `domain/` imports nothing outside `domain/`; `ui/` calls domain and ports, **never** `indexedDB` directly; only `storage/` touches IndexedDB; only `app.js` wires concrete adapters.

## 4. Data safety (must not change)
Read from current `app.js`:
- Database: `how-much-i-owe`, version `1`.
- Stores: `people` (keyPath `id`); `entries` (keyPath `id`, index `personId`); `images` (keyPath `id`, indexes `personId`, `entryId`); `meta` (keyPath `key`).
- Meta keys keep their exact strings (e.g. `lastCurrency:<personId>`, settings such as photo quality).
- `onupgradeneeded` code is moved verbatim into `storage/indexeddb.js`.
- Multi-store writes keep using a single transaction (`writeOps`) so deletes/imports stay atomic.
- Safety net: before deploying, export a backup from the live app on the existing version, then verify it imports on the refactored build and counts match.

## 5. Vertical slice order
Each slice: extract → unit tests → e2e pass → commit. App works after every commit.
1. Module shell: `index.html` uses `type="module"`; `app.js` becomes module (no behavior change).
2. Money: `domain/money.js` + tests.
3. Balances: `domain/balances.js` + tests.
4. Storage adapter: `storage/indexeddb.js` + `domain/ports.js`; UI goes through repos.
5. People & entries: domain rules + `ui/home.js`, `ui/person.js`, `ui/sheets.js`.
6. Attachments: `domain/attachments.js`, `ui/images.js`, `ui/entry.js`, `ui/viewer.js`.
7. Backup & settings: `domain/backup.js` (round-trip tests) + `ui/settings.js`.
8. Composition root: `app.js` reduced to wiring + boot; router to `ui/router.js`.

## 6. Testing strategy
- Unit (`node --test tests/`): parseAmount edge cases (commas, decimals, negatives, invalid), fmtMoney per currency/sign, balances per currency and running totals, backup export→import round-trip incl. format 1 compatibility.
- Storage smoke: open DB, put/get/delete per store against a fake IndexedDB in tests (dev-only `fake-indexeddb`) or in the browser e2e.
- E2E: `tools/e2e-test.js` happy path (add person, entry, attachment, balance, export/import) run after every slice.
- Bugfixes during refactor start with a failing test.

## 7. Service worker module caching
- Add every new module file to `SHELL` in `service-worker.js` (all `domain/`, `storage/`, `ui/` files); a missing file would break offline start.
- Bump `VERSION` to `v1.3.0` so `owe-shell-v1.2.0` is deleted on activate and clients reload via the existing `controllerchange` handler.
- Test offline: load once, go offline, hard reload, app must start.

## 8. Deploy
1. All unit + e2e tests pass; manual check on desktop and iPhone-size viewport.
2. Backup from live v1.2.0 imports cleanly on the new build.
3. Commit, push `main` to `github.com/mohsenhatami96-ai/how-much-i-owe`.
4. GitHub Pages publishes; verify https://mohsenhatami96-ai.github.io/how-much-i-owe/ loads, shows existing data, works offline.
5. Rollback: revert to `9c53e3c` and push; data is untouched since schema is unchanged.

## 9. Next: Spending Tracker
Same pattern (domain/ + ports, storage adapter, ui/, composition root, ES modules, no bundler) applied afterwards. Its storage adapter wraps localStorage with the existing `LS_KEY` unchanged, so no data migration.
