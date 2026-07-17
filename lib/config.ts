// Server-side configuration. Reads env with demo-org defaults for the non-secret
// IDs so the app runs with only MOTHERDUCK_TOKEN set locally. Secrets (tokens) have
// no defaults. This module must never be imported into a client component.

export const CONFIG = {
  db: "document_search",
  motherduckToken: process.env.MOTHERDUCK_TOKEN ?? "",
  parseFlightId: process.env.PARSE_FLIGHT_ID ?? "c72f3404-a5b3-49e1-b8dc-36ef4e3c3ca4",
  embedIndexFlightId:
    process.env.EMBED_INDEX_FLIGHT_ID ?? "ef18ded7-b3d3-4084-a708-0e92c946715c",
  diveId: process.env.LOUPE_DIVE_ID ?? "8e4a1ad4-6087-43c0-8b82-d5acbf58b3cf",
  shareUrl:
    process.env.MD_SHARE_URL ??
    "md:_share/document_search/540bd0c4-2719-4792-998d-3e8a60529acc",
  embedAdminToken: process.env.MD_EMBED_ADMIN_TOKEN ?? "",
  embedServiceAccount: process.env.MD_EMBED_SERVICE_ACCOUNT ?? "",
  blobToken: process.env.BLOB_READ_WRITE_TOKEN ?? "",
  embedApiBase: "https://api.motherduck.com",
} as const;

export function assertMotherduckToken(): void {
  if (!CONFIG.motherduckToken) {
    throw new Error(
      "MOTHERDUCK_TOKEN is not set. Copy DEMO_MOTHERDUCK_TOKEN into .env.local."
    );
  }
}

export function isBlobConfigured(): boolean {
  return CONFIG.blobToken.length > 0;
}

export function isEmbedConfigured(): boolean {
  return CONFIG.embedAdminToken.length > 0 && CONFIG.embedServiceAccount.length > 0;
}
