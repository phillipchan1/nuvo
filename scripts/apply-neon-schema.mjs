#!/usr/bin/env node
/**
 * Apply the Neon rehearsal schema. No production data.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL or NEON_DATABASE_URL is required");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "../worker/schema");
const sql = postgres(url, { max: 1, ssl: url.includes("localhost") ? false : "require" });

try {
  await sql.unsafe(readFileSync(join(schemaDir, "neon.sql"), "utf8"));
  await sql.unsafe(readFileSync(join(schemaDir, "better-auth.sql"), "utf8"));
  console.log("applied worker/schema/neon.sql + better-auth.sql");
} finally {
  await sql.end();
}
