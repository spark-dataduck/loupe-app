import { DuckDBInstance } from "@duckdb/node-api";
import { CONFIG, assertMotherduckToken } from "./config";

// Vercel Lambda ships no writable HOME, but DuckDB resolves ~/.duckdb from the HOME env
// var when it autoloads the MotherDuck extension — with HOME empty it throws "Can't find
// the home directory at ''". /tmp is the only writable dir on Lambda, so force HOME there
// (on Vercel, or anywhere HOME is unset). This runs before any DuckDB call. Harmless
// locally, where HOME is already set and we're not on Vercel.
if (process.env.VERCEL || !process.env.HOME) {
  process.env.HOME = "/tmp";
}
const DUCKDB_HOME = process.env.HOME || "/tmp";

// Single MotherDuck instance per warm serverless container. Connecting to md: loads the
// motherduck extension (downloaded once) into <home>/.duckdb.
let instancePromise: Promise<DuckDBInstance> | null = null;

function getInstance(): Promise<DuckDBInstance> {
  assertMotherduckToken();
  if (!instancePromise) {
    instancePromise = DuckDBInstance.create(
      `md:?motherduck_token=${CONFIG.motherduckToken}`,
      {
        home_directory: DUCKDB_HOME,
        extension_directory: `${DUCKDB_HOME}/.duckdb/extensions`,
      }
    );
  }
  return instancePromise;
}

function coerce(v: unknown): unknown {
  // DuckDB returns BIGINT/HUGEINT as JS BigInt, which JSON.stringify rejects.
  // Run numbers and counts are well within Number range.
  if (typeof v === "bigint") return Number(v);
  return v;
}

/** Run a read/write SQL statement and return normalized row objects. */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const instance = await getInstance();
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjects().map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = coerce(v);
      return out as T;
    });
  } finally {
    connection.disconnectSync();
  }
}

/** Convenience: first row or null. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string
): Promise<T | null> {
  const rows = await query<T>(sql);
  return rows.length ? rows[0] : null;
}

/** Run statements against a specific database on ONE connection: `USE <db>`
 *  first (so it's attached and current), then each statement in order. Returns
 *  the rows from the final statement. `db` must be a trusted constant — it is
 *  interpolated into `USE`. */
export async function queryIn<T = Record<string, unknown>>(
  db: string,
  sqls: string[]
): Promise<T[]> {
  const instance = await getInstance();
  const connection = await instance.connect();
  try {
    await connection.runAndReadAll(`USE ${db}`);
    let rows: T[] = [];
    for (const sql of sqls) {
      const reader = await connection.runAndReadAll(sql);
      rows = reader.getRowObjects().map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) out[k] = coerce(v);
        return out as T;
      });
    }
    return rows;
  } finally {
    connection.disconnectSync();
  }
}
