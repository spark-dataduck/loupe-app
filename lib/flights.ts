import { CONFIG } from "./config";
import { query, queryOne } from "./md";
import { tableNameFor } from "./slug";

// ── Types shared with the API routes / UI ───────────────────────────────────

export type StepState = "queued" | "running" | "done" | "failed";

export interface StepStatus {
  state: StepState;
  phase: string; // human-readable live phase (last meaningful log line)
  error: string | null; // reason when state === "failed"
  progress: number | null; // 0..1 when the logs expose a fraction, else null
  detail: string | null; // e.g. "12 / 40" to sit beside the bar
}

export interface PipelineStatus {
  step1: StepStatus; // document-parse
  step2: StepStatus; // document-embed-index
  done: boolean;
  shareRefreshed: boolean;
}

export interface TriggerResult {
  parseRun: number;
  baselineEmbedRun: number;
  slugs: string[];
}

// ── URL safety ───────────────────────────────────────────────────────────────
// URLs are inlined into a SQL MAP literal, so allow only http(s) URLs with no
// quote/whitespace. This makes inlining injection-safe.
const URL_RE = /^https?:\/\/[^\s'"`;\\]+$/i;

export function isSafeUrl(u: string): boolean {
  return URL_RE.test(u);
}

// ── Status mapping ────────────────────────────────────────────────────────────

function mapState(runStatus: string | null): StepState {
  switch (runStatus) {
    case "RUN_STATUS_PENDING":
      return "queued";
    case "RUN_STATUS_RUNNING":
      return "running";
    case "RUN_STATUS_SUCCEEDED":
      return "done";
    case "RUN_STATUS_FAILED":
    case "RUN_STATUS_CANCELLED":
      return "failed";
    default:
      return "queued";
  }
}

async function getRunStatus(
  flightId: string,
  runNumber: number
): Promise<string | null> {
  const row = await queryOne<{ status: string }>(
    `SELECT status FROM MD_LIST_FLIGHT_RUNS(flight_id := '${flightId}') WHERE run_number = ${runNumber} LIMIT 1`
  );
  return row?.status ?? null;
}

async function getLogTail(flightId: string, runNumber: number): Promise<string[]> {
  try {
    const row = await queryOne<{ logs: string }>(
      `SELECT logs FROM MD_GET_FLIGHT_LOGS(flight_id := '${flightId}', run_number := ${runNumber})`
    );
    if (!row?.logs) return [];
    // Flight logs delimit lines with either real newlines or literal "\n" escapes.
    return row.logs
      .split(/\\n|\r?\n/)
      .map((l) => l.trimEnd());
  } catch {
    // MD_GET_FLIGHT_LOGS may be unavailable or the run may have no logs yet.
    return [];
  }
}

function lastMeaningfulLine(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l) return l.length > 160 ? l.slice(0, 157) + "…" : l;
  }
  return "";
}

// Pull a "current / total" fraction out of a log line. Matches the common
// shapes the parse/embed flights emit — "page 12 of 40", "12/40", "batch 3/10".
// Tune the leading keyword list if your logs word it differently.
const FRACTION_RE = /(?:page|batch|chunk|doc(?:ument)?|row|step)?\s*(\d{1,7})\s*(?:\/|of)\s*(\d{1,7})/gi;

/** Read progress from the most recent log line that carries a fraction.
 *  Using the latest line (not a global max) keeps the number honest when the
 *  log mixes different counters. Returns null when nothing parses. */
function parseProgress(lines: string[]): { progress: number | null; detail: string | null } {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    let m: RegExpExecArray | null;
    let last: { cur: number; total: number } | null = null;
    FRACTION_RE.lastIndex = 0;
    while ((m = FRACTION_RE.exec(l))) {
      const cur = Number(m[1]);
      const total = Number(m[2]);
      if (total > 0 && cur <= total) last = { cur, total }; // last match on the line
    }
    if (last) return { progress: Math.min(1, last.cur / last.total), detail: `${last.cur} / ${last.total}` };
  }
  return { progress: null, detail: null };
}

function extractFailureReason(lines: string[]): string {
  const markers = /FAILED|Error|Traceback|Exception|SystemExit|Killed|OOM/i;
  const hits = lines.map((l) => l.trim()).filter((l) => l && markers.test(l));
  const pick = hits.length ? hits.slice(-4) : lines.filter((l) => l.trim()).slice(-4);
  const joined = pick.join(" · ");
  return joined.length > 400 ? joined.slice(0, 397) + "…" : joined || "Run failed (no log detail).";
}

