import { NextResponse } from "next/server";
import { pipelineStatus } from "@/lib/flights";
import { errMessage } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parseRun = Number(searchParams.get("parseRun"));
  const baselineEmbedRun = Number(searchParams.get("baselineEmbedRun"));

  if (!Number.isInteger(parseRun) || parseRun < 1) {
    return NextResponse.json({ error: "Missing/invalid parseRun." }, { status: 400 });
  }
  if (!Number.isInteger(baselineEmbedRun) || baselineEmbedRun < 0) {
    return NextResponse.json({ error: "Missing/invalid baselineEmbedRun." }, { status: 400 });
  }

  try {
    const status = await pipelineStatus(parseRun, baselineEmbedRun);
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
