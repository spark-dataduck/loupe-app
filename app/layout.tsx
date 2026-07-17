import "./globals.css";
import type { Metadata } from "next";
import TopBar from "./components/TopBar";
import DuckMark from "./components/DuckMark";

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
          <TopBar />
          {children}
          <footer className="site-foot">
            <a
              className="foot-link"
              href="https://motherduck.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <DuckMark height={12} />
              Powered by MotherDuck
            </a>
          </footer>
        </div>
      </body>
    </html>
  );
}
