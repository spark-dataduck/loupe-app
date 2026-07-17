import { NextResponse } from "next/server";
import { CONFIG, isEmbedConfigured, embedBearerToken } from "@/lib/config";
import { errMessage } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mint a read-only embed session for the Loupe Dive. Bearer = an admin token (the main
// MOTHERDUCK_TOKEN qualifies; a dedicated MD_EMBED_ADMIN_TOKEN overrides it). The admin
// token stays server-side; only the short-lived (24h) read-only session string reaches the
// browser. We pin the configured org share (MD_SHARE_URL) via `required_resources`, aliased
// document_search, so the embed reads the corpus from the share the app is configured with
// (authoritative, independent of the Dive's own REQUIRED_DATABASES). `initial_state.doc`
// opens the Dive focused on the just-added document. No `version` → always the latest Dive.
export async function POST(req: Request) {
  if (!isEmbedConfigured()) {
    return NextResponse.json(
      {
        error:
          "Embedding isn't configured yet. Set MD_EMBED_SERVICE_ACCOUNT to a dedicated, empty service account's username (the Dive runs as it). The admin bearer defaults to MOTHERDUCK_TOKEN; set MD_EMBED_ADMIN_TOKEN only to override it.",
      },
      { status: 501 }
    );
  }

  let doc: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.doc === "string" && body.doc) doc = body.doc;
  } catch {
    // no body is fine — open the corpus without a pre-selected doc
  }

  const payload: Record<string, unknown> = {
    username: CONFIG.embedServiceAccount,
    required_resources: [{ url: CONFIG.shareUrl, alias: CONFIG.db }],
  };
  if (doc) payload.initial_state = { doc };

  try {
    const resp = await fetch(
      `${CONFIG.embedApiBase}/v1/dives/${CONFIG.diveId}/embed-session`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${embedBearerToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `MotherDuck embed-session failed (${resp.status}): ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const json = (await resp.json()) as { session?: string };
    if (!json.session) {
      return NextResponse.json(
        { error: "MotherDuck returned no session string." },
        { status: 502 }
      );
    }
    return NextResponse.json({ session: json.session });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 502 });
  }
}
