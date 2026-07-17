import { NextResponse } from "next/server";
import { dropDocument } from "@/lib/documents";
import { refreshShare } from "@/lib/flights";
import { errMessage } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { table?: unknown };
    const table = typeof body.table === "string" ? body.table : "";
    if (!table) {
      return NextResponse.json({ error: "Missing document table." }, { status: 400 });
    }

    const { droppedIndex } = await dropDocument(table);

    // Let the embedded Dive stop seeing the dropped document. Non-fatal.
    let shareRefreshed = false;
    try {
      await refreshShare();
      shareRefreshed = true;
    } catch {
      shareRefreshed = false;
    }

    return NextResponse.json({ ok: true, droppedIndex, shareRefreshed });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
