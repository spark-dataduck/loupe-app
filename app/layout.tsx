import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Crosshair } from "lucide-react";

export const metadata: Metadata = {
  title: "Loupe — bring a document into focus",
  description:
    "Add a PDF, parse and index it into MotherDuck, then search it by meaning + keyword.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="wrap row">
              <Link href="/" className="brand" aria-label="Loupe — start over">
                <Crosshair className="lens" strokeWidth={1.75} aria-hidden />
                <span className="word">
                  <b>Loupe</b>
                </span>
                <span className="tag">document search</span>
              </Link>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
