"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, FileText, RotateCcw, Hash } from "lucide-react";

interface DocumentRow {
  table: string;
  slug: string;
  name: string;
  rows: number;
  hasIndex: boolean;
}

function fmtRows(n: number): string {
  if (!n) return "empty";
  if (n >= 1000) return `~${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k chunks`;
  return `~${n} chunks`;
}

export default function DropPage() {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // table pending confirm
  const [dropping, setDropping] = useState<string | null>(null); // table being dropped
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Couldn't list documents (${res.status}).`);
      setDocs(data.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the catalog.");
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function drop(table: string) {
    setDropping(table);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/documents/drop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Drop failed (${res.status}).`);
      setDocs((d) => (d ? d.filter((x) => x.table !== table) : d));
      setNote(
        `Dropped ${table}${data.droppedIndex ? " and its search index" : ""}.${
          data.shareRefreshed ? "" : " The Dive may take a moment to catch up."
        }`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drop failed.");
    } finally {
      setDropping(null);
      setConfirm(null);
    }
  }

  return (
    <main className="wrap" style={{ padding: "clamp(36px, 7vh, 72px) 0 72px" }}>
      <h1 className="display" style={{ fontSize: "clamp(28px, 5vw, 40px)" }}>
        Manage documents
      </h1>
      <p className="lede">
        Every document is a parsed table and its search index. Dropping one removes both from Loupe
        and the Dive stops showing it. This can&apos;t be undone — you&apos;d re-add the PDF to bring
        it back.
      </p>

      {note && (
        <div className="notice" style={{ marginBottom: 16 }}>
          {note}
        </div>
      )}
      {error && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {docs === null ? (
        <p className="readout">Reading the catalog…</p>
      ) : docs.length === 0 && !error ? (
        <div className="card" style={{ textAlign: "center", color: "var(--ink-2)" }}>
          No documents indexed yet. Add one from the start page.
        </div>
      ) : (
        <div>
          {docs.map((d) => {
            const isConfirming = confirm === d.table;
            const isDropping = dropping === d.table;
            return (
              <div className={`doc${isConfirming ? " confirming" : ""}`} key={d.table}>
                <div className="doc-face">
                  <FileText size={18} aria-hidden className="doc-ico" />
                  <div style={{ minWidth: 0 }}>
                    <div className="doc-name">{d.name}</div>
                    <div className="doc-meta readout">
                      <span className="doc-tag"><Hash size={11} aria-hidden />{d.table}</span>
                      <span>{fmtRows(d.rows)}</span>
                      <span className={d.hasIndex ? "ok" : "muted"}>
                        {d.hasIndex ? "indexed" : "no index"}
                      </span>
                    </div>
                  </div>
                </div>

                {isConfirming ? (
                  <div className="doc-confirm">
                    <span className="readout">Drop table + index?</span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setConfirm(null)}
                      disabled={isDropping}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => drop(d.table)}
                      disabled={isDropping}
                    >
                      {isDropping ? "Dropping…" : "Drop"}
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm danger-ghost"
                    onClick={() => setConfirm(d.table)}
                    disabled={!!dropping}
                  >
                    <Trash2 size={15} aria-hidden />
                    Drop
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p style={{ marginTop: 24 }}>
        <button className="link-quiet" onClick={load}>
          <RotateCcw size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 5 }} />
          Refresh list
        </button>
      </p>
    </main>
  );
}
