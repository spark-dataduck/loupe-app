"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, X, ArrowRight, RotateCcw } from "lucide-react";

type StepState = "queued" | "running" | "done" | "failed";
interface StepStatus {
  state: StepState;
  phase: string;
  error: string | null;
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

function StepCard({ n, title, step }: { n: number; title: string; step: StepStatus }) {
  const cls =
    step.state === "done"
      ? "done"
      : step.state === "failed"
        ? "failed"
        : step.state === "running"
          ? "active"
          : "";
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
          <div className="phase">{step.phase}</div>
        )}
        <div
          className={`track ${
            step.state === "done" ? "full" : step.state === "failed" ? "fail" : "indet"
          }`}
        >
          <i />
        </div>
      </div>
      <div className="readout" style={{ textTransform: "capitalize" }}>
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

  const missing = !parseRun || !baselineEmbedRun;

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
        if (!terminal) timer = setTimeout(poll, 3000);
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
      <main className="wrap" style={{ padding: "64px 0" }}>
        <div className="notice warn">
          Missing run parameters. <button className="link-quiet" onClick={() => router.push("/")}>Start over</button>.
        </div>
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
        {!done && !failed && " · this can take a few minutes for a long PDF"}
      </p>

      {status ? (
        <>
          <StepCard n={1} title={STEP_TITLES[0]} step={status.step1} />
          <StepCard n={2} title={STEP_TITLES[1]} step={status.step2} />
        </>
      ) : (
        <>
          <div className="step">
            <div className="dot">1</div>
            <div style={{ minWidth: 0 }}>
              <h3>{STEP_TITLES[0]}</h3>
              <div className="phase">Contacting the pipeline…</div>
              <div className="track indet"><i /></div>
            </div>
            <div className="readout">queued</div>
          </div>
          <div className="step">
            <div className="dot">2</div>
            <div style={{ minWidth: 0 }}>
              <h3>{STEP_TITLES[1]}</h3>
              <div className="phase">Waiting for parse…</div>
              <div className="track indet"><i /></div>
            </div>
            <div className="readout">queued</div>
          </div>
        </>
      )}

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
        {(failed || done) && (
          <button className="btn btn-ghost" onClick={() => router.push("/")}>
            <RotateCcw size={15} aria-hidden /> {failed ? "Try again" : "Add another"}
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
