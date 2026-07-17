# Loupe — ingest app

The front door to the **Loupe** hybrid-search Dive. Add a PDF (paste a URL or upload a
file), watch it parse + index into MotherDuck as two live step-progress bars, then land in
the embedded, interactive Dive scoped to the document you just added. Failures show a reason.

- **Stack:** Next.js 15 (App Router, TS) on Vercel. One app; four thin server routes hold
  the secrets. Uploads go straight to Vercel Blob. Flights are triggered/polled via
  `@duckdb/node-api` over `md:`; the Dive is embedded via MotherDuck's embed-session API.
- **Org:** MotherDuck **demo** (`spark_demo`), Business plan.
- **Design + plan:** `docs/superpowers/specs/…` and `docs/superpowers/plans/…`.

## How it works

```
Ingest ──upload──▶ /api/blob/upload ─────────▶ Vercel Blob (browser→Blob direct; URL doubles as source_url)
       ──start───▶ /api/pipeline/start ───────▶ MD_RUN_FLIGHT(document-parse, {url1,…})
Progress ─poll───▶ /api/pipeline/status ──────▶ MD_LIST_FLIGHT_RUNS + MD_GET_FLIGHT_LOGS
                                                 (finds the embed-index run parse spawned;
                                                  runs UPDATE SHARE when step 2 completes)
Explore ─session─▶ /api/dive/embed-session ───▶ POST api.motherduck.com/.../embed-session
        ─iframe──────────────────────────────▶ embed-motherduck.com/sandbox
```

- **No flight changes.** `document-parse` already async-triggers `document-embed-index`.
  The app triggers parse, polls it, then finds the embed-index run it spawned (first run
  number above a baseline captured at trigger time) and polls that. Progress text is the
  live tail of the flight logs (flights emit no numeric %).
- **The upload URL is the `source_url`.** So "Open at page N" in the Dive links to the very
  same Blob URL (`…/file.pdf#page=N`); the browser's PDF viewer honors the page fragment
  (Google Drive's viewer does not — hence Blob).
- **Share, not owned DB.** The Dive and the embed read `document_search` through an
  org-scoped share (`md:_share/document_search/540bd0c4-…`, `UPDATE MANUAL`). The app runs
  `UPDATE SHARE document_search` after each pipeline run so new docs appear.

## Environment

Copy `.env.example` → `.env.local` for local dev, and set the same keys in Vercel.

| Var | Needed for | Status |
|---|---|---|
| `MOTHERDUCK_TOKEN` | trigger/poll flights, `UPDATE SHARE`, **and mint embed sessions** | **set locally** (= `DEMO_MOTHERDUCK_TOKEN`) |
| `MD_EMBED_SERVICE_ACCOUNT` | the account the embed **runs as** (empty service account's username) | **you add** (see setup) |
| `MD_EMBED_ADMIN_TOKEN` | optional — a different admin bearer than `MOTHERDUCK_TOKEN` | leave blank to reuse `MOTHERDUCK_TOKEN` |
| `BLOB_READ_WRITE_TOKEN` | local PDF uploads | auto when you connect a Vercel Blob store |
| `PARSE_FLIGHT_ID`, `EMBED_INDEX_FLIGHT_ID`, `LOUPE_DIVE_ID`, `MD_SHARE_URL` | — | defaulted in `lib/config.ts` |

No `NEXT_PUBLIC_*` — none of these reach the browser. The embed session (a read-only,
24-hour token) is the only credential that ever reaches the client, and it's minted per request.

## One-time setup for the live embed

The app runs today via the **URL-paste** path with `MOTHERDUCK_TOKEN` alone. To light up
local uploads and the embedded Dive:

1. **Service account (embed) — one new thing.** In the demo org (Settings → Service
   accounts) create a **dedicated, empty** account. Set its **username** →
   `MD_EMBED_SERVICE_ACCOUNT`. That's it — the Dive *runs as* this account, and it must be
   empty because the embed attaches the share aliased `document_search`, which conflicts if
   the account owns a DB of that name (this is why your own account can't be the run-as).
   You do **not** need a new token: the session is minted with `MOTHERDUCK_TOKEN` (an
   org-admin token) as the bearer. Only set `MD_EMBED_ADMIN_TOKEN` if you want a *different*
   admin token for minting. (Same shape as the `embedded-dive-test` reference:
   bearer = `MOTHERDUCK_TOKEN`, body = `{ username }`.)
2. **Share** — already created (`md:_share/document_search/540bd0c4-…`, org-scoped,
   discoverable). The service account can read it as an org member.
3. **Vercel Blob** — in the Vercel project, connect a Blob store; Vercel injects
   `BLOB_READ_WRITE_TOKEN`. (For local uploads, put that token in `.env.local` too.)

## Local dev

```bash
npm install
cp .env.example .env.local        # set MOTHERDUCK_TOKEN = DEMO_MOTHERDUCK_TOKEN
npm run dev                        # http://localhost:3000
```

- `npm run typecheck` — tsc, no emit.
- `node --test lib/slug.test.ts` — slug parity unit tests.
- `npm test` — Playwright UI tests (run `npx playwright install chromium` once).

## Deploy (Vercel)

```bash
npm i -g vercel && vercel        # link the project (first run)
# In the Vercel dashboard: add the env vars above, connect a Blob store, then:
vercel --prod
```

`@duckdb/node-api` is declared in `serverExternalPackages` so the native addon isn't
bundled; the MotherDuck extension loads into `/tmp` at runtime (Lambda-safe). If the addon
ever misbehaves on Lambda, the fallback is to move `lib/flights.ts`'s calls to a Python
`/api/*.py` function (the pipeline repo already proves the `duckdb` Python path).

## Verified vs. pending

Validated live against the demo org (2026-07-17):

- ✅ `@duckdb/node-api` → `md:` (SELECT, `MD_LIST_FLIGHT_RUNS`, `MD_GET_FLIGHT_LOGS`).
- ✅ `/api/pipeline/start` triggers a real `document-parse` run.
- ✅ `/api/pipeline/status` — happy path (completed run), failure path (surfaces the real
  log reason), and `UPDATE SHARE` executes.
- ✅ All three screens render (Ingest, live Progress against a real run, Explore fallback).
- ⏳ **Blob upload** and the **live embedded Dive** are code-complete but need
  `BLOB_READ_WRITE_TOKEN` and `MD_EMBED_SERVICE_ACCOUNT` (an empty service account's
  username; the embed bearer reuses `MOTHERDUCK_TOKEN`) — until then the URL-paste path and
  the "Open in MotherDuck" fallback cover the flow.

## Owner-view trade-off (noted)

Because `REQUIRED_DATABASES` in the Dive now points at the org **share**, org members can
open the Dive directly — but the **owner of `document_search`** cannot open it standalone at
app.motherduck.com (attaching a share of a DB you already own under the same alias is a hard
conflict, verified). The owner views the corpus through this app instead. The embed always
pins the share via `required_resources`, independent of the Dive source.
