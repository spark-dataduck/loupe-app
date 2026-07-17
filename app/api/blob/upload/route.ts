import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isBlobConfigured } from "@/lib/config";
import { errMessage } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client-upload handshake: the browser calls @vercel/blob's `upload()` which posts here
// to mint a scoped client token, then uploads the file DIRECTLY to Blob (bypassing the
// 4.5 MB serverless body limit). The uploaded public URL is what we feed the flight, and
// it doubles as the "Open at page N" deep-link target.
export async function POST(req: Request): Promise<Response> {
  if (!isBlobConfigured()) {
    return NextResponse.json(
      {
        error:
          "Uploads aren't configured (no BLOB_READ_WRITE_TOKEN). Connect a Vercel Blob store, or paste a public PDF URL instead.",
      },
      { status: 501 }
    );
  }

  try {
    const body = (await req.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        addRandomSuffix: false,
        allowOverwrite: true,
        maximumSizeInBytes: 50 * 1024 * 1024,
      }),
      // Fires only when Blob can reach a public callback (skipped on localhost).
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 400 });
  }
}
