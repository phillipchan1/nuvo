/**
 * Apply the Neon planner schema + isolation seed onto PGlite.
 * Test-only (excluded from the Worker tsconfig).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "../schema");

export async function applyIsolationSchema(db: PGlite): Promise<void> {
  // PGlite has no pgcrypto control file. Neon still loads the extension
  // from neon.sql; here we skip it and supply gen_random_uuid ourselves.
  await db.exec(`
    CREATE OR REPLACE FUNCTION gen_random_uuid() RETURNS uuid
    LANGUAGE sql AS $$
      SELECT uuid_in(
        overlay(
          overlay(
            md5(random()::text || ':' || clock_timestamp()::text)
            placing '4' from 13
          )
          placing to_hex(floor(random() * 4 + 8)::int)::text from 17
        )::cstring
      );
    $$;
  `);
  const neon = readFileSync(join(schemaDir, "neon.sql"), "utf8").replace(
    /CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/g,
    "",
  );
  await db.exec(neon);
  await db.exec(readFileSync(join(schemaDir, "better-auth.sql"), "utf8"));
  await db.exec(readFileSync(join(schemaDir, "isolation-seed.sql"), "utf8"));
}
