# Loupe Ingest App — Implementation Plan

> **For agentic workers:** execute task-by-task; steps use `- [ ]` checkboxes. Adapted for autonomous self-execution: verification is real-integration smoke where that's what proves the task (live demo-org flights / Dive), a unit test only for pure logic (slug). Commit after each task.

**Goal:** A Vercel-hosted Next.js app: add a PDF (URL or upload) → parse + index via the two existing flights with two step-progress bars → land in the embedded Loupe Dive scoped to that doc; failures show a reason.

**Architecture:** One Next.js app (App Router, TS). Browser does everything except four thin server routes that hold secrets (RW MotherDuck token, admin token, Blob token): `pipeline/start`, `pipeline/status`, `dive/embed-session`, `blob/upload`. Flights triggered/polled via `@duckdb/node-api` over `md:`; embed session via MD REST; uploads direct browser→Vercel Blob.

**Tech stack:** Next.js 15 (App Router, TypeScript), `@duckdb/node-api`, `@vercel/blob`, `lucide-react`, Playwright (dev). Node 22.

## Global Constraints

- Org: MotherDuck **demo** (`spark_demo`); flight/poll/share use `MOTHERDUCK_TOKEN` = `DEMO_MOTHERDUCK_TOKEN`. Never ship a RW token to the client.
- Flight IDs: parse `c72f3404-a5b3-49e1-b8dc-36ef4e3c3ca4`, embed-index `ef18ded7-b3d3-4084-a708-0e92c946715c`. Dive `8e4a1ad4-6087-43c0-8b82-d5acbf58b3cf`. DB `document_search`.
- Embed session omits `version` → always latest. `initial_state.doc = "chunks_<slug>"`.
- Slug parity: `file.pdf → chunks_<sanitized stem>` exactly matching `table_name_for` (lower, `[^a-z0-9]+`→`_`, strip `_`).
- Times/UTC as source; no secrets in client bundle or git. `.env` gitignored; `.env.example` committed.
- Credential reality tonight: no Blob token, no service-account admin token → those two paths are code-complete but not E2E-tested; everything else tested locally against live flights.

---

