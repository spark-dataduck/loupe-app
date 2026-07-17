"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, X, ArrowRight, RotateCcw } from "lucide-react";

type StepState = "queued" | "running" | "done" | "failed";
interface StepStatus {
  state: StepState;
  phase: string;
  error: string | null;
  progress: number | null; // 0..1 while running, when the logs expose a fraction
  detail: string | null; // e.g. "12 / 40"
}
interface PipelineStatus {
  step1: StepStatus;
  step2: StepStatus;
  done: boolean;
  shareRefreshed: boolean;
}

const STEP_TITLES = ["Parse & chunk", "Embed & index"];

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// The parser (an external VLM job) only logs "still polling" lines — no page
// counts — so there's no real fraction to show. Estimate one from how long the
// step has been running: an asymptotic curve that always advances but never
// reaches 100% until the pipeline reports "done".
const FAUX_TAU = 45; // seconds; ~63% at 45s, ~86% at 90s, ~95% cap
function fauxProgress(elapsedSec: number): number {
  return Math.min(0.95, 1 - Math.exp(-Math.max(0, elapsedSec) / FAUX_TAU));
}

// Collapse the repetitive VLM job-polling log line into one steady, legible
// phase so the running step doesn't look frozen on a raw URL.
function friendlyPhase(phase: string): string {
  const p = phase.trim();
  if (/HTTP Request|unstructured\.io|\/jobs\/|HTTP\/1\.1\s+200/i.test(p)) {
    return "Extracting pages (visual model)…";
  }
  return p;
}

