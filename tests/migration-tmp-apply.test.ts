import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const APPLY_DB = "migration_tmp_apply";
const FIXTURE = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_reader') THEN
    CREATE ROLE migration_reader NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  raw_user_meta_data jsonb,
  email text,
  email_confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  leftover text
);
CREATE TABLE auth.identities (
  id uuid PRIMARY KEY,
  user_id uuid,
  provider text,
  identity_data jsonb,
  provider_id text,
  created_at timestamptz,
  updated_at timestamptz
);
CREATE TABLE auth.refresh_tokens (id uuid PRIMARY KEY);
CREATE TABLE auth.sessions (id uuid PRIMARY KEY);
CREATE TABLE auth.one_time_tokens (id uuid PRIMARY KEY);
CREATE TABLE auth.mfa_factors (id uuid PRIMARY KEY);
CREATE TABLE auth.flow_state (id uuid PRIMARY KEY);
CREATE TABLE auth.sso_providers (id uuid PRIMARY KEY);

GRANT SELECT ON auth.users, auth.identities, auth.refresh_tokens, auth.sessions,
  auth.one_time_tokens, auth.mfa_factors, auth.flow_state TO migration_reader;
GRANT SELECT (id, email, leftover) ON auth.users TO migration_reader;

CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (
  id uuid PRIMARY KEY,
  decrypted_secret text
);
CREATE TABLE public.calendar_accounts (
  id uuid PRIMARY KEY,
  user_id uuid,
  refresh_token_secret_id uuid
);
CREATE TABLE public.apple_identities (
  user_id uuid PRIMARY KEY,
  refresh_token_secret_id uuid
);
CREATE TABLE public.activity_sources (
  id uuid PRIMARY KEY,
  user_id uuid,
  token_secret_id uuid
);
`;

function resolveAdminUrl(): string {
  const explicit = (process.env.DATABASE_URL || process.env.CUTOVER_APPLY_TEST_DB || "").trim();
  if (explicit) return explicit;
  if (process.env.GITHUB_ACTIONS) {
    return "postgresql://postgres:postgres@127.0.0.1:5432/nuvo";
  }
  return "";
}

function withDb(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.href;
}

function extractCleanupSql(sql: string): string {
  const lines: string[] = [];
  let copying = false;
  for (const line of sql.split("\n")) {
    if (line === "--   BEGIN;") copying = true;
    if (!copying) continue;
    if (!line.startsWith("--")) {
      throw new Error(`cleanup comment broke at: ${line}`);
    }
    lines.push(line.replace(/^--   /, "").replace(/^-- /, ""));
    if (line === "--   COMMIT;") break;
  }
  if (lines[0] !== "BEGIN;" || lines[lines.length - 1] !== "COMMIT;") {
    throw new Error("cleanup block must be BEGIN; … COMMIT;");
  }
  return lines.join("\n");
}

const REMAINING_READER_GRANTS_SQL = `
SELECT
  (SELECT COUNT(*)::bigint
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL aclexplode(c.relacl) e
   JOIN pg_roles r ON r.oid = e.grantee
   WHERE n.nspname = 'auth' AND r.rolname = 'migration_reader')
  +
  (SELECT COUNT(*)::bigint
   FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL aclexplode(a.attacl) e
   JOIN pg_roles r ON r.oid = e.grantee
   WHERE n.nspname = 'auth'
     AND a.attnum > 0 AND NOT a.attisdropped
     AND r.rolname = 'migration_reader') AS n,
  has_schema_privilege('migration_reader', 'auth', 'USAGE') AS usage
`;

const adminUrl = resolveAdminUrl();
const required = Boolean(process.env.GITHUB_ACTIONS);
const describeApply = adminUrl || required ? describe : describe.skip;

describeApply("applies migration_tmp.sql and vault_tokens.sql on Postgres", () => {
  let admin: Client | undefined;
  let db: Client | undefined;

  beforeAll(async () => {
    if (!adminUrl) {
      throw new Error("DATABASE_URL is required in CI to apply migration_tmp.sql");
    }
    admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 8000 });
    try {
      await admin.connect();
    } catch (err) {
      if (required) throw err;
      throw new Error(
        `Postgres apply harness is unreachable at ${adminUrl}: ${err instanceof Error ? err.message : err}`,
      );
    }
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [APPLY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${APPLY_DB}`);
    await admin.query(`CREATE DATABASE ${APPLY_DB}`);
    db = new Client({ connectionString: withDb(adminUrl, APPLY_DB), connectionTimeoutMillis: 8000 });
    await db.connect();
    await db.query(FIXTURE);
    const usersAcl = await db.query<{ attacl: unknown }>(
      "SELECT attacl FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth' AND c.relname = 'users' AND a.attname = 'raw_user_meta_data'",
    );
    expect(usersAcl.rows[0]?.attacl).toBeNull();
  }, 30_000);

  afterAll(async () => {
    if (db) await db.end().catch(() => undefined);
    if (admin) {
      await admin
        .query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [APPLY_DB],
        )
        .catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${APPLY_DB}`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it("applies both files twice against NULL auth ACLs", async () => {
    if (!db) throw new Error("apply database is not connected");
    const authSql = readFileSync(join(ROOT, "docs/cloudflare-migration/migration_tmp.sql"), "utf8");
    const vaultSql = readFileSync(join(ROOT, "docs/cloudflare-migration/vault_tokens.sql"), "utf8");
    expect(authSql).not.toMatch(/COALESCE\([^;]*aclitem\[\]/);
    await db.query(authSql);
    await db.query(vaultSql);
    await db.query(authSql);
    await db.query(vaultSql);

    const fns = await db.query<{ proname: string; proconfig: string[] | null }>(
      `SELECT p.proname, p.proconfig
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'migration_tmp'
         AND p.proname IN ('auth_users', 'auth_identities', 'vault_tokens')
       ORDER BY 1`,
    );
    expect(fns.rows.map((r) => r.proname)).toEqual(["auth_identities", "auth_users", "vault_tokens"]);
    for (const row of fns.rows) {
      expect(row.proconfig).toContain("search_path=pg_catalog, pg_temp");
    }

    const counts = await db.query<{ t: string; n: string }>(
      `SELECT 'auth_users' AS t, COUNT(*)::bigint AS n FROM migration_tmp.auth_users()
       UNION ALL
       SELECT 'auth_identities', COUNT(*) FROM migration_tmp.auth_identities()
       UNION ALL
       SELECT 'vault_tokens', COUNT(*) FROM migration_tmp.vault_tokens()`,
    );
    expect(counts.rows).toEqual([
      { t: "auth_users", n: "0" },
      { t: "auth_identities", n: "0" },
      { t: "vault_tokens", n: "0" },
    ]);

    const grants = await db.query<{ n: string }>("SELECT COUNT(*)::bigint AS n FROM migration_tmp.auth_grants");
    expect(Number(grants.rows[0]?.n)).toBeGreaterThan(0);

    await db.query("DROP TABLE auth.flow_state");
    const cleanup = extractCleanupSql(authSql);
    try {
      await db.query(cleanup);
      await db.query(cleanup);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      expect(code).not.toBe("42501");
      throw err;
    }

    const leftover = await db.query<{ n: string; usage: boolean }>(REMAINING_READER_GRANTS_SQL);
    expect(leftover.rows[0]?.n).toBe("0");
    expect(leftover.rows[0]?.usage).toBe(false);
    const schema = await db.query<{ n: string }>(
      "SELECT COUNT(*)::bigint AS n FROM pg_namespace WHERE nspname = 'migration_tmp'",
    );
    expect(schema.rows[0]?.n).toBe("0");
  });
});
