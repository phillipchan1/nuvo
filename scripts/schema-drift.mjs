#!/usr/bin/env node
/**
 * Does `worker/schema/neon.sql` still describe production? Run before ANY
 * migration (docs/schema-drift.md, D-241).
 *
 * Production was made by the cutover copying Supabase's tables, not by
 * running neon.sql, so the two drift apart silently: on 2026-11-17 a migration
 * that passed against neon.sql would have broken every routing write in prod,
 * and the Worker's agent writes used two columns prod never had. This builds
 * both shapes side by side in a local Postgres and diffs the catalogs:
 *
 *   nuvo_drift_prod  ← pg_dump --schema-only -n public of production
 *   nuvo_drift_neon  ← neon.sql + better-auth.sql + field-ts.sql on an empty DB
 *
 * Compared: tables, columns (type · nullability · default), constraints,
 * indexes, enums, triggers, functions. Exit 1 on any difference.
 *
 *   node scripts/schema-drift.mjs                    # dump prod via neonctl, diff
 *   node scripts/schema-drift.mjs --dump prod.sql    # diff against a dump you already have
 *   node scripts/schema-drift.mjs --migration m.sql  # also apply m.sql to the prod copy
 *                                                    # (one transaction) before diffing
 *   node scripts/schema-drift.mjs --emit-tables      # print the prod copy's tables as
 *                                                    # neon.sql DDL (to refresh that section)
 *
 * Reads production with pg_dump only — never writes to it. The prod URL comes
 * from PROD_DATABASE_URL, else `neonctl connection-string` (never printed).
 * Local Postgres: LOCAL_PG_URL (default postgres://postgres@127.0.0.1:5432/postgres).
 * Needs pg_dump/psql on PATH, same major version as Neon (17).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "../worker/schema");
const NEON_PROJECT = "frosty-snow-66931204";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const localUrl = process.env.LOCAL_PG_URL || "postgres://postgres@127.0.0.1:5432/postgres";
const dbUrl = (name) => {
  const u = new URL(localUrl);
  u.pathname = `/${name}`;
  return u.toString();
};

// Tables neon.sql does not generate from production: Better Auth owns its own
// (better-auth.sql), billing is hand-written for the cutover copy, and the
// change feed is a hand-written migration (D-238).
const NOT_GENERATED = new Set([
  "user", "session", "account", "verification",
  "subscriptions", "stripe_webhook_events", "apple_webhook_events",
  "sync_changes",
]);

function prodDump() {
  const given = opt("--dump");
  if (given) return readFileSync(given, "utf8");
  let url = process.env.PROD_DATABASE_URL;
  if (!url) {
    url = execFileSync(
      "npx",
      ["-y", "neonctl@latest", "connection-string", "main", "--project-id", NEON_PROJECT,
        "--database-name", "neondb", "--role-name", "neondb_owner"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  }
  if (!url) throw new Error("no production URL (set PROD_DATABASE_URL or log in to neonctl)");
  return execFileSync("pg_dump", [url, "--schema-only", "-n", "public", "--no-owner", "--no-privileges"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function freshDb(name) {
  const admin = postgres(localUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

function psqlFile(db, file, { single = false } = {}) {
  const r = spawnSync(
    "psql",
    [dbUrl(db), "-q", "-X", "-v", "ON_ERROR_STOP=1", ...(single ? ["-1"] : []), "-f", file],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`psql ${file} on ${db} failed:\n${r.stderr}`);
}

async function buildProdCopy(dumpSql) {
  await freshDb("nuvo_drift_prod");
  const dir = mkdtempSync(join(tmpdir(), "nuvo-drift-"));
  const file = join(dir, "prod-schema.sql");
  // The dump creates `public` itself; an empty DB already has one.
  writeFileSync(file, `DROP SCHEMA public CASCADE;\n${dumpSql}`);
  psqlFile("nuvo_drift_prod", file);
  const migration = opt("--migration");
  if (migration) {
    psqlFile("nuvo_drift_prod", migration, { single: true });
    console.log(`applied ${migration} to the prod copy in one transaction`);
  }
}

async function buildNeonSql() {
  await freshDb("nuvo_drift_neon");
  for (const f of ["neon.sql", "better-auth.sql", "field-ts.sql"]) psqlFile("nuvo_drift_neon", join(schemaDir, f));
}

/** Everything about a schema a write can trip on, as comparable strings. */
async function catalog(db) {
  const sql = postgres(dbUrl(db), { max: 1, onnotice: () => {} });
  try {
    const rows = (q) => sql.unsafe(q).then((r) => r.map((x) => x.k));
    const extOwned = `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`;
    return {
      tables: await rows(`SELECT relname AS k FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`),
      columns: await rows(`
        SELECT c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
          || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
          || CASE a.attidentity WHEN 'a' THEN ' GENERATED ALWAYS AS IDENTITY'
                                WHEN 'd' THEN ' GENERATED BY DEFAULT AS IDENTITY' ELSE '' END
          || coalesce(CASE WHEN a.attgenerated = 's'
               THEN ' GENERATED ALWAYS AS (' || pg_get_expr(ad.adbin, ad.adrelid) || ') STORED'
               ELSE ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid) END, '') AS k
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped`),
      constraints: await rows(`
        SELECT conrelid::regclass::text || ' ' || pg_get_constraintdef(oid) AS k
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 't'`),
      indexes: await rows(`
        SELECT regexp_replace(pg_get_indexdef(i.indexrelid), 'INDEX \\S+ ON', 'INDEX ON') AS k
        FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
        WHERE c.relnamespace = 'public'::regnamespace
          AND NOT EXISTS (SELECT 1 FROM pg_constraint x WHERE x.conindid = i.indexrelid)`),
      enums: await rows(`
        SELECT t.typname || ' (' || string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) || ')' AS k
        FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typnamespace = 'public'::regnamespace GROUP BY t.typname`),
      triggers: await rows(`
        SELECT tgrelid::regclass::text || ' ' || tgname || ' → ' || tgfoid::regproc::text AS k
        FROM pg_trigger WHERE NOT tgisinternal
          AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)`),
      functions: await rows(`
        SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS k
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND ${extOwned}`),
    };
  } finally {
    await sql.end();
  }
}

