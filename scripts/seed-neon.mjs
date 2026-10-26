#!/usr/bin/env node
/**
 * Synthetic Neon seed. No production data.
 * Requires DATABASE_URL (or NEON_DATABASE_URL) pointing at an empty-or-dev Neon db.
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
const applySchema = process.argv.includes("--apply-schema");

const sql = postgres(url, { max: 1, ssl: url.includes("localhost") ? false : "require" });

try {
  if (applySchema) {
    console.log("applying worker/schema/neon.sql + better-auth.sql");
    await sql.unsafe(readFileSync(join(schemaDir, "neon.sql"), "utf8"));
    await sql.unsafe(readFileSync(join(schemaDir, "better-auth.sql"), "utf8"));
  }
  console.log("seeding synthetic A/B users (worker/schema/isolation-seed.sql)");
  await sql.unsafe(readFileSync(join(schemaDir, "isolation-seed.sql"), "utf8"));
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM users`;
  console.log(`seeded. users=${n}`);
} finally {
  await sql.end();
}
