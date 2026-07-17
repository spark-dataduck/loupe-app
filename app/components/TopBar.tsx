"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Crosshair, Menu, X, FileUp, Activity, Search, Trash2 } from "lucide-react";

/**
 * The persistent app frame. It stays put across routes for identity, but changes
 * ground with the mode so you always know which state of the instrument you're
 * in: light "desk" while adding/managing, dark "stage" while examining. The
 * hamburger opens the four sections; the right-side label names the current one.
 */

const NAV = [
  { href: "/", label: "Add a document", desc: "Drop or paste a PDF", icon: FileUp },
  { href: "/progress", label: "Indexing progress", desc: "Parse & embed status", icon: Activity },
  { href: "/explore", label: "Search documents", desc: "Query the live Dive", icon: Search },
  { href: "/drop", label: "Manage documents", desc: "Drop a table & its index", icon: Trash2 },
] as const;

function modeLabel(path: string | null): string {
  if (path?.startsWith("/explore")) return "Examining";
  if (path?.startsWith("/progress")) return "Indexing";
  if (path?.startsWith("/drop")) return "Managing";
  return "Add a document";
}

export default function TopBar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const examine = path?.startsWith("/explore");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on navigation.
  useEffect(() => setOpen(false), [path]);

  // Close on Escape or a click anywhere outside the menu. A document listener
  // is used instead of an overlay because the top bar's backdrop-filter would
  // trap a fixed-position scrim inside the bar's own box.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const isActive = (href: string) => (href === "/" ? path === "/" : path?.startsWith(href));

  return (
    <header className="topbar" data-mode={examine ? "examine" : "light"}>
      <div className="wrap row">
        <Link href="/" className="brand" aria-label="Loupe — start over">
          <Crosshair className="lens" strokeWidth={1.75} aria-hidden />
          <span className="word">
            <b>Loupe</b>
          </span>
          <span className="tag">document search</span>
        </Link>

        <div className="nav-right">
          <span className="mode">{modeLabel(path)}</span>
          <div className="menu-wrap" ref={wrapRef}>
            <button
              className="menu-btn"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-haspopup="menu"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            </button>
            {open && (
              <nav className="menu" role="menu" aria-label="Sections">
                {NAV.map(({ href, label, desc, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    role="menuitem"
                    className={`menu-item${isActive(href) ? " active" : ""}`}
                  >
                    <Icon size={16} aria-hidden />
                    <span className="mi-text">
                      <span className="mi-label">{label}</span>
                      <span className="mi-desc">{desc}</span>
                    </span>
                  </Link>
                ))}
              </nav>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
