// Compute the MotherDuck table name a PDF lands in, matching the flight's
// `table_name_for` EXACTLY so the app can predict the table for a given URL/file:
//   os.path.basename(url) -> strip .pdf -> lower -> [^a-z0-9]+ => "_" -> strip "_"
//   e.g. "msft-10k-june-25.pdf" -> "chunks_msft_10k_june_25"
export function tableNameFor(nameOrUrl: string): string {
  // basename: drop any query/fragment first, then take the last path segment.
  const noQuery = nameOrUrl.split(/[?#]/)[0];
  const base = noQuery.substring(noQuery.lastIndexOf("/") + 1);
  const stem = base.toLowerCase().endsWith(".pdf") ? base.slice(0, -4) : base;
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `chunks_${slug}`;
}
