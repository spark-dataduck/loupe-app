# Loupe Ingest App — Design

- **Date:** 2026-07-17
- **Status:** Approved (design); pending spec review
- **Project home:** `personal_projects/playground/loupe-app/` (own git repo, deploys to Vercel)
- **Related:** the `document-loupe` Dive (`dives-reference/dives/document-loupe/`) and the two-flight pipeline (`personal_projects/playground/pdf-parsing-analysis/`)

## 1. Goal

A Vercel-hosted web app — the front door to the **Loupe** hybrid-search Dive. A user adds a PDF (paste a URL or upload a local file), the app parses + indexes it into MotherDuck through the existing two flights while showing two honest step-progress bars, and on success drops the user into the embedded, interactive Loupe Dive scoped to the document they just added. Failures surface with a readable reason.

This is a general demo (built for the Foundation Capital use case but not branded to it): show "PDF in → searchable in minutes → explore it here," end to end, in one link.

## 2. Users & context

- **Audience:** demo viewers (screen-share and self-serve). No app-level login.
- **Org:** everything runs in the MotherDuck **demo org** (`spark_demo`), Business plan (confirmed — required for Dive embedding).
- **Existing assets reused unchanged:**
  - Flight `document-parse` — `c72f3404-a5b3-49e1-b8dc-36ef4e3c3ca4` (parse + chunk; async-triggers Flight 2).
  - Flight `document-embed-index` — `ef18ded7-b3d3-4084-a708-0e92c946715c` (embed + BM25).
  - Dive `document-loupe` — `8e4a1ad4-6087-43c0-8b82-d5acbf58b3cf` (hybrid search UI).
  - Database `document_search` — one `chunks_<file>` table per document.

## 3. Architecture

**One Next.js app** (App Router, TypeScript) on Vercel. There is no separate backend service: the browser does everything except four thin server-side route handlers whose only job is to keep secrets (read-write MotherDuck token, admin token, Blob token) out of the client. Those four functions deploy in the same push as the frontend.

```
Browser (React)                         Server (Next.js route handlers)         MotherDuck / Unstructured / Blob
──────────────                          ───────────────────────────────         ────────────────────────────────
Ingest screen  ── upload ─────────────▶ /api/blob/upload (mint token) ─────────▶ Vercel Blob (direct browser→Blob)
               ── start ──────────────▶ /api/pipeline/start ───────────────────▶ MD_RUN_FLIGHT(document-parse)
Progress screen ─ poll (2–4s) ────────▶ /api/pipeline/status ──────────────────▶ MD_LIST_FLIGHT_RUNS + LOGS,
                                                                                  UPDATE SHARE on completion
Explore screen ── session ────────────▶ /api/dive/embed-session ───────────────▶ POST api.motherduck.com/.../embed-session
               ── iframe ──────────────────────────────────────────────────────▶ embed-motherduck.com/sandbox
```

### Why the thin server layer is mandatory

Triggering a flight (`MD_RUN_FLIGHT`) is a write/compute operation that needs a **read-write** MotherDuck token; MotherDuck has no read-only or flight-scoped token variant. A read-write token shipped to a public browser bundle could be extracted and used to spam flight runs (real Unstructured + MD cost) or overwrite `document_search`. DuckDB-WASM-in-the-browser was considered and rejected for exactly this reason. By contrast the **embedded Dive** is safe client-side: its session carries a read-only, 24-hour, scoped token minted server-side — which is also why that same session token *cannot* trigger flights.

## 4. Screens