### Task 1: One-time infra — share + Dive wiring
**Files:** none in-repo (MotherDuck state); record the share URL into `.env.example` + README.
- [ ] Create org share: `CREATE SHARE IF NOT EXISTS document_search FROM document_search (ACCESS ORGANIZATION, UPDATE MANUAL);` capture `md:_share/document_search/<token>`.
- [ ] Read current Dive content (`MD_GET_DIVE`), replace `REQUIRED_DATABASES` with the `type:"share"` entry (path = share URL, alias `document_search`), `MD_UPDATE_DIVE_CONTENT`.
- [ ] Verify: standalone Dive still resolves for the owner (run the Dive's docsQ over the attached alias as the demo account; if share-alias conflict, revert Dive to owned-db and mark embed to use `required_resources`). Record the decision in README.
- [ ] Verify: a fresh `chunks_*` table appears in the share after `UPDATE SHARE`.

### Task 2: Scaffold Next.js app
**Files:** `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/globals.css`, `.env.example`, `lib/env.ts`.
- [ ] `create-next-app` (TS, App Router, no Tailwind — hand-rolled CSS for brand parity), add deps.
- [ ] `.env.example` with every var from spec §8. `lib/env.ts` reads/validates server env.
- [ ] `app/layout.tsx` + `globals.css`: Loupe brand tokens (paper/ink/glass/reticle palette + serif/mono/sans stacks from the Dive).
- [ ] Verify: `npm run build` succeeds (empty pages ok).
- [ ] Commit.

### Task 3: `lib/slug.ts` (+ unit test)
**Files:** Create `lib/slug.ts`, `lib/slug.test.ts`.
- [ ] Unit test: `tableNameFor("msft-10k-june-25.pdf")==="chunks_msft_10k_june_25"`, url→basename cases, non-pdf.
- [ ] Implement `tableNameFor(nameOrUrl)`; run test → pass. Commit.

### Task 4: `lib/md.ts` (@duckdb/node-api → md:)
**Files:** Create `lib/md.ts`.
- [ ] `getConnection()` connecting to `md:?motherduck_token=…` with `home_directory`/`extension_directory`→`/tmp` (Lambda-safe; harmless locally); `runSQL(sql)` helper returning rows.
- [ ] Verify (THE KEY RISK): a local script runs `SELECT 1` and `FROM duckdb_tables() WHERE database_name='document_search' LIMIT 1` over `md:` with DEMO token → rows. If `@duckdb/node-api` can't do `md:`, fall back to spawning the `duckdb` CLI (present) as contingency; record which. Commit.

### Task 5: `lib/flights.ts`
**Files:** Create `lib/flights.ts`.
- [ ] `triggerParse(urls)`: baseline = max embed-index run_number; `MD_RUN_FLIGHT(parse, config MAP url1..N)`; return `{parseRun, baselineEmbedRun, slugs}`.
- [ ] `runStatus(flightId, runNumber)`: status from `MD_LIST_FLIGHT_RUNS`; `logPhase(flightId, runNumber)`: tail `MD_GET_FLIGHT_LOGS` → last meaningful phase line.
- [ ] `findSpawnedEmbedRun(baseline)`: min embed-index run_number > baseline.
- [ ] `refreshShare()`: `UPDATE SHARE document_search`.
- [ ] Verify against live: read status/logs of an existing completed parse + embed run; `findSpawnedEmbedRun` logic against real run numbers. Commit.

### Task 6: `/api/pipeline/start`
**Files:** Create `app/api/pipeline/start/route.ts`.
- [ ] POST `{urls}` → `triggerParse` → JSON `{parseRun, baselineEmbedRun, slugs}`; validate http(s) URLs; map errors to `{error}` + 4xx/5xx.
- [ ] Verify: `curl` against `next dev` with one small real PDF URL → returns a real run number; confirm run appears RUNNING in MD. Commit.

### Task 7: `/api/pipeline/status`
**Files:** Create `app/api/pipeline/status/route.ts`.
- [ ] GET `parseRun,baselineEmbedRun` → `{step1,step2,done,shareRefreshed}`; on step2 SUCCEEDED call `refreshShare()` once.
- [ ] Verify: against the run triggered in T6 (poll a few times); and against a known-FAILED run → error reason surfaces. Commit.

### Task 8: `/api/blob/upload`
**Files:** Create `app/api/blob/upload/route.ts`.
- [ ] `@vercel/blob` `handleUpload`, enforce `application/pdf`, `addRandomSuffix`.
- [ ] Verify: code-complete; without `BLOB_READ_WRITE_TOKEN` it returns a clear 501/"upload not configured". Documented. Commit.

### Task 9: `/api/dive/embed-session`
**Files:** Create `app/api/dive/embed-session/route.ts`.
- [ ] POST `{doc?}` → fetch MD embed-session with `MD_EMBED_ADMIN_TOKEN`, `{username, initial_state:{doc}}` (no version). If share-alias fallback (T1), include `required_resources`.
- [ ] Verify: without admin token, returns mapped "embed not configured" error the UI can show. Commit.

### Task 10: Ingest screen
**Files:** `app/page.tsx`, `app/ingest.module.css`, small client components.
- [ ] URL input (multi) + drag/drop upload; PDF + http(s) validation; "Parse & index →" calls upload (if files) then `/api/pipeline/start`, routes to `/progress?parse=..&base=..&doc=..`. Secondary "explore existing →" → `/explore`.
- [ ] Verify: renders; validation works; URL-only submit hits start. Commit.

### Task 11: Progress screen
**Files:** `app/progress/page.tsx`, css.
- [ ] Poll `/api/pipeline/status` (2–4s backoff); two step cards (state + phase + striped bar + elapsed); failure red card + reason + Try again; on done → `/explore?doc=..`.
- [ ] Verify: drive against the real run from T6/T7; failure UI against a known-FAILED run. Commit.

### Task 12: Explore screen
**Files:** `app/explore/page.tsx`, css.
- [ ] Fetch `/api/dive/embed-session` (`doc` from query) → iframe `embed-motherduck.com/sandbox/#session=…` sandboxed; `navigation-request` listener opens PDF links in new tab (validated); header + "Search another document". Graceful message if embed not configured.
- [ ] Verify: renders iframe container + shows the "embed not configured" state cleanly without the admin token. Commit.

### Task 13: Local E2E + Playwright
**Files:** `tests/e2e/*.spec.ts`, `playwright.config.ts`.
- [ ] Happy path (URL-paste) against live flights is slow (~15m) — do one real manual run; Playwright covers UI happy path with `/api/pipeline/status` pointed at an already-complete run, plus the failure UI. 
- [ ] Verify: `npx playwright test` green. Commit.

### Task 14: README + finalize
**Files:** `README.md`, `.env.example`.
- [ ] Document setup (service account, share URL, tokens, `vercel dev`/deploy), what's tested vs pending-token, the T1 share/owner-view decision. Commit.

## Self-review notes
- Spec coverage: screens (T10–12), 4 routes (T6–9), flights/share (T1,T5,T7), blob (T8), embed always-latest+initial_state (T9), deep-link via source_url (inherent — Blob URL = source_url), error handling (T6–12), testing incl. duckdb-node risk (T4,T13). Covered.
- Placeholders: share `<token>` filled at T1; env placeholders intentional in `.env.example`.
- Type parity: `{parseRun, baselineEmbedRun, slugs}` consistent T5→T6→T10→T11; `chunks_<slug>` consistent T3→T9→T12.
