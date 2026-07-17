import "./globals.css";
import type { Metadata } from "next";
import TopBar from "./components/TopBar";

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
        </div>
      </body>
    </html>
  );
}
