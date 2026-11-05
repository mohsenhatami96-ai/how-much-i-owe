# How Much I Owe Clean Architecture Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor How Much I Owe in place into ports & adapters (ES modules, no bundler) with identical behavior, zero data loss, domain unit tests, then push and deploy to GitHub Pages.

**Architecture:** Pure `domain/` (no DOM/IndexedDB), `domain/ports.js` contracts, `storage/indexeddb.js` adapter keeping DB `how-much-i-owe` v1 and stores `people`/`entries`/`images`/`meta`, `ui/` for DOM, thin `app.js` composition root. Vertical slices; app works after every commit.

**Tech Stack:** Vanilla ES modules, IndexedDB, Node built-in `node:test`, existing Playwright e2e at `/workspace/owe-test/test.js`, service worker offline shell. Optional test-only `fake-indexeddb`.

## Global Constraints

- No bundler, no TypeScript, no framework, no schema/`DB_VERSION` bump, no feature/visual changes.
- Preserve DB name `how-much-i-owe`, version `1`, keyPaths/indexes, meta key strings, backup `format: 2` (import format 1).
- Entry types in code: `borrow` and `repay` (not lend).
- E2E harness: `/workspace/owe-test/test.js` (not `tools/e2e-test.js`).
- Bump app/SW to `v1.3.0` when module cache list is complete.
- Do not ask Mohsen technical questions; decide and proceed. Push/deploy only after verification.
- Phone-sized (~390px) check before deploy. Never lose user data.

## File map

| Path | Responsibility |
|------|----------------|
| `index.html` | Load CSS + `<script type="module" src="app.js">` |
| `app.js` | Wire repos, boot UI, register SW |
| `domain/money.js` | `parseAmount`, `fmtMoney` |
| `domain/balances.js` | `balanceOf`, `sortedBalances`, `runningBalances`, `balanceClass` |
| `domain/people.js` | person create/validate, `avatarColor`, `initials` |
| `domain/entries.js` | entry create/validate (`borrow`/`repay`) |
| `domain/attachments.js` | pure attachment helpers |
| `domain/backup.js` | export/import payload pure logic |
| `domain/ports.js` | JSDoc repo contracts |
| `storage/indexeddb.js` | `openDB`, `getAll`, `getOne`, `writeOps`, repo impls |
| `ui/*` | DOM screens/helpers |
| `service-worker.js` | Cache all modules; VERSION `v1.3.0` |
| `tests/domain/*.test.js` | unit tests via `node --test` |
| `/workspace/owe-test/test.js` | e2e |

---

### Task 1: ES module shell

**Files:**
- Modify: `index.html`, `app.js`, `service-worker.js`
- Test: smoke — app loads as module

**Interfaces:**
- Produces: `app.js` is an ES module entry; SW still caches shell

- [ ] **Step 1:** Change script tag to `<script type="module" src="app.js"></script>`; ensure no reliance on global script order beyond module.
- [ ] **Step 2:** Add `export {}` or convert top-level to module-safe (no accidental globals required by HTML).
- [ ] **Step 3:** Keep SW SHELL list including `./app.js`; bump VERSION only when new files exist (Task 8) unless required for cache bust — prefer bump at Task 8.
- [ ] **Step 4:** Run e2e `/workspace/owe-test/test.js` (or documented command in owe-test README). Expected: pass.
- [ ] **Step 5:** Commit `refactor: load app.js as ES module`

---

### Task 2: Money domain (TDD)

**Files:**
- Create: `domain/money.js`, `tests/domain/money.test.js`
- Modify: `app.js` to import from `domain/money.js` and remove local copies

**Interfaces:**
- Produces: `parseAmount(str) -> number|null` (cents), `fmtMoney(cents, currency, {sign}) -> string` — match current `app.js` behavior exactly

- [ ] **Step 1:** Write failing tests for parseAmount (commas, decimals, negatives, empty, invalid) and fmtMoney (SEK/EUR/IRR, sign).
- [ ] **Step 2:** `node --test tests/domain/money.test.js` → FAIL
- [ ] **Step 3:** Extract implementation from `app.js` into `domain/money.js`; export functions; import in `app.js`
- [ ] **Step 4:** Tests PASS; e2e PASS
- [ ] **Step 5:** Commit `refactor: extract domain/money`

---

### Task 3: Balances domain (TDD)

**Files:**
- Create: `domain/balances.js`, `tests/domain/balances.test.js`
- Modify: `app.js`

**Interfaces:**
- Consumes: none from money required for balanceOf
- Produces: `balanceOf(entries)`, `sortedBalances(map, defaultCur)`, `runningBalances(...)` if present, `balanceClass(cents)`

- [ ] **Step 1–5:** Same TDD cycle; commit `refactor: extract domain/balances`

---

### Task 4: Ports + IndexedDB adapter

**Files:**
- Create: `domain/ports.js`, `storage/indexeddb.js`, `tests/storage/indexeddb.test.js`
- Modify: `app.js` to use repos; remove inline openDB/getAll/writeOps
- DevDep: `fake-indexeddb` for Node tests only

**Interfaces:**
- Produces: `openDB()`, PeopleRepo/EntryRepo/AttachmentRepo/MetaRepo with same store semantics
- Constraint: `onupgradeneeded` copied verbatim; single-tx `writeOps`

- [ ] **Step 1:** Write storage smoke tests with fake-indexeddb (put/get/delete people+entries)
- [ ] **Step 2:** FAIL then implement adapter
- [ ] **Step 3:** Wire app through ports; e2e PASS
- [ ] **Step 4:** Commit `refactor: IndexedDB storage adapter behind ports`

---

### Task 5: People & entries domain + UI split

**Files:**
- Create: `domain/people.js`, `domain/entries.js`, `ui/dom.js`, `ui/home.js`, `ui/person.js`, `ui/sheets.js`, tests
- Modify: `app.js`

- [ ] Extract pure rules with tests; move DOM screens to ui/; app imports and boots
- [ ] e2e PASS; commit `refactor: people/entries domain and UI modules`

---

### Task 6: Attachments

**Files:**
- Create: `domain/attachments.js`, `ui/images.js`, `ui/entry.js`, `ui/viewer.js`, tests for pure helpers

- [ ] Keep compression behavior identical; e2e with attachment; commit `refactor: attachments domain and UI`

---

### Task 7: Backup & settings

**Files:**
- Create: `domain/backup.js`, `ui/settings.js`, `tests/domain/backup.test.js`

- [ ] Round-trip export/import format 2 and format 1; commit `refactor: backup/settings modules`

---

### Task 8: Composition root, SW v1.3.0, verify, deploy

**Files:**
- Modify: `app.js` (wiring only), `ui/router.js`, `service-worker.js` (all modules in SHELL, VERSION `v1.3.0`), bump `APP_VERSION` to `1.3.0`

- [ ] Unit + e2e green; ~390px sanity
- [ ] Commit `release: v1.3.0 clean architecture modules`
- [ ] Push `main` to `github.com/mohsenhatami96-ai/how-much-i-owe`
- [ ] Verify live https://mohsenhatami96-ai.github.io/how-much-i-owe/ and offline; screenshot for Mohsen
- [ ] Then start Spending Tracker same pattern (separate plan/commits)

## Spec coverage

Goals, non-goals, layout, data safety, 8 slices, testing, SW, deploy, Spending Tracker follow-on — all mapped to tasks above.