async function stepStatus(flightId: string, runNumber: number): Promise<StepStatus> {
  const runStatus = await getRunStatus(flightId, runNumber);
  const state = mapState(runStatus);
  const lines = await getLogTail(flightId, runNumber);
  if (state === "failed") {
    return { state, phase: "Failed", error: extractFailureReason(lines), progress: null, detail: null };
  }
  if (state === "done") {
    return { state, phase: "Complete", error: null, progress: 1, detail: null };
  }
  const phase = lastMeaningfulLine(lines) || (state === "queued" ? "Queued…" : "Working…");
  // Progress is only meaningful while running; queued runs have no logs yet.
  const { progress, detail } = state === "running" ? parseProgress(lines) : { progress: null, detail: null };
  return { state, phase, error: null, progress, detail };
}

// ── Public operations ─────────────────────────────────────────────────────────

/** Trigger document-parse for the given PDF URLs. Records the embed-index run
 *  baseline first so we can later find the run this parse spawns. */
export async function triggerParse(urls: string[]): Promise<TriggerResult> {
  if (!urls.length) throw new Error("No URLs provided.");
  if (urls.length > 12) throw new Error("At most 12 documents per run.");
  for (const u of urls) {
    if (!isSafeUrl(u)) throw new Error(`Unsafe or invalid URL: ${u}`);
  }

  const baselineRow = await queryOne<{ m: number }>(
    `SELECT coalesce(max(run_number), 0) AS m FROM MD_LIST_FLIGHT_RUNS(flight_id := '${CONFIG.embedIndexFlightId}')`
  );
  const baselineEmbedRun = baselineRow?.m ?? 0;

  // MD_RUN_FLIGHT MERGES this config over the flight's stored default config,
  // so any url slot we DON'T set keeps whatever the flight was saved with. The
  // parse flight has a stray default (url10 → a sample PDF), which otherwise
  // gets parsed on every run alongside the user's document. Set all 12 slots
  // explicitly — provided URLs first, empty for the rest — so no leftover
  // default can sneak into the run. Empty values are ignored by the flight.
  const MAX_SLOTS = 12;
  const entries = Array.from(
    { length: MAX_SLOTS },
    (_, i) => `'url${i + 1}': '${urls[i] ?? ""}'`
  ).join(", ");
  const runRow = await queryOne<{ run_number: number }>(
    `SELECT run_number FROM MD_RUN_FLIGHT(flight_id := '${CONFIG.parseFlightId}', config := MAP {${entries}})`
  );
  if (!runRow) throw new Error("MD_RUN_FLIGHT returned no run.");

  return {
    parseRun: runRow.run_number,
    baselineEmbedRun,
    slugs: urls.map(tableNameFor),
  };
}

/** First embed-index run created after the baseline (the one the parse spawned),
 *  or null if it hasn't started yet. */
export async function findSpawnedEmbedRun(baseline: number): Promise<number | null> {
  const row = await queryOne<{ r: number | null }>(
    `SELECT min(run_number) AS r FROM MD_LIST_FLIGHT_RUNS(flight_id := '${CONFIG.embedIndexFlightId}') WHERE run_number > ${baseline}`
  );
  return row?.r ?? null;
}

/** Refresh the org share so the embedded Dive sees newly-loaded tables. */
export async function refreshShare(): Promise<void> {
  await query(`UPDATE SHARE ${CONFIG.db}`);
}

/** Compose the two-step pipeline status. Refreshes the share once step 2 completes. */
export async function pipelineStatus(
  parseRun: number,
  baselineEmbedRun: number
): Promise<PipelineStatus> {
  const step1 = await stepStatus(CONFIG.parseFlightId, parseRun);

  // The parse flight spawns the embed-index run as soon as it has loaded tables,
  // so embedding often runs WHILE parsing is still going. Always look for that
  // spawned run rather than assuming step 2 waits for parse to finish — otherwise
  // step 2 shows a misleading "waiting" state while it's actually running.
  let step2: StepStatus = { state: "queued", phase: "Not started yet", error: null, progress: null, detail: null };
  let shareRefreshed = false;

  const embedRun = await findSpawnedEmbedRun(baselineEmbedRun);
  if (embedRun != null) {
    step2 = await stepStatus(CONFIG.embedIndexFlightId, embedRun);
  } else if (step1.state === "failed") {
    // Parse failed before loading anything → no embed run will spawn.
    step2 = { state: "failed", phase: "Skipped", error: "Parsing failed; nothing to index.", progress: null, detail: null };
  }

  const done = step2.state === "done";
  if (done) {
    try {
      await refreshShare();
      shareRefreshed = true;
    } catch {
      shareRefreshed = false; // non-fatal; Dive may lag ~1 min or need a reload
    }
  }

  return { step1, step2, done, shareRefreshed };
}
