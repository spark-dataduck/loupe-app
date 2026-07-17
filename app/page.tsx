"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, FileUp, Link2, X, ArrowRight } from "lucide-react";

// Vercel serverless functions cap the request body at ~4.5 MB. Uploads go through our
// own /api/blob/upload route (server-side put), so files above this must use URL-paste.
const MAX_UPLOAD_BYTES = 4_000_000;

type Source =
  | { kind: "url"; value: string; label: string }
  | { kind: "file"; value: File; label: string };

const URL_RE = /^https?:\/\/[^\s'"`;\\]+$/i;

export default function Ingest() {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [draft, setDraft] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addUrl = useCallback(() => {
    const v = draft.trim();
    if (!v) return;
    if (!URL_RE.test(v)) {
      setError("That doesn't look like a valid http(s) URL.");
      return;
    }
    setError(null);
    const label = v.split(/[?#]/)[0].split("/").pop() || v;
    setSources((s) => [...s, { kind: "url", value: v, label }]);
    setDraft("");
  }, [draft]);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    const pdfs = Array.from(list).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (!pdfs.length) {
      setError("Only PDF files are supported.");
      return;
    }
    setError(null);
    setSources((s) => [...s, ...pdfs.map((f) => ({ kind: "file" as const, value: f, label: f.name }))]);
  }, []);

  const remove = (i: number) => setSources((s) => s.filter((_, j) => j !== i));

  async function submit() {
    if (!sources.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const urls: string[] = [];
      for (const src of sources) {
        if (src.kind === "url") {
          urls.push(src.value);
        } else {
          if (src.value.size > MAX_UPLOAD_BYTES) {
            throw new Error(
              `"${src.label}" is ${(src.value.size / 1e6).toFixed(1)} MB — over the ~4.5 MB direct-upload limit. Paste its URL instead.`
            );
          }
          setNote(`Uploading ${src.label}…`);
          const fd = new FormData();
          fd.append("file", src.value, src.value.name);
          const up = await fetch("/api/blob/upload", { method: "POST", body: fd });
          const upData = await up.json();
          if (!up.ok) throw new Error(upData.error || `Upload failed (${up.status}).`);
          urls.push(upData.url);
        }
      }
      setNote("Starting the pipeline…");
      const res = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Start failed (${res.status}).`);

      const q = new URLSearchParams({
        parseRun: String(data.parseRun),
        baselineEmbedRun: String(data.baselineEmbedRun),
      });
      if (data.slugs?.[0]) q.set("doc", data.slugs[0]);
      router.push(`/progress?${q.toString()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
      setNote("");
    }
  }

  return (
    <main className="wrap" style={{ padding: "clamp(40px, 9vh, 92px) 0 72px" }}>
      <h1 className="display">
        Bring a document
        <br />
        into focus.
      </h1>
      <p className="lede">
        Drop a PDF or paste a link. Loupe reads it, indexes every passage by meaning and keyword,
        and gives you a search you can point at any question.
      </p>

      {/* One specimen tray: drop a file up top, or paste a link below.
          Drag/drop is handled on the whole tray; the <label> wraps only the
          drop area so clicking the URL field never opens the file picker. */}
      <section
        className={`tray frame${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          // ignore leaves into child elements
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <span className="reticle" aria-hidden />

        <label htmlFor="loupe-file" className="tray-drop">
          <FileUp className="lens-in" size={22} aria-hidden />
          <div>
            <strong>Drop a PDF here</strong> or <span className="browse">browse</span>
          </div>
        </label>

        <div className="tray-or">paste a link instead</div>

        <div className="tray-url">
          <div className="url-wrap">
            <Link2 className="url-ico" size={16} aria-hidden />
            <input
              className="field"
              style={{ paddingLeft: 36 }}
              placeholder="https://…/document.pdf"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addUrl())}
              disabled={busy}
              aria-label="PDF URL"
            />
          </div>
          <button className="btn btn-ghost" onClick={addUrl} disabled={busy || !draft.trim()}>
            Add
          </button>
        </div>
      </section>

      {/* Sibling of the label (associated via htmlFor/id): the input's click bubbles to
          <body>, not back into the label, so one click opens exactly one picker. */}
      <input
        id="loupe-file"
        ref={fileInput}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />

      {/* Added sources */}
      {sources.length > 0 && (
        <div className="chips" style={{ marginTop: 16 }}>
          {sources.map((s, i) => (
            <span className="chip" key={i} title={s.kind === "url" ? s.value : s.label}>
              {s.kind === "url" ? <Link2 size={12} aria-hidden /> : <FileUp size={12} aria-hidden />}
              <span
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}
              >
                {s.label}
              </span>
              <X className="x" size={13} aria-label={`Remove ${s.label}`} onClick={() => !busy && remove(i)} />
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="notice warn" style={{ marginTop: 18 }}>
          {error}
        </div>
      )}

      {/* Primary action, then a quiet secondary path on its own line */}
      <div style={{ marginTop: 26 }}>
        <button className="btn btn-primary" onClick={submit} disabled={busy || sources.length === 0}>
          <Crosshair size={16} aria-hidden />
          {busy ? note || "Working…" : "Parse & index"}
          {!busy && <ArrowRight size={16} aria-hidden />}
        </button>
      </div>
      <p className="readout" style={{ marginTop: 16, color: "var(--ink-3)" }}>
        Already indexed something?{" "}
        <button className="link-quiet" onClick={() => router.push("/explore")} disabled={busy}>
          Search documents in Loupe →
        </button>
      </p>

      <p className="readout" style={{ marginTop: 40, color: "var(--ink-3)" }}>
        Parsing runs ~5–6 seconds per page (visual extraction), up to 15,000 pages a month. You can
        watch each step on the next screen.
      </p>
    </main>
  );
}
