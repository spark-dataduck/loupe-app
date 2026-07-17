"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Crosshair, FileUp, Link2, X, ArrowRight } from "lucide-react";

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
          setNote(`Uploading ${src.label}…`);
          const blob = await upload(src.value.name, src.value, {
            access: "public",
            handleUploadUrl: "/api/blob/upload",
            contentType: "application/pdf",
          });
          urls.push(blob.url);
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
    <main className="wrap" style={{ padding: "clamp(36px, 8vh, 84px) 0 64px" }}>
      <p className="eyebrow">MotherDuck · hybrid search</p>
      <h1 className="display">
        Bring a document
        <br />
        into focus.
      </h1>
      <p className="lede">
        Add a PDF — paste a link or drop a file. Loupe parses it, indexes every passage for
        meaning and keyword, and hands you a search you can point at any question.
      </p>

      {/* URL row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Link2
            size={16}
            aria-hidden
            style={{ position: "absolute", left: 13, top: 14, color: "var(--ink-3)" }}
          />
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

      {/* Dropzone */}
      <div
        className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
        style={{ cursor: "pointer" }}
      >
        <FileUp size={20} aria-hidden style={{ color: "var(--glass)", marginBottom: 6 }} />
        <div>
          <strong>Drop PDFs here</strong> or <span style={{ color: "var(--glass)" }}>browse</span>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

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

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 26, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={submit} disabled={busy || sources.length === 0}>
          <Crosshair size={16} aria-hidden />
          {busy ? note || "Working…" : "Parse & index"}
          {!busy && <ArrowRight size={16} aria-hidden />}
        </button>
        <button className="link-quiet" onClick={() => router.push("/explore")} disabled={busy}>
          or explore documents already in Loupe →
        </button>
      </div>

      <p className="readout" style={{ marginTop: 40, color: "var(--ink-3)" }}>
        Parsing a long PDF takes a few minutes (VLM extraction). You can watch both steps on the next screen.
      </p>
    </main>
  );
}