function StepCard({ n, title, step }: { n: number; title: string; step: StepStatus }) {
  const cls =
    step.state === "done"
      ? "done"
      : step.state === "failed"
        ? "failed"
        : step.state === "running"
          ? "active"
          : "";
  const running = step.state === "running";
  const pct = step.progress != null ? Math.round(step.progress * 100) : null;
  // Label the bar with the raw count when we have it, else a percent, else a
  // plain "working…" until the first countable log line lands.
  const label = step.detail ?? (pct != null ? `${pct}%` : "working…");
  return (
    <div className={`step ${cls}`}>
      <div className="dot" aria-hidden>
        {step.state === "done" ? (
          <Check size={15} />
        ) : step.state === "failed" ? (
          <X size={15} />
        ) : (
          n
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <h3>{title}</h3>
        {step.state === "failed" ? (
          <div className="err">{step.error}</div>
        ) : (
          <div className="phase">{friendlyPhase(step.phase)}</div>
        )}
        {/* A bar appears only on the step actually working, and it fills to real
            progress rather than looping. Queued and finished steps show none. */}
        {running && (
          <div className="prog">
            <div className="track">
              <i style={{ width: `${pct ?? 0}%` }} />
            </div>
            <span className="pct">{label}</span>
          </div>
        )}
      </div>
      <div className="readout" style={{ textTransform: "capitalize", display: "flex", alignItems: "center", gap: 6 }}>
        {running && <span className="live" aria-hidden />}
        {step.state}
      </div>
    </div>
  );
}

function ProgressInner() {
  const router = useRouter();
  const params = useSearchParams();
  const parseRun = params.get("parseRun");
  const baselineEmbedRun = params.get("baselineEmbedRun");
  const doc = params.get("doc") ?? "";

  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  // When each step first started running — anchors the time-based faux bar.
  const stepStart = useRef<{ 1?: number; 2?: number }>({});

  const missing = !parseRun || !baselineEmbedRun;

  useEffect(() => {
    if (!status) return;
    const now = Date.now();
    if (status.step1.state === "running" && stepStart.current[1] == null) stepStart.current[1] = now;
    if (status.step2.state === "running" && stepStart.current[2] == null) stepStart.current[2] = now;
  }, [status]);

  // Give a running step a moving bar: real fraction when the logs expose one,
  // otherwise an elapsed-time estimate. `elapsed` re-renders us each second.
  const withFaux = (step: StepStatus, n: 1 | 2): StepStatus => {
    if (step.state !== "running" || step.progress != null) return step;
    const start = stepStart.current[n];
    const secs = start != null ? (Date.now() - start) / 1000 : 0;
    return { ...step, progress: fauxProgress(secs) };
  };

  useEffect(() => {
    if (missing) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    const clock = setInterval(tick, 1000);

    async function poll() {
      try {
        const res = await fetch(
          `/api/pipeline/status?parseRun=${parseRun}&baselineEmbedRun=${baselineEmbedRun}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Status failed (${res.status}).`);
        if (stop) return;
        setStatus(data);
        const terminal = data.done || data.step2?.state === "failed";
        if (terminal) {
          tick(); // capture the final elapsed, then freeze the clock
          clearInterval(clock);
        } else {
          timer = setTimeout(poll, 3000);
        }
      } catch (e) {
        if (stop) return;
        setFatal(e instanceof Error ? e.message : "Lost connection to the pipeline.");
        timer = setTimeout(poll, 5000); // keep trying through transient errors
      }
    }
    poll();

    return () => {
      stop = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [parseRun, baselineEmbedRun, missing]);

  if (missing) {
    return (
      <main className="wrap" style={{ padding: "clamp(36px, 7vh, 72px) 0 64px" }}>
        <h1 className="display" style={{ fontSize: "clamp(26px, 4.5vw, 36px)" }}>
          Nothing indexing right now
        </h1>
        <p className="lede">
          This screen tracks a document as it&apos;s parsed and indexed. Add one to see it here.
        </p>
        <button className="btn btn-primary" onClick={() => router.push("/")}>
          Add a document <ArrowRight size={16} aria-hidden />
        </button>
      </main>
    );
  }

  const done = status?.done ?? false;
  const failed = status?.step2?.state === "failed" && !done;

  return (
    <main className="wrap" style={{ padding: "clamp(28px, 6vh, 56px) 0 64px" }}>
      <p className="eyebrow">Indexing</p>
      <h1 className="display" style={{ fontSize: "clamp(26px, 4.5vw, 36px)" }}>
        {done ? "Ready to search." : failed ? "That didn't finish." : "Bringing it into focus…"}
      </h1>
      <p className="lede" style={{ marginBottom: 22 }}>
        <span className="readout">elapsed {fmtElapsed(elapsed)}</span>
        {!done && !failed && " · parsing takes about a minute to start, plus a few seconds per page (visual extraction), up to 15,000 pages a month"}
      </p>

      <StepCard
        n={1}
        title={STEP_TITLES[0]}
        step={withFaux(
          status?.step1 ?? { state: "queued", phase: "Contacting the pipeline…", error: null, progress: null, detail: null },
          1
        )}
      />
      <StepCard
        n={2}
        title={STEP_TITLES[1]}
        step={withFaux(
          status?.step2 ?? { state: "queued", phase: "Not started yet", error: null, progress: null, detail: null },
          2
        )}
      />

      {fatal && !done && (
        <div className="notice" style={{ marginTop: 16 }}>
          {fatal} — still retrying.
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 26, alignItems: "center", flexWrap: "wrap" }}>
        {done && (
          <button
            className="btn btn-primary"
            onClick={() => router.push(`/explore${doc ? `?doc=${encodeURIComponent(doc)}` : ""}`)}
          >
            Open in Loupe <ArrowRight size={16} aria-hidden />
          </button>
        )}
        {failed && (
          <button className="btn btn-ghost" onClick={() => router.push("/")}>
            <RotateCcw size={15} aria-hidden /> Try again
          </button>
        )}
      </div>
    </main>
  );
}

export default function ProgressPage() {
  return (
    <Suspense fallback={<main className="wrap" style={{ padding: "64px 0" }}><p className="readout">Loading…</p></main>}>
      <ProgressInner />
    </Suspense>
  );
}
