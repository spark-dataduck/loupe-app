import { DuckDBInstance } from "@duckdb/node-api";
import { CONFIG, assertMotherduckToken } from "./config";

// Single MotherDuck instance per warm serverless container. Connecting to md:
// loads the motherduck extension (downloaded once); home_directory=/tmp keeps that
// write inside the only writable dir on a Vercel Lambda (harmless locally).
let instancePromise: Promise<DuckDBInstance> | null = null;

function getInstance(): Promise<DuckDBInstance> {
  assertMotherduckToken();
  if (!instancePromise) {
    instancePromise = DuckDBInstance.create(
      `md:?motherduck_token=${CONFIG.motherduckToken}`,
      { home_directory: "/tmp" }
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