function diff(prod, neon) {
  let drift = 0;
  for (const kind of Object.keys(prod)) {
    const p = new Set(prod[kind]);
    const n = new Set(neon[kind]);
    const onlyNeon = [...n].filter((x) => !p.has(x)).sort();
    const onlyProd = [...p].filter((x) => !n.has(x)).sort();
    if (!onlyNeon.length && !onlyProd.length) continue;
    drift += onlyNeon.length + onlyProd.length;
    console.log(`\n${kind}`);
    for (const x of onlyNeon) console.log(`  neon.sql only:   ${x}`);
    for (const x of onlyProd) console.log(`  production only: ${x}`);
  }
  return drift;
}

/** The prod copy's tables as idempotent neon.sql DDL, FK-ordered. */
async function emitTables() {
  const sql = postgres(dbUrl("nuvo_drift_prod"), { max: 1, onnotice: () => {} });
  try {
    const out = [];
    const enums = await sql.unsafe(`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typnamespace = 'public'::regnamespace GROUP BY t.typname ORDER BY t.typname`);
    for (const e of enums) {
      const labels = e.labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(", ");
      out.push(
        `DO $$ BEGIN\n  IF to_regtype('public.${e.typname}') IS NULL THEN\n` +
          `    CREATE TYPE public.${e.typname} AS ENUM (${labels});\n  END IF;\nEND $$;`,
      );
    }
    const tables = (await sql.unsafe(`
      SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname`))
      .map((r) => r.relname)
      .filter((t) => !NOT_GENERATED.has(t));
    const fks = await sql.unsafe(`
      SELECT conrelid::regclass::text AS tbl, confrelid::regclass::text AS ref
      FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`);
    const strip = (n) => n.replace(/^public\./, "");
    const deps = new Map(tables.map((t) => [t, new Set()]));
    for (const f of fks) {
      const t = strip(f.tbl);
      const r = strip(f.ref);
      if (deps.has(t) && r !== t && deps.has(r)) deps.get(t).add(r);
    }
    const order = [];
    const seen = new Set();
    const visit = (t, stack = new Set()) => {
      if (seen.has(t) || stack.has(t)) return;
      stack.add(t);
      for (const d of [...deps.get(t)].sort()) visit(d, stack);
      seen.add(t);
      order.push(t);
    };
    for (const t of tables) visit(t);
    const emitted = new Set();
    for (const t of order) {
      const cols = await sql.unsafe(
        `SELECT quote_ident(a.attname) AS name, format_type(a.atttypid, a.atttypmod) AS type,
                a.attnotnull AS notnull, pg_get_expr(ad.adbin, ad.adrelid) AS def,
                a.attgenerated = 's' AS generated, a.attidentity::text AS identity
         FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
         WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
        [`public.${t}`],
      );
      const cons = await sql.unsafe(
        `SELECT conname, contype, confrelid::regclass::text AS ref, pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conrelid = $1::regclass
         ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 ELSE 3 END, conname`,
        [`public.${t}`],
      );
      const lines = cols.map(
        (c) =>
          `  ${c.name} ${c.type}` +
          (c.def == null ? "" : c.generated ? ` GENERATED ALWAYS AS (${c.def}) STORED` : ` DEFAULT ${c.def}`) +
          (c.identity === "a" ? " GENERATED ALWAYS AS IDENTITY" : c.identity === "d" ? " GENERATED BY DEFAULT AS IDENTITY" : "") +
          (c.notnull ? " NOT NULL" : ""),
      );
      for (const c of cons) {
        if (c.contype === "f" && strip(c.ref) !== t && !emitted.has(strip(c.ref))) {
          throw new Error(`FK cycle at ${t} → ${c.ref}; emit it as a separate ALTER`);
        }
        lines.push(`  CONSTRAINT ${c.conname} ${c.def}`);
      }
      out.push(`CREATE TABLE IF NOT EXISTS public.${t} (\n${lines.join(",\n")}\n);`);
      const idx = await sql.unsafe(
        `SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
         WHERE i.indrelid = $1::regclass
           AND NOT EXISTS (SELECT 1 FROM pg_constraint x WHERE x.conindid = i.indexrelid)
         ORDER BY 1`,
        [`public.${t}`],
      );
      for (const i of idx) out.push(`${i.def.replace(/^CREATE (UNIQUE )?INDEX /, "CREATE $1INDEX IF NOT EXISTS ")};`);
      emitted.add(t);
    }
    console.log(out.join("\n\n"));
  } finally {
    await sql.end();
  }
}

if (flag("--emit-tables")) {
  if (!flag("--no-dump")) await buildProdCopy(prodDump());
  await emitTables();
  process.exit(0);
}

await buildProdCopy(prodDump());
await buildNeonSql();
const n = diff(await catalog("nuvo_drift_prod"), await catalog("nuvo_drift_neon"));
if (n) {
  console.log(`\n✗ ${n} difference(s): neon.sql does not describe production. Fix neon.sql (or prod) before migrating.`);
  console.log("  The copies stay in nuvo_drift_prod / nuvo_drift_neon for inspection.");
  process.exit(1);
}
console.log("✓ neon.sql describes production (tables, columns, constraints, indexes, enums, triggers, functions).");
