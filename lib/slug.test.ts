import { test } from "node:test";
import assert from "node:assert/strict";
import { tableNameFor } from "./slug.ts";

test("plain filename", () => {
  assert.equal(tableNameFor("msft-10k-june-25.pdf"), "chunks_msft_10k_june_25");
});

test("full URL basename", () => {
  assert.equal(
    tableNameFor("https://pub-abc.r2.dev/goog-10k-feb-25.pdf"),
    "chunks_goog_10k_feb_25"
  );
});

test("blob URL with random-ish name", () => {
  assert.equal(
    tableNameFor("https://x.public.blob.vercel-storage.com/Meta 10K (Dec 2024).pdf"),
    "chunks_meta_10k_dec_2024"
  );
});

test("URL with query/fragment is ignored", () => {
  assert.equal(tableNameFor("https://h/a_b.pdf?x=1#page=2"), "chunks_a_b");
});

test("non-pdf keeps stem", () => {
  assert.equal(tableNameFor("report.PDF"), "chunks_report");
  assert.equal(tableNameFor("notes.txt"), "chunks_notes_txt");
});

test("leading/trailing separators stripped", () => {
  assert.equal(tableNameFor("--Q3--.pdf"), "chunks_q3");
});