### 4.1 Ingest (landing)
- Loupe brand/aesthetic (reuse the Dive's warm-paper palette + type stack for a cohesive front door).
- Input: paste one or more PDF URLs **and/or** drag-drop / pick local PDF file(s).
- Primary action: **Parse & index →**.
- Secondary link: **explore existing documents →** (skip ingest, open the embedded Dive over the current corpus, no doc pre-selected).
- Client-side validation: file type is PDF; pasted strings are http(s) URLs.

### 4.2 Progress
- Two step cards:
  - **Step 1 — Parse & chunk** (`document-parse`)
  - **Step 2 — Embed & index** (`document-embed-index`)
- Each card shows: state (queued / running / done / failed), a **phase line parsed from `MD_GET_FLIGHT_LOGS`** (e.g. "waiting on 1 job", "loaded 464 chunks"), an indeterminate striped bar while running, a check on completion, and an elapsed timer.
- Flights emit no numeric %, so progress is phase-text + status — honest, not a fake percentage.
- On failure: red card + the reason (log tail / `SystemExit` message) + **Try again** (returns to Ingest).
- No hard client timeout: parse is ~15 min/doc, so poll with backoff and keep showing elapsed time.

### 4.3 Explore
- Full-bleed iframe of the Dive: `https://embed-motherduck.com/sandbox/#session=<session>`, `sandbox="allow-scripts allow-same-origin"`.
- Session is generated with `initial_state.doc = "chunks_<slug>"` so the Dive opens pre-focused on the just-added document. (Corpus remains browsable via the Dive's own dropdown.)
- A `message` listener handles the Dive's `navigation-request` events (its "Open at page N" PDF links): validate origin + URL, then open in a new tab.
- Header: Loupe brand + **Search another document** → back to Ingest.

## 5. API functions (contracts)

All under `app/api/`, Node runtime.

| Route | Method | Input | Output | Secrets used |
|---|---|---|---|---|
| `/api/blob/upload` | POST | `@vercel/blob` `handleUpload` handshake; enforces `application/pdf` | public Blob URL | `BLOB_READ_WRITE_TOKEN` |
| `/api/pipeline/start` | POST | `{ urls: string[] }` | `{ parseRun, baselineEmbedRun, slugs }` | `MOTHERDUCK_TOKEN` |
| `/api/pipeline/status` | GET | `parseRun`, `baselineEmbedRun` | `{ step1:{status,phase,error?}, step2:{status,phase,error?}, done, shareRefreshed }` | `MOTHERDUCK_TOKEN` |
| `/api/dive/embed-session` | POST | `{ doc?: slug }` | `{ session }` | `MD_EMBED_ADMIN_TOKEN`, `MD_EMBED_SERVICE_ACCOUNT` |

- **start**: records `baselineEmbedRun = max(run_number)` of `document-embed-index`, then `MD_RUN_FLIGHT(document-parse, config := MAP{'url1':…, …})`. Maps provided URLs to `url1…urlN` (pre-declared slots, ≤12). Returns the parse `run_number` + baseline + computed table slugs.
- **status**: reads `document-parse` run `parseRun`; when it succeeds, finds the first `document-embed-index` run with `run_number > baselineEmbedRun` (the one Flight 1 spawned) and reads it; parses log tails into phase text. On step 2 success, runs `UPDATE SHARE document_search` once, then reports `done: true, shareRefreshed: true`.
- **embed-session**: `POST https://api.motherduck.com/v1/dives/<LOUPE_DIVE_ID>/embed-session` with `{ username: <service account>, initial_state: { doc } }`. **No `version`** → always latest.

Flights are triggered/polled via **`@duckdb/node-api`** connecting to `md:?motherduck_token=…`, with `home_directory`/`extension_directory` set to `/tmp` so the MotherDuck extension loads inside the read-only Lambda filesystem.

## 6. Data hosting & the "Open at page N" deep link

The URL a PDF is uploaded to **is** the URL stored as `source_url`, so one URL serves both parsing and deep-linking:

1. Browser uploads the local PDF straight to **Vercel Blob** → stable public URL (`content-type: application/pdf`, served inline).
2. That URL is passed to Flight 1 as `url1`, landing in `chunks_*.source_url`.
3. In the Dive, "Open at page 33" links to `…/file.pdf#page=33`; the parent opens it in a new tab → the browser's native PDF viewer jumps to page 33.

Vercel Blob is chosen over Google Drive specifically because Drive's preview viewer ignores `#page=N`, whereas Blob serves the raw PDF inline so the fragment works. Pasted public URLs (e.g. the existing R2 SEC filings) behave identically.

## 7. Share of `document_search` + Dive wiring

The embedded Dive runs as a service account that does not own `document_search`, so it reads the data through an **org-scoped share**.

- **Create** (one-time, CLI + DEMO token): `CREATE SHARE document_search FROM document_search (ACCESS ORGANIZATION, UPDATE MANUAL);` → yields `md:_share/document_search/<token>`.
- **Wire into the Dive** (primary, as requested): update the Dive's `REQUIRED_DATABASES` to
  ```ts
  export const REQUIRED_DATABASES = [
    { type: "share", path: "md:_share/document_search/<token>", alias: "document_search" },
  ];
  ```
  Alias stays `document_search`, so no Dive SQL changes. This mirrors what MotherDuck's `share_dive_data` does (done here via CLI because that MCP tool targets a different org).
- **Refresh after every run:** the share is a point-in-time snapshot (`UPDATE MANUAL`). Each pipeline run adds a new `chunks_*` table and Flight 2 adds the `chunk_embedding` column, so `/api/pipeline/status` runs `UPDATE SHARE document_search` when step 2 succeeds, before the embed session is created. (`UPDATE AUTOMATIC` was rejected: its up-to-5-min propagation can land exactly when the user reaches Explore.)

### Owner-view safety check + fallback
Pointing `REQUIRED_DATABASES` at a share *of a database the viewer owns* can hit MotherDuck's share-alias conflict when the **owner** opens the Dive standalone at app.motherduck.com. After making the change, verify the standalone view still loads. If it breaks, use the non-destructive fallback with identical embed behavior: leave the Dive source on `{ type: "database", path: "document_search", alias: "document_search" }` and pass `required_resources: [{ url: shareUrl, alias: "document_search" }]` in the embed-session instead. Either way the embedded app reads the share and works.

## 8. Environment variables (server-only)

| Var | Purpose | Set by |
|---|---|---|
| `MOTHERDUCK_TOKEN` | Demo-org read-write; flight trigger/poll + `UPDATE SHARE` | me (`.env.local`), Vercel |
| `MD_EMBED_ADMIN_TOKEN` | Service-account admin token; mint embed sessions | **user, later** (Vercel env) |
| `MD_EMBED_SERVICE_ACCOUNT` | Service-account username the embedded Dive runs as | user / me |
| `LOUPE_DIVE_ID` | `8e4a1ad4-6087-43c0-8b82-d5acbf58b3cf` | me |
| `PARSE_FLIGHT_ID` | `c72f3404-a5b3-49e1-b8dc-36ef4e3c3ca4` | me |
| `EMBED_INDEX_FLIGHT_ID` | `ef18ded7-b3d3-4084-a708-0e92c946715c` | me |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob | Vercel (auto) |

A committed `.env.example` documents every key with placeholder values. No version var (always latest).

## 9. Error handling

- Ingest: reject non-PDF and non-http(s) URLs client-side.
- Blob / start / embed-session failures: surface the mapped message inline.
- Flight FAILED (either step): red card + reason from the log tail; **Try again**.
- Multi-doc partial failure (some files fail, others load + Flight 2 still spawned): warn with the failed file(s) but continue to step 2 and Explore. Single-doc is the primary path.
- Embed errors (not Business plan, bad token, share-alias conflict): map MotherDuck's documented embed errors to guidance on the Explore screen.
- 24-hour session expiry: regenerate on each Explore load; if the iframe reports expiry, offer reload.

## 10. Repo layout

```
loupe-app/
├── docs/superpowers/specs/2026-07-17-loupe-ingest-app-design.md
├── .env.example
├── app/
│   ├── page.tsx                 (Ingest)
│   ├── progress/…               (Progress)
│   ├── explore/…                (Explore)
│   └── api/
│       ├── blob/upload/route.ts
│       ├── pipeline/start/route.ts
│       ├── pipeline/status/route.ts
│       └── dive/embed-session/route.ts
├── lib/
│   ├── md.ts                    (@duckdb/node-api connect helper, /tmp extension dir)
│   ├── flights.ts               (trigger/poll/log-phase parsing, UPDATE SHARE)
│   └── slug.ts                  (table_name_for parity: file → chunks_<slug>)
└── (Next.js scaffolding)
```

## 11. Testing

- Local: `vercel dev` with `.env.local` (faithful emulation of Blob + functions).
- **Validate the main risk first:** `@duckdb/node-api` + MotherDuck extension inside a Vercel Node Lambda. A throwaway `/api/health` running `SELECT 1` over `md:` on a **preview deploy** confirms it before building further. If it fails, fall back to the polyglot option (Python `/api` for flights) — captured as the contingency.
- `lib/slug.ts` matches `table_name_for` exactly (unit-tested against known cases, e.g. `msft-10k-june-25.pdf → chunks_msft_10k_june_25`).
- Endpoint checks against the demo org: `status` against an already-completed run; `embed-session` against the live Dive; a real end-to-end `start` on one small PDF.
- Playwright drives the happy path and the failure UI (point `status` at a known FAILED run to exercise the red-card path).

## 12. One-time setup (prerequisites)

1. Confirm demo org Business plan (done).
2. Create a dedicated, **empty** service account (Admin role) → read-write admin token + username. (Empty so the share alias `document_search` doesn't collide.)
3. `CREATE SHARE document_search …` and capture the share URL.
4. Update the Dive's `REQUIRED_DATABASES` to the share; verify standalone view (fallback per §7).
5. Set env vars (user adds `MD_EMBED_ADMIN_TOKEN` in Vercel later).

## 13. Out of scope (YAGNI)

App-level auth; robust multi-user run isolation beyond the baseline-run heuristic; per-file progress UI; embed export handling; persisting dive-state to a backend; Blob TTL/cleanup (note as future); SharePoint/OneDrive sources (prod concern, not demo).

## 14. Open risks

- **DuckDB-node + MD extension on Vercel Lambda** — the one real unknown; validated first (§11), polyglot fallback ready.
- **Owner standalone-view conflict** from the share in `REQUIRED_DATABASES` — verified during setup, `required_resources` fallback ready (§7).
- **Baseline-run heuristic** for correlating the spawned Flight 2 run — safe for the single-user demo cadence; would need per-run tagging for true concurrency (out of scope).
