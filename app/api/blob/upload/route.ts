import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { CONFIG, isBlobConfigured } from "@/lib/config";
import { errMessage } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side upload: the browser POSTs the file here (multipart form), and we store it
// with put() using BLOB_READ_WRITE_TOKEN, then return the public URL — which becomes the
// PDF's source_url and the "Open at page N" deep-link target.
//
// We deliberately do NOT use @vercel/blob's client-upload flow: in this version its client
// posts to the default vercel.com/api/blob callback rather than this route, which the
// browser blocks with CORS. Server-side put() avoids any cross-origin request. Trade-off:
// Vercel caps a function request body at ~4.5 MB, so the client guards large files and
// steers them to the URL-paste path instead.
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
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
    }

    const blob = await put(file.name, file, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: CONFIG.blobToken,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 400 });
  }
}
