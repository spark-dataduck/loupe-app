import { CONFIG } from "./config";
import { queryIn } from "./md";

// A document in Loupe is a parsed chunks table plus its full-text index schema:
//   main.chunks_<slug>            — the parsed passages ("parsed table")
//   fts_main_chunks_<slug>        — the DuckDB FTS index ("index schema")
// Dropping a document removes both.

export interface DocumentRow {
  table: string; // chunks_<slug>
  slug: string; // <slug>
  name: string; // display name
  rows: number; // approx chunk count
  hasIndex: boolean; // fts_main_chunks_<slug> schema present
}

// The parse flight derives table names as chunks_<[a-z0-9_]+>. We inline the
// table name into DROP statements, so validate it strictly first.
const TABLE_RE = /^chunks_[a-z0-9_]+$/;

function displayName(slug: string): string {
  return slug.replace(/_/g, " ").trim();
}

/** List every parsed document in the search database, with an approximate chunk
 *  count and whether its full-text index still exists. */
export async function listDocuments(): Promise<DocumentRow[]> {
  const tables = await queryIn<{ table_name: string; estimated_size: number }>(CONFIG.db, [
    `SELECT table_name, estimated_size
       FROM duckdb_tables()
      WHERE database_name = '${CONFIG.db}'
        AND schema_name = 'main'
        AND starts_with(table_name, 'chunks_')
      ORDER BY table_name`,
  ]);
  const schemas = await queryIn<{ schema_name: string }>(CONFIG.db, [
    `SELECT schema_name
       FROM duckdb_schemas()
      WHERE database_name = '${CONFIG.db}'
        AND starts_with(schema_name, 'fts_main_chunks_')`,
  ]);
  const indexed = new Set(schemas.map((s) => s.schema_name));

  return tables
    .filter((t) => TABLE_RE.test(t.table_name))
    .map((t) => {
      const slug = t.table_name.slice("chunks_".length);
      return {
        table: t.table_name,
        slug,
        name: displayName(slug),
        rows: Number(t.estimated_size ?? 0),
        hasIndex: indexed.has(`fts_main_${t.table_name}`),
      };
    });
}

/** Drop a document: its FTS index schema (CASCADE) and then its parsed table.
 *  Both use IF EXISTS so a partially-built document still cleans up. */
export async function dropDocument(table: string): Promise<{ droppedIndex: boolean }> {
  if (!TABLE_RE.test(table)) {
    throw new Error(`Refusing to drop "${table}": not a Loupe document table.`);
  }
  const fts = `fts_main_${table}`;

  // Does the index schema exist? (So we can report honestly.)
  const found = await queryIn<{ n: number }>(CONFIG.db, [
    `SELECT count(*) AS n FROM duckdb_schemas()
      WHERE database_name = '${CONFIG.db}' AND schema_name = '${fts}'`,
  ]);
  const hasIndex = (found[0]?.n ?? 0) > 0;

  await queryIn(CONFIG.db, [
    `DROP SCHEMA IF EXISTS "${fts}" CASCADE`,
    `DROP TABLE IF EXISTS main."${table}"`,
  ]);

  return { droppedIndex: hasIndex };
}
