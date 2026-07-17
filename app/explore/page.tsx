"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

const EMBED_ORIGIN = "https://embed-motherduck.com";
const DIVE_ID = "8e4a1ad4-6087-43c0-8b82-d5acbf58b3cf";

function ExploreInner() {
  const router = useRouter();
  const doc = useSearchParams().get("doc") ?? "";
  const [session, setSession] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);

  // Fetch a read-only embed session for this doc.
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await fetch("/api/dive/embed-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(doc ? { doc } : {}),
        });
        const data = await res.json();
        if (stop) return;
        if (!res.ok) setErr(data.error || `Couldn't open the Dive (${res.status}).`);
        else setSession(data.session);
      } catch (e) {
        if (!stop) setErr(e instanceof Error ? e.message : "Couldn't reach the embed service.");
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [doc]);

  // The sandboxed Dive can't navigate the parent; it postMessages link clicks
  // ("Open at page N"). Validate, then open in a new tab.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== EMBED_ORIGIN) return;
      if (frame.current && e.source !== frame.current.contentWindow) return;
      const m = e.data;
      if (m?.type !== "navigation-request" || typeof m.url !== "string") return;
      let u: URL;
      try {
        u = new URL(m.url);
      } catch {
        return;
      }
      if (!["https:", "http:"].includes(u.protocol)) return;
      window.open(u.toString(), "_blank", "noopener,noreferrer");
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Sub-header */}
      <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
        <div className="readout" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="link-quiet" onClick={() => router.push("/")}>
            <ArrowLeft size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Search another document
          </button>
        </div>
        {doc && <span className="readout" style={{ color: "var(--ink-3)" }}>focused: {doc}</span>}
      </div>

      {loading && (
        <div className="center">
          <p className="readout">Opening Loupe…</p>
        </div>
      )}

      {!loading && err && (
        <div className="center">
          <div style={{ maxWidth: 520 }}>
            <h2 className="display" style={{ fontSize: 26 }}>Loupe isn&apos;t embeddable yet</h2>
            <div className="notice" style={{ textAlign: "left", marginBottom: 18 }}>{err}</div>
            <p className="lede" style={{ margin: "0 auto 20px" }}>
              Once <code>MD_EMBED_ADMIN_TOKEN</code> and <code>MD_EMBED_SERVICE_ACCOUNT</code> are set,
              the interactive Dive renders right here. Meanwhile you can open it directly in MotherDuck.
            </p>
            <a
              className="btn btn-ghost"
              href={`https://app.motherduck.com/dives/${DIVE_ID}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in MotherDuck <ExternalLink size={15} aria-hidden />
            </a>
          </div>
        </div>
      )}

      {!loading && session && (
        <div className="frameWrap">
          <iframe
            ref={frame}
            className="diveFrame"
            title="Loupe — hybrid document search"
            src={`${EMBED_ORIGIN}/sandbox/#session=${session}`}
            sandbox="allow-scripts allow-same-origin"
            allow="cross-origin-isolated"
          />
        </div>
      )}
    </main>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<main className="center"><p className="readout">Loading…</p></main>}>
      <ExploreInner />
    </Suspense>
  );
}
