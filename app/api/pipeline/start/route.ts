import { NextResponse } from "next/server";
import { triggerParse, isSafeUrl } from "@/lib/flights";
import { errMessage } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let urls: string[];
  try {
    const body = await req.json();
    urls = Array.isArray(body?.urls) ? body.urls.map((u: unknown) => String(u).trim()) : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  urls = urls.filter(Boolean);
  if (!urls.length) {
    return NextResponse.json({ error: "Provide at least one PDF URL." }, { status: 400 });
  }
  for (const u of urls) {
    if (!isSafeUrl(u)) {
      return NextResponse.json({ error: `Not a valid http(s) URL: ${u}` }, { status: 400 });
    }
  }

  try {
    const result = await triggerParse(urls);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
