import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// The billing copy (docs/cloudflare-cutover.md § Billing port): Supabase →
// target over the common columns, from one read-only snapshot, with
// count + md5 parity. Drives the same SQL the workflow's psql scripts run;
// only `\copy` is swapped for PGlite's COPY … '/dev/blob' (same CSV).

const ROOT = join(import.meta.dirname, "..");
const NEON_SQL = readFileSync(join(ROOT, "worker/schema/neon.sql"), "utf8");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/cutover-migrate.yml"), "utf8");
const DOC = readFileSync(join(ROOT, "docs/cloudflare-cutover.md"), "utf8");

function py(code: string, input?: unknown): string {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import sys, json; sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))}); IN = json.loads(sys.stdin.read() or 'null')\n${code}`,
    ],
    { encoding: "utf8", input: JSON.stringify(input ?? null) },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `python exited ${result.status}`);
  }
  return (result.stdout || "").trim();
}

function pyJson<T>(code: string, input?: unknown): T {
  return JSON.parse(py(code, input)) as T;
}

type Entry = { table: string; key: string; columns: string[] };
type Plan = { tables: Entry[]; legacy: Entry | null };
type Parsed = Record<string, Record<string, { n: number; hash: string | null }>>;

// Supabase shape (migrations 41, 66–70, 75), a subset of Neon's columns.
// `extraColumn` adds a Supabase-only column with data (QA2 B1: must refuse).
const SUPABASE_BILLING_DDL = `
CREATE TABLE public.subscriptions (
  user_id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  price_id TEXT,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  referral_code TEXT,
  referral_credits_earned INTEGER NOT NULL DEFAULT 0,
  referral_uses INTEGER NOT NULL DEFAULT 0,
  plan_source TEXT,
  apple_original_transaction_id TEXT,
  apple_status TEXT,
  apple_auto_renew BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.apple_webhook_events (
  event_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
const LEGACY_DDL = `
CREATE TABLE public.apple_notification_events (
  notification_uuid TEXT PRIMARY KEY,
  notification_type TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

async function seedSource(db: PGlite, { legacy = true, extraColumn = false } = {}): Promise<void> {
  await db.exec(SUPABASE_BILLING_DDL);
  if (extraColumn) await db.exec("ALTER TABLE public.subscriptions ADD COLUMN supabase_only_note TEXT");
  if (legacy) await db.exec(LEGACY_DDL);
  await db.exec(`
    INSERT INTO public.subscriptions
      (user_id, status, trial_ends_at, stripe_customer_id, price_id, created_at, updated_at,
       referral_code, plan_source, apple_status)
    VALUES
      ('${U1}', 'active', '2026-10-01T00:00:00Z', 'cus_1', 'price_m', '2026-09-01T00:00:00Z',
       '2026-11-01T10:00:00.123456Z', 'ABC, "quoted"', 'stripe', NULL),
      ('${U2}', 'trialing', '2026-11-20T00:00:00Z', NULL, NULL, '2026-11-06T00:00:00Z',
       '2026-11-06T00:00:00Z', NULL, NULL, 'active'),
      ('${U3}', 'cancelled', '2026-08-01T00:00:00Z', 'cus_3', 'price_a', '2026-07-01T00:00:00Z',
       '2026-10-15T08:30:00Z', '', 'apple', 'expired');
    INSERT INTO public.stripe_webhook_events (event_id, created_at) VALUES
      ('evt_1', '2026-11-01T00:00:00Z'), ('evt_2', '2026-11-02T00:00:00Z');
    INSERT INTO public.apple_webhook_events (event_id, created_at) VALUES
      ('apple-new-1', '2026-11-03T00:00:00Z');
  `);
  if (extraColumn) await db.exec(`UPDATE public.subscriptions SET supabase_only_note = 'drop me' WHERE user_id = '${U1}'`);
  if (legacy) {
    await db.exec(`
      INSERT INTO public.apple_notification_events (notification_uuid, notification_type, received_at) VALUES
        ('legacy-uuid-1', 'DID_RENEW', '2026-06-01T00:00:00Z'),
        ('legacy-uuid-2', 'REFUND', '2026-06-02T00:00:00Z');
    `);
  }
}

async function newTarget(): Promise<PGlite> {
  const db = new PGlite();
  const schema = py("from cutover_copy import billing_schema_sql; print(billing_schema_sql(IN))", NEON_SQL);
  await db.exec(schema);
  return db;
}

async function lines(db: PGlite, sql: string): Promise<string> {
  const results = await db.exec(sql);
  const out: string[] = [];
  for (const res of results) {
    for (const row of res.rows) {
      const first = Object.values(row as Record<string, unknown>)[0];
      if (typeof first === "string") out.push(first);
    }
  }
  return out.join("\n");
}

async function planFor(source: PGlite, target: PGlite): Promise<Plan> {
  const colsSql = py("from cutover_copy import billing_columns_sql; print(billing_columns_sql())");
  return pyJson<Plan>(
    "from cutover_copy import billing_plan, parse_billing_columns; print(json.dumps(billing_plan(parse_billing_columns(IN[0]), parse_billing_columns(IN[1]))))",
    [await lines(source, colsSql), await lines(target, colsSql)],
  );
}

type Sections = { head: string; apply: string; assert: string; commit: string };
type SqlBits = {
  session: string;
  source: string;
  begin: string;
  copies: Record<string, string>;
  srcHash: Record<string, string>;
  srcCols: Record<string, string>;
  sections: Sections;
};

function sqlFor(plan: Plan): SqlBits {
  return pyJson<SqlBits>(
    `from cutover_copy import *
entries = billing_plan_entries(IN)
print(json.dumps({
  "session": billing_session_sql(),
  "source": compose_billing_source_script(IN, {e["table"]: "/x.csv" for e in entries}),
  "begin": billing_source_begin_sql(),
  "copies": {e["table"]: billing_source_copy_query(e) for e in entries},
  "srcHash": {e["table"]: billing_source_hash_sql(e) for e in entries},
  "srcCols": {e["table"]: billing_source_column_md5_sql(e) for e in entries},
  "sections": billing_target_sections(IN),
}))`,
    plan,
  );
}

/** psql's `:'name'` interpolation + dropping backslash meta lines, for PGlite. */
function asPsql(sql: string, vars: Record<string, string>): string {
  return sql
    .split("\n")
    .filter((l) => !l.startsWith("\\"))
    .join("\n")
    .replace(/:'(\w+)'/g, (_, name: string) => {
      if (!(name in vars)) throw new Error(`psql variable ${name} not set`);
      return `'${vars[name].replaceAll("'", "''")}'`;
    });
}

type Outcome = {
  source: Parsed;
  target: Parsed;
  problems: string[];
  post_problems: string[] | null;
  column_diffs: string[];
  extra_gate: string[];
  committed: boolean;
  sqlstate: string | null;
  outcome: string;
  restore: boolean;
  fatal: string[];
};

type Run = Outcome & { plan: Plan; report: string[]; vars: string[] };

async function runBillingCopy(
  source: PGlite,
  target: PGlite,
  opts: { phase?: "copy" | "billing"; allowTargetExtra?: string; beforeAssert?: () => Promise<void> } = {},
): Promise<Run> {
  const phase = opts.phase ?? "copy";
  const plan = await planFor(source, target);
  const bits = sqlFor(plan);
  const entries = [...plan.tables, ...(plan.legacy ? [plan.legacy] : [])];

  // Source: one REPEATABLE READ READ ONLY snapshot for every copy + hash.
  await source.exec(bits.session);
  await source.exec(bits.begin);
  const csv: Record<string, string> = {};
  const srcLines: string[] = [];
  for (const entry of entries) {
    const res = await source.query(`COPY (${bits.copies[entry.table]}) TO '/dev/blob' WITH CSV`);
    csv[entry.table] = res.blob ? await res.blob.text() : "";
    srcLines.push(await lines(source, bits.srcHash[entry.table]));
    srcLines.push(await lines(source, bits.srcCols[entry.table]));
  }
  await source.exec("COMMIT");

  // The source numbers travel as psql -v variables, exactly as in the workflow.
  const vars = pyJson<string[]>(
    "from cutover_copy import billing_target_psql_vars, parse_billing_lines\nprint(json.dumps(billing_target_psql_vars(parse_billing_lines(IN[0]), IN[1], phase=IN[2])))",
    [srcLines.join("\n"), plan, phase],
  );
  const v: Record<string, string> = {};
  for (let i = 0; i < vars.length; i += 2) {
    const [k, ...rest] = vars[i + 1].split("=");
    v[k] = rest.join("=");
  }

  // Target: temp tables + expected numbers, load, one transaction, assert, commit.
  await target.exec(asPsql(bits.sections.head, v));
  for (const entry of entries) {
    const cols = entry.columns.join(", ");
    await target.query(`COPY cutover_billing_${entry.table} (${cols}) FROM '/dev/blob' WITH CSV`, [], {
      blob: new Blob([csv[entry.table]]),
    });
  }
  let out = await lines(target, bits.sections.apply);
  if (opts.beforeAssert) await opts.beforeAssert();
  let rc = 0;
  let err = "";
  try {
    await target.exec(bits.sections.assert);
    out += `\n${await lines(target, bits.sections.commit)}`;
  } catch (e) {
    rc = 3;
    err = `psql:billing-target.sql:1: ERROR:  ${(e as { code?: string }).code ?? "XX000"}`;
    await target.exec("ROLLBACK");
  }
  await target.exec("DISCARD TEMP");

  const res = pyJson<Outcome & { report: string[] }>(
    `from cutover_copy import billing_outcome, billing_report_lines
o = billing_outcome(IN["plan"], phase=IN["phase"], source_out=IN["src"], target_rc=IN["rc"],
  target_out=IN["dst"], target_err=IN["err"], allow_target_extra=IN["allow"])
o["report"] = billing_report_lines(o["source"], o["target"], IN["plan"], o["problems"], phase=IN["phase"],
  column_diffs=o["column_diffs"], outcome=o["outcome"], post_problems=o["post_problems"], backup_sha256="0" * 64)
o.pop("fingerprints")
print(json.dumps(o))`,
    { src: srcLines.join("\n"), dst: out, rc, err, plan, phase, allow: opts.allowTargetExtra ?? null },
  );
  return { plan, vars, ...res };
}

async function count(db: PGlite, sql: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(sql);
  return Number(rows[0]?.n);
}

/** Whole-table fingerprint of the target's billing tables (what a rollback must preserve). */
async function snapshot(db: PGlite): Promise<string> {
  await db.exec("SET TIME ZONE 'UTC'");
  return lines(db, py("from cutover_copy import billing_fingerprint_sql; print(billing_fingerprint_sql('now'))"));
}


const meta = (cols: [string, boolean, boolean][]) =>
  cols.map(([name, nullable, has_default]) => ({ name, nullable, has_default }));

const FULL_PLAN: Plan = {
  tables: [
    { table: "subscriptions", key: "user_id", columns: ["user_id", "status", "updated_at"] },
    { table: "stripe_webhook_events", key: "event_id", columns: ["event_id", "created_at"] },
    { table: "apple_webhook_events", key: "event_id", columns: ["event_id", "created_at"] },
  ],
  legacy: { table: "apple_notification_events", key: "notification_uuid", columns: ["notification_uuid", "received_at"] },
};

function composed(plan: Plan): [string, string] {
  const files = Object.fromEntries(
    [...plan.tables, ...(plan.legacy ? [plan.legacy] : [])].map((e) => [e.table, `/tmp/run/billing-${e.table}.csv`]),
  );
  return pyJson<[string, string]>(
    "from cutover_copy import compose_billing_source_script, compose_billing_target_script\nprint(json.dumps([compose_billing_source_script(IN[0], IN[1]), compose_billing_target_script(IN[0], IN[1])]))",
    [plan, files],
  );
}

describe("billing copy SQL builders", () => {
  it("keeps billing out of pg_dump and the frozen snapshot", () => {
    const out = py(
      "from cutover_copy import dump_exclude_args, skipped_from_copy, BILLING_TABLES\nprint(dump_exclude_args()); print(all(skipped_from_copy(t) for t in BILLING_TABLES))",
    );
    for (const t of ["subscriptions", "stripe_webhook_events", "apple_webhook_events", "apple_notification_events"]) {
      expect(out).toContain(`--exclude-table=public.${t}`);
    }
    expect(out.split("\n")[1]).toBe("True");
  });

  it("intersects columns in target order and refuses an unfillable NOT NULL", () => {
    const common = pyJson<string[]>(
      "from cutover_copy import billing_common_columns; print(json.dumps(billing_common_columns('subscriptions', IN[0], IN[1])))",
      [
        meta([
          ["updated_at", false, true],
          ["user_id", false, false],
          ["status", false, true],
        ]),
        meta([
          ["user_id", false, false],
          ["status", false, true],
          ["updated_at", false, true],
          ["neon_nullable", true, false],
          ["neon_defaulted", false, true],
        ]),
      ],
    );
    expect(common).toEqual(["user_id", "status", "updated_at"]);

    const refuse = (src: unknown, dst: unknown) =>
      py(
        "from cutover_copy import billing_common_columns, BillingCopyError\ntry:\n  billing_common_columns('subscriptions', IN[0], IN[1]); print('ok')\nexcept BillingCopyError as e:\n  print(e)",
        [src, dst],
      );
    expect(
      refuse(
        meta([["user_id", false, false], ["updated_at", false, true]]),
        meta([["user_id", false, false], ["updated_at", false, true], ["trial_ends_at", false, false]]),
      ),
    ).toMatch(/trial_ends_at is NOT NULL without a default/);
    expect(refuse(meta([["updated_at", false, true]]), meta([["user_id", false, false], ["updated_at", false, true]]))).toMatch(
      /user_id must exist on both sides/,
    );
    expect(refuse(meta([["user_id", false, false]]), meta([["user_id", false, false], ["updated_at", false, true]]))).toMatch(
      /updated_at must exist on both sides/,
    );
    expect(refuse(meta([["user_id", false, false]]), [])).toMatch(/target is missing public\.subscriptions/);
  });

  it("B1: refuses a source-only column unless it is on the reviewed drop-list, and reports dropped names", () => {
    const src = meta([["user_id", false, false], ["updated_at", false, true], ["stripe_price_lookup", true, false]]);
    const dst = meta([["user_id", false, false], ["updated_at", false, true]]);
    const attempt = (dropList: Record<string, string[]> | null) =>
      py(
        `from cutover_copy import billing_common_columns, BillingCopyError
drops = None if IN[2] is None else {k: frozenset(v) for k, v in IN[2].items()}
try:
  print(billing_common_columns('subscriptions', IN[0], IN[1], drop_list=drops))
except BillingCopyError as e:
  print('refused:', e)`,
        [src, dst, dropList],
      );
    expect(attempt(null)).toMatch(/^refused: source subscriptions has column\(s\) the target lacks: stripe_price_lookup/);
    expect(attempt({ subscriptions: ["something_else"] })).toMatch(/^refused:.*stripe_price_lookup/);
    expect(attempt({ subscriptions: ["stripe_price_lookup"] })).toBe("['user_id', 'updated_at']");

    // The shipped drop-list is exactly the reviewed legacy type column.
    expect(
      py("from cutover_copy import BILLING_DROPPED_SOURCE_COLUMNS as D\nprint({k: sorted(v) for k, v in D.items()})"),
    ).toBe("{'apple_notification_events': ['notification_type']}");

    const both = (t: string, cols: [string, boolean, boolean][]) => ({ [t]: meta(cols) });
    const base = {
      ...both("subscriptions", [["user_id", false, false], ["updated_at", false, true]]),
      ...both("stripe_webhook_events", [["event_id", false, false], ["created_at", false, true]]),
      ...both("apple_webhook_events", [["event_id", false, false], ["created_at", false, true]]),
    };
    const legacyPlan = (legacyCols: [string, boolean, boolean][]) =>
      py(
        `from cutover_copy import billing_plan, billing_dropped_columns, BillingCopyError
try:
  print(billing_dropped_columns(billing_plan(IN[0], IN[1])))
except BillingCopyError as e:
  print('refused:', e)`,
        [{ ...base, apple_notification_events: meta(legacyCols) }, base],
      );
    expect(
      legacyPlan([["notification_uuid", false, false], ["notification_type", true, false], ["received_at", false, true]]),
    ).toBe("['apple_notification_events.notification_type']");
    expect(legacyPlan([["notification_uuid", false, false], ["bundle_id", true, false]])).toMatch(
      /^refused: source apple_notification_events has column\(s\) the target lacks: bundle_id/,
    );
  });

  it("S6: reads columns from pg_catalog (attnum > 0, not dropped), not information_schema", () => {
    const sql = py("from cutover_copy import billing_columns_sql; print(billing_columns_sql())");
    expect(sql).toMatch(/FROM pg_catalog\.pg_attribute a/);
    expect(sql).toMatch(/JOIN pg_catalog\.pg_class c/);
    expect(sql).toMatch(/JOIN pg_catalog\.pg_namespace n/);
    expect(sql).toMatch(/a\.attnum > 0 AND NOT a\.attisdropped/);
    expect(sql).not.toMatch(/information_schema/);
  });

  it("S6: pg_catalog sees a column the reader has no privilege on, and skips dropped columns", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE TABLE public.subscriptions (user_id uuid PRIMARY KEY, gone text, updated_at timestamptz NOT NULL DEFAULT now(), secret_col text);
      ALTER TABLE public.subscriptions DROP COLUMN gone;
      CREATE ROLE billing_reader;
      GRANT SELECT (user_id, updated_at) ON public.subscriptions TO billing_reader;
      SET ROLE billing_reader;
    `);
    const cols = pyJson<Record<string, { name: string }[]>>(
      "from cutover_copy import parse_billing_columns; print(json.dumps(parse_billing_columns(IN)))",
      await lines(db, py("from cutover_copy import billing_columns_sql; print(billing_columns_sql())")),
    );
    expect(cols.subscriptions.map((c) => c.name)).toEqual(["user_id", "updated_at", "secret_col"]);
    const viaInfoSchema = await count(
      db,
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'subscriptions'",
    );
    expect(viaInfoSchema).toBe(2);
  });

  it("builds a read-only one-snapshot source script (S3: VERBOSITY sqlstate first)", () => {
    const [src] = composed(FULL_PLAN);
    const srcLines = src.trim().split("\n");
    expect(srcLines[0]).toBe("\\set VERBOSITY sqlstate");
    expect(srcLines).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
    expect(srcLines.at(-1)).toBe("COMMIT;");
    const copyLines = srcLines.filter((l) => l.startsWith("\\copy"));
    expect(copyLines).toHaveLength(4);
    const beginAt = srcLines.indexOf("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
    for (const l of copyLines) expect(srcLines.indexOf(l)).toBeGreaterThan(beginAt);
    expect(copyLines[0]).toBe(
      "\\copy (SELECT user_id, status, updated_at FROM public.subscriptions ORDER BY user_id) TO '/tmp/run/billing-subscriptions.csv' WITH CSV",
    );
    expect(src).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(src).toMatch(/SET TIME ZONE 'UTC'/);
    // Every printed line is a count + md5 or a column name + md5.
    for (const line of srcLines.filter((l) => l.startsWith("SELECT '"))) {
      expect(line).toMatch(/^SELECT 'billing(_colmd5\|src\|\w+\|\w+\|' \|\| md5\(|\|src\|\w+\|' \|\| COUNT\(\*\))/);
    }
  });

  it("B2: the target script asserts parity inside the transaction, before COMMIT", () => {
    const [, dst] = composed(FULL_PLAN);
    expect(dst).toMatch(/^\\set VERBOSITY sqlstate/);
    // Source numbers arrive as psql variables, never inlined.
    for (const t of ["subscriptions", "stripe_webhook_events", "apple_webhook_events", "apple_notification_events"]) {
      expect(dst).toContain(`('${t}', :'src_${t}_n', :'src_${t}_md5')`);
    }
    expect(dst).toContain("CREATE TEMP TABLE cutover_billing_opts AS SELECT :'billing_phase'::text AS phase");
    const at = (needle: string) => {
      const i = dst.indexOf(needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    const begin = at("\nBEGIN;");
    const commit = at("\nCOMMIT;");
    expect(dst.indexOf("COMMIT;", commit + 2)).toBe(-1); // exactly one COMMIT
    expect(at("SET LOCAL lock_timeout = '10s'")).toBeGreaterThan(begin);
    expect(at("LOCK TABLE public.subscriptions, public.stripe_webhook_events, public.apple_webhook_events IN SHARE ROW EXCLUSIVE MODE")).toBeGreaterThan(begin);
    const assertAt = at("DO $cutover_billing_assert$");
    expect(assertAt).toBeGreaterThan(at("INSERT INTO cutover_billing_check"));
    expect(assertAt).toBeLessThan(commit);
    expect(at("billing_fp|pre|")).toBeLessThan(at("billing|written|"));
    expect(at("billing_fp|post|")).toBeLessThan(commit);
    expect(at("billing_committed|yes")).toBeGreaterThan(commit);
    expect(at("SELECT 'billing_post|'")).toBeGreaterThan(commit);
    for (const code of ["NVB00", "NVB01", "NVB02", "NVB03", "NVB04", "NVB05", "NVB06"]) {
      expect(dst).toContain(`RAISE EXCEPTION USING ERRCODE = '${code}'`);
    }
    expect(dst).not.toMatch(/RAISE EXCEPTION '/); // SQLSTATE only, never message text

    // S7: the trigger is toggled around the subscriptions upsert only (ledgers first).
    expect(dst).toContain("ON CONFLICT (user_id) DO UPDATE SET");
    expect(dst).toContain("WHERE EXCLUDED.updated_at > t.updated_at");
    expect(dst).not.toMatch(/user_id = EXCLUDED\.user_id/);
    expect(dst.match(/ON CONFLICT \(event_id\) DO NOTHING/g)).toHaveLength(3);
    expect(dst).toContain("SELECT s.notification_uuid, COALESCE(s.received_at, now())");
    const off = at("DISABLE TRIGGER subscriptions_set_updated_at");
    const on = at("ENABLE TRIGGER subscriptions_set_updated_at");
    expect(off).toBeGreaterThan(at("billing|written|stripe_webhook_events"));
    expect(off).toBeGreaterThan(at("billing|written|apple_notification_events"));
    expect(off).toBeLessThan(at("billing|written|subscriptions"));
    expect(on).toBeGreaterThan(at("billing|written|subscriptions"));
    expect(on).toBeLessThan(assertAt);
    expect(dst).not.toMatch(/session_replication_role/);
    // Legacy ledger goes in after the real Apple ledger, so a shared id keeps its own created_at.
    expect(at("billing|written|apple_webhook_events")).toBeLessThan(at("billing|written|apple_notification_events"));
  });

  it("passes source numbers as -v name=value and refuses a missing source line", () => {
    const h = "a".repeat(32);
    const src = Object.fromEntries(
      ["subscriptions", "stripe_webhook_events", "apple_webhook_events", "apple_notification_events"].map((t) => [
        t,
        { src: { n: 2, hash: h } },
      ]),
    );
    const vars = pyJson<string[]>(
      "from cutover_copy import billing_target_psql_vars\nprint(json.dumps(billing_target_psql_vars(IN[0], IN[1], phase='billing')))",
      [src, FULL_PLAN],
    );
    expect(vars.slice(0, 4)).toEqual(["-v", "billing_phase=billing", "-v", "src_subscriptions_n=2"]);
    expect(vars).toContain(`src_apple_notification_events_md5=${h}`);
    const refuse = (s: unknown, phase = "copy") =>
      py(
        "from cutover_copy import billing_target_psql_vars, BillingCopyError\ntry:\n  billing_target_psql_vars(IN[0], IN[1], phase=IN[2]); print('ok')\nexcept BillingCopyError as e:\n  print(e)",
        [s, FULL_PLAN, phase],
      );
    const { apple_notification_events: _gone, ...partial } = src;
    expect(refuse(partial)).toBe("no source count/md5 line for apple_notification_events");
    expect(refuse({ ...src, subscriptions: { src: { n: 2, hash: "zz" } } })).toBe("no source count/md5 line for subscriptions");
    expect(refuse(src, "resync")).toMatch(/billing phase must be one of copy, billing/);
  });

  it("S5: extracts the billing DDL between its markers and refuses a missing or duplicated marker", () => {
    const ddl = py("from cutover_copy import billing_schema_sql; print(billing_schema_sql(IN))", NEON_SQL);
    expect(ddl).toMatch(/^CREATE OR REPLACE FUNCTION public\.set_updated_at\(\)/);
    for (const t of ["subscriptions", "stripe_webhook_events", "apple_webhook_events"]) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`);
    }
    expect(ddl).toContain("subscriptions_set_updated_at");
    expect(ddl.trimEnd().endsWith("-- End of billing (the Worker port).")).toBe(true);
    expect(ddl).not.toMatch(/public\.tasks|public\.domains/);

    const attempt = (text: string) =>
      py(
        "from cutover_copy import billing_schema_sql, BillingCopyError\ntry:\n  print(billing_schema_sql(IN))\nexcept BillingCopyError as e:\n  print('refused:', e)",
        text,
      );
    expect(attempt("CREATE TABLE x (id int);")).toMatch(/billing section not found/);
    // Non-billing DDL appended after the end marker is never applied.
    const appended = `${NEON_SQL}\nCREATE TABLE public.not_billing (id int);\n`;
    expect(attempt(appended)).not.toMatch(/not_billing/);
    const end = "-- End of billing (the Worker port).";
    expect(attempt(NEON_SQL.replace(end, "-- (end marker removed)"))).toMatch(/refused: neon\.sql billing section has no end marker/);
    expect(attempt(`${NEON_SQL}\n${end}\n`)).toMatch(/refused: neon\.sql billing markers must each appear exactly once/);
    expect(attempt(`${NEON_SQL}\n-- Billing (the Worker port, again)\n`)).toMatch(/exactly once/);
  });

  it("parity mirror: passes on equal, fails on a load, content, missing, newer or (copy) extra mismatch", () => {
    const h = (c: string) => c.repeat(32);
    const plan: Plan = {
      tables: [{ table: "subscriptions", key: "user_id", columns: ["user_id", "updated_at"] }],
      legacy: { table: "apple_notification_events", key: "notification_uuid", columns: ["notification_uuid"] },
    };
    const src = {
      subscriptions: { src: { n: 3, hash: h("a") } },
      apple_notification_events: { src: { n: 2, hash: h("c") } },
    };
    const good = {
      subscriptions: {
        load: { n: 3, hash: h("a") },
        cmp: { n: 3, hash: h("a") },
        dst: { n: 3, hash: h("a") },
        missing: { n: 0, hash: null },
        newer: { n: 0, hash: null },
        extra: { n: 0, hash: null },
      },
      apple_notification_events: { load: { n: 2, hash: h("c") }, missing: { n: 0, hash: null } },
    };
    const check = (dst: unknown, allow = false) =>
      pyJson<string[]>(
        "from cutover_copy import billing_parity_problems\nprint(json.dumps(billing_parity_problems(IN[0], IN[1], IN[2], allow_target_newer=IN[3])))",
        [src, dst, plan, allow],
      );
    expect(check(good)).toEqual([]);
    const tweak = (patch: (d: typeof good) => void) => {
      const d = structuredClone(good);
      patch(d);
      return d;
    };
    expect(check(tweak((d) => (d.subscriptions.load = { n: 3, hash: h("b") })))[0]).toMatch(
      /subscriptions: loaded 3\/b+ != source snapshot 3\/a+/,
    );
    expect(check(tweak((d) => (d.subscriptions.dst = { n: 3, hash: h("b") })))).toEqual([
      expect.stringMatching(/subscriptions: target 3\/b+ != source 3\/a+ over the source keys/),
    ]);
    expect(check(tweak((d) => (d.apple_notification_events.missing = { n: 1, hash: null })))).toEqual([
      "apple_notification_events: 1 source key(s) missing on target",
    ]);
    const newer = tweak((d) => {
      d.subscriptions.cmp = { n: 2, hash: h("d") };
      d.subscriptions.dst = { n: 2, hash: h("d") };
      d.subscriptions.newer = { n: 1, hash: null };
    });
    expect(check(newer)).toEqual([expect.stringMatching(/1 target row\(s\) newer than source/)]);
    expect(check(newer, true)).toEqual([]);
    expect(check(tweak((d) => {
      d.subscriptions.cmp = { n: 2, hash: h("d") };
      d.subscriptions.dst = { n: 2, hash: h("d") };
    }), true)).toEqual([expect.stringMatching(/compared 2 \+ target_newer 0 != loaded 3/)]);
    // S2: rows only on the target are fatal in phase=copy, not in phase=billing.
    const extra = tweak((d) => (d.subscriptions.extra = { n: 2, hash: null }));
    expect(check(extra)).toEqual(["subscriptions: 2 target row(s) not on source (phase=copy: target must equal source)"]);
    expect(check(extra, true)).toEqual([]);
    expect(check(tweak((d) => delete (d.subscriptions as Partial<typeof d.subscriptions>).extra))).toEqual([
      "subscriptions: no target_extra count",
    ]);
  });

  it("S1: phase=billing target_extra on subscriptions fails until allow_target_extra matches", () => {
    const gate = (n: number | null, allow: string | null, phase = "billing") =>
      pyJson<string[]>(
        "from cutover_copy import billing_target_extra_gate\nprint(json.dumps(billing_target_extra_gate(IN[0], phase=IN[2], allow_target_extra=IN[1])))",
        [n === null ? {} : { subscriptions: { extra: { n, hash: null } } }, allow, phase],
      );
    expect(gate(0, null)).toEqual([]);
    expect(gate(2, null)).toEqual([expect.stringMatching(/^subscriptions: target_extra 2 not reviewed \(allow_target_extra=unset\)/)]);
    expect(gate(2, "1")).toHaveLength(1);
    expect(gate(2, " 2 ")).toEqual([]);
    expect(gate(5, null, "copy")).toEqual([]); // phase=copy: the in-txn rule already refuses
    expect(gate(null, "2")).toEqual(["subscriptions: no target_extra count"]);
  });

  it("the in-transaction assert raises the right bare SQLSTATE for each broken rule", async () => {
    const db = new PGlite();
    const assertSql = py("from cutover_copy import billing_assert_sql; print(billing_assert_sql(IN))", {
      tables: [{ table: "subscriptions", key: "user_id", columns: ["user_id"] }],
      legacy: null,
    });
    const h = (c: string) => c.repeat(32);
    type Row = [string, number, string | null];
    const base: Row[] = [
      ["load", 3, h("a")],
      ["cmp", 2, h("b")],
      ["dst", 2, h("b")],
      ["newer", 1, null],
      ["missing", 0, null],
      ["extra", 0, null],
    ];
    const run = async (phase: string, rows: Row[], expect_: [number, string] = [3, h("a")]) => {
      await db.exec(`
        DROP TABLE IF EXISTS cutover_billing_opts, cutover_billing_expect, cutover_billing_check;
        CREATE TEMP TABLE cutover_billing_opts AS SELECT '${phase}'::text AS phase;
        CREATE TEMP TABLE cutover_billing_expect (tbl text PRIMARY KEY, n bigint NOT NULL, md5 text NOT NULL);
        INSERT INTO cutover_billing_expect VALUES ('subscriptions', ${expect_[0]}, '${expect_[1]}');
        CREATE TEMP TABLE cutover_billing_check (tbl text, kind text, n bigint, md5 text);
        INSERT INTO cutover_billing_check VALUES ${rows
          .map(([k, n, m]) => `('subscriptions', '${k}', ${n}, ${m === null ? "NULL" : `'${m}'`})`)
          .join(", ")};
      `);
      try {
        await db.exec(assertSql);
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    const set = (kind: string, n: number, md5: string | null = null) =>
      base.map((r): Row => (r[0] === kind ? [kind, n, md5] : r));
    expect(await run("billing", base)).toBe("ok");
    expect(await run("copy", base)).toBe("NVB04"); // newer outside phase=billing
    expect(await run("resync", base)).toBe("NVB00");
    expect(await run("billing", base, [3, "not-an-md5"])).toBe("NVB00");
    expect(await run("billing", base, [4, h("a")])).toBe("NVB01");
    expect(await run("billing", set("load", 3, h("z")))).toBe("NVB01");
    expect(await run("billing", set("missing", 1))).toBe("NVB02");
    expect(await run("billing", set("dst", 2, h("c")))).toBe("NVB03");
    expect(await run("billing", set("newer", 0))).toBe("NVB05");
    expect(await run("billing", set("extra", 4))).toBe("ok");
    expect(await run("copy", set("newer", 0).map((r): Row => (r[0] === "cmp" || r[0] === "dst" ? [r[0], 3, h("b")] : r)))).toBe("ok");
    expect(
      await run(
        "copy",
        set("newer", 0).map((r): Row => (r[0] === "cmp" || r[0] === "dst" ? [r[0], 3, h("b")] : r[0] === "extra" ? ["extra", 1, null] : r)),
      ),
    ).toBe("NVB06");
  });
});

describe.sequential("billing copy on PGlite", { timeout: 120_000 }, () => {
  it("copies Supabase → Neon over the common columns with parity, and maps the legacy Apple ledger", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);

    const run = await runBillingCopy(source, target);
    expect(run.fatal).toEqual([]);
    expect(run.committed).toBe(true);
    expect(run.outcome).toBe("passed; committed");
    expect(run.post_problems).toEqual([]);
    expect(run.plan.tables[0].columns).toContain("updated_at");
    expect(run.plan.tables[0].columns).not.toContain("referral_last_use_at");
    expect(run.target.subscriptions.written.n).toBe(3);
    expect(run.target.stripe_webhook_events.written.n).toBe(2);
    expect(run.target.apple_webhook_events.written.n).toBe(1);
    expect(run.target.apple_notification_events.written.n).toBe(2);
    expect(run.target.apple_webhook_events.extra.n).toBe(0);
    expect(run.target.subscriptions.dst).toEqual(run.source.subscriptions.src);

    // Copied updated_at survives: the BEFORE UPDATE stamp was off for the copy, and is back on.
    const stamp = await target.query<{ u: string }>(
      `SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS u FROM public.subscriptions WHERE user_id = '${U1}'`,
    );
    expect(stamp.rows[0]?.u).toBe("2026-11-01T10:00:00.123456");
    const trig = await target.query<{ e: string }>(
      "SELECT tgenabled AS e FROM pg_trigger WHERE tgname = 'subscriptions_set_updated_at'",
    );
    expect(trig.rows[0]?.e).toBe("O");
    // Empty string and NULL stay distinct through the CSV.
    expect(await count(target, `SELECT count(*)::int AS n FROM public.subscriptions WHERE referral_code = ''`)).toBe(1);

    const legacy = await target.query<{ event_id: string; c: string }>(
      `SELECT event_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS c
       FROM public.apple_webhook_events WHERE event_id LIKE 'legacy-%' ORDER BY event_id`,
    );
    expect(legacy.rows).toEqual([
      { event_id: "legacy-uuid-1", c: "2026-06-01" },
      { event_id: "legacy-uuid-2", c: "2026-06-02" },
    ]);

    const report = run.report.join("\n");
    expect(report).toMatch(/## Billing copy \(phase=copy\)/);
    expect(report).toMatch(/\| subscriptions \| 3 \| [0-9a-f]{32} \| 3 \| 3 \| [0-9a-f]{32} \| 0 \| 0 \| 0 \| yes \|/);
    expect(report).toContain("- dropped source columns (reviewed drop-list): apple_notification_events.notification_type");
    // S8 + S1: named, reviewed numbers — not just table cells.
    expect(report).toContain(
      "- billing target_newer (reviewed; Neon newer wins, kept): subscriptions=0, stripe_webhook_events=0, apple_webhook_events=0",
    );
    expect(report).toContain(
      "- billing WARNING target_extra (on target, not on source; never deleted): subscriptions=0, stripe_webhook_events=0, apple_webhook_events=0",
    );
    expect(report).toContain("- in-transaction parity: passed; committed");
    expect(report).toContain("- post-commit re-check: ok");
    expect(report).toMatch(/- target pre-write backup: sha256=0{64} \(runner temp only, never uploaded\)/);
    expect(report).not.toContain(U1);
    expect(report).not.toMatch(/cus_|evt_|legacy-uuid/);
    expect(report).toMatch(/billing mismatches: 0/);
  });

  it("B1: a Supabase-only column with data refuses the run before anything is written", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source, { extraColumn: true });
    const before = await snapshot(target);
    await expect(runBillingCopy(source, target)).rejects.toThrow(
      /source subscriptions has column\(s\) the target lacks: supabase_only_note/,
    );
    expect(await snapshot(target)).toBe(before);
  });

  it("re-runs idempotently: ledgers DO NOTHING, subscriptions write nothing when nothing is newer", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);
    await runBillingCopy(source, target);
    const before = await count(target, "SELECT count(*)::int AS n FROM public.apple_webhook_events");

    const again = await runBillingCopy(source, target, { phase: "billing" });
    expect(again.fatal).toEqual([]);
    for (const t of ["subscriptions", "stripe_webhook_events", "apple_webhook_events", "apple_notification_events"]) {
      expect(again.target[t].written.n).toBe(0);
    }
    expect(await count(target, "SELECT count(*)::int AS n FROM public.apple_webhook_events")).toBe(before);
  });

  it("newer wins, older loses (the post-switch delta); phase=copy refuses the same state in-txn", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);
    await runBillingCopy(source, target);

    // After the switch: Supabase changes U1 (old app build), the Worker changes U3 on Neon,
    // and a webhook lands on Supabase before the Stripe URL moved.
    await source.exec(`
      UPDATE public.subscriptions SET status = 'past_due', updated_at = '2026-11-10T00:00:00Z' WHERE user_id = '${U1}';
      UPDATE public.subscriptions SET status = 'active', updated_at = '2026-11-10T00:00:00Z' WHERE user_id = '${U3}';
      INSERT INTO public.stripe_webhook_events (event_id, created_at) VALUES ('evt_3', '2026-11-10T00:00:00Z');
    `);
    await target.exec(`
      ALTER TABLE public.subscriptions DISABLE TRIGGER subscriptions_set_updated_at;
      UPDATE public.subscriptions SET status = 'cancelled', updated_at = '2026-11-11T00:00:00Z' WHERE user_id = '${U3}';
      ALTER TABLE public.subscriptions ENABLE TRIGGER subscriptions_set_updated_at;
    `);

    // Before the flip a newer target row aborts the whole transaction: nothing lands.
    const before = await snapshot(target);
    const strict = await runBillingCopy(source, target, { phase: "copy" });
    expect(strict.sqlstate).toBe("NVB04");
    expect(strict.committed).toBe(false);
    expect(strict.restore).toBe(false);
    expect(strict.fatal[0]).toMatch(/aborted before COMMIT — target unchanged \(SQLSTATE NVB04/);
    expect(strict.problems).toEqual([expect.stringMatching(/subscriptions: 1 target row\(s\) newer than source/)]);
    expect(await snapshot(target)).toBe(before);

    const delta = await runBillingCopy(source, target, { phase: "billing" });
    expect(delta.fatal).toEqual([]);
    expect(delta.target.subscriptions.newer.n).toBe(1);
    expect(delta.target.stripe_webhook_events.written.n).toBe(1); // the strict run rolled back
    expect(delta.report.join("\n")).toContain(
      "- billing target_newer (reviewed; Neon newer wins, kept): subscriptions=1, stripe_webhook_events=0, apple_webhook_events=0",
    );
    const rows = await target.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM public.subscriptions WHERE user_id IN ('${U1}', '${U3}') ORDER BY user_id`,
    );
    expect(rows.rows).toEqual([
      { user_id: U1, status: "past_due" }, // source newer → copied
      { user_id: U3, status: "cancelled" }, // target newer → kept
    ]);
  });

  it("B2: same key + updated_at but different content aborts in-txn; the target is unchanged (S4: names the columns)", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);
    // A stale Neon row at the same updated_at: the upsert won't overwrite it.
    await target.exec(`INSERT INTO public.subscriptions (user_id, status, trial_ends_at, price_id, updated_at, created_at, apple_status)
      VALUES ('${U2}', 'trialing', '2026-11-20T00:00:00Z', 'price_tampered', '2026-11-06T00:00:00Z', '2026-11-06T00:00:00Z', 'active')`);
    const before = await snapshot(target);

    const run = await runBillingCopy(source, target);
    expect(run.sqlstate).toBe("NVB03");
    expect(run.committed).toBe(false);
    expect(run.problems).toEqual([expect.stringMatching(/^subscriptions: target 3\/[0-9a-f]{32} != source 3\//)]);
    expect(run.column_diffs).toEqual(["subscriptions.price_id differs (target vs source over the source keys)"]);
    expect(run.report.join("\n")).toMatch(/\| subscriptions \|.*\| NO \|/);
    expect(run.report.join("\n")).toContain("- column differences: subscriptions.price_id differs");
    expect(run.report.join("\n")).toMatch(/in-transaction parity: aborted before COMMIT \(SQLSTATE NVB03\), target unchanged/);
    // Nothing committed: not the 2 other subscriptions, not the 2 ledgers, not the trigger toggle.
    expect(await snapshot(target)).toBe(before);
    expect(await count(target, "SELECT count(*)::int AS n FROM public.stripe_webhook_events")).toBe(0);
    const trig = await target.query<{ e: string }>("SELECT tgenabled AS e FROM pg_trigger WHERE tgname = 'subscriptions_set_updated_at'");
    expect(trig.rows[0]?.e).toBe("O");
  });

  it("B2: a write landing between the upsert and the assert is caught before COMMIT", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);
    const before = await snapshot(target);
    const run = await runBillingCopy(source, target, {
      beforeAssert: async () => {
        // Same transaction, after the checks were taken: the assert reads the check table,
        // so tamper with what the check recorded to prove the assert is what gates COMMIT.
        await target.exec("UPDATE cutover_billing_check SET n = n + 1 WHERE tbl = 'stripe_webhook_events' AND kind = 'dst'");
      },
    });
    expect(run.sqlstate).toBe("NVB03");
    expect(await snapshot(target)).toBe(before);
  });

  it("S2: rows only on the target are fatal in phase=copy (whole txn rolls back)", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);
    await runBillingCopy(source, target);
    await target.exec(`INSERT INTO public.subscriptions (user_id, trial_ends_at) VALUES ('44444444-4444-4444-8444-444444444444', now());
      INSERT INTO public.stripe_webhook_events (event_id) VALUES ('evt_stale');`);
    await source.exec("INSERT INTO public.stripe_webhook_events (event_id) VALUES ('evt_new')");
    const before = await snapshot(target);
    const run = await runBillingCopy(source, target, { phase: "copy" });
    expect(run.sqlstate).toBe("NVB06");
    expect(run.problems).toEqual([
      "subscriptions: 1 target row(s) not on source (phase=copy: target must equal source)",
      "stripe_webhook_events: 1 target row(s) not on source (phase=copy: target must equal source)",
    ]);
    expect(await snapshot(target)).toBe(before); // evt_new did not land
  });

  it("S1: phase=billing keeps a Supabase-deleted row, applies the delta, and fails until allow_target_extra matches", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);
    await runBillingCopy(source, target);
    await source.exec(`DELETE FROM public.subscriptions WHERE user_id = '${U3}';
      UPDATE public.subscriptions SET status = 'past_due', updated_at = '2026-11-10T00:00:00Z' WHERE user_id = '${U1}';`);
    await target.exec("INSERT INTO public.stripe_webhook_events (event_id) VALUES ('evt_neon_born')");

    const run = await runBillingCopy(source, target, { phase: "billing" });
    expect(run.committed).toBe(true);
    expect(run.restore).toBe(false);
    expect(run.target.subscriptions.written.n).toBe(1); // the delta landed
    expect(run.target.subscriptions.extra.n).toBe(1);
    expect(run.target.stripe_webhook_events.extra.n).toBe(1); // Worker ledger id: warning only
    expect(run.extra_gate).toEqual([expect.stringMatching(/^subscriptions: target_extra 1 not reviewed/)]);
    expect(run.fatal).toEqual(run.extra_gate);
    expect(run.report.join("\n")).toContain(
      "- billing WARNING target_extra (on target, not on source; never deleted): subscriptions=1, stripe_webhook_events=1, apple_webhook_events=0",
    );
    expect(await count(target, `SELECT count(*)::int AS n FROM public.subscriptions WHERE user_id = '${U3}'`)).toBe(1);

    const reviewed = await runBillingCopy(source, target, { phase: "billing", allowTargetExtra: "1" });
    expect(reviewed.fatal).toEqual([]);
  });

  it("skips the legacy ledger cleanly when the source has no apple_notification_events", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source, { legacy: false });
    const run = await runBillingCopy(source, target);
    expect(run.plan.legacy).toBeNull();
    expect(run.fatal).toEqual([]);
    expect(run.target.apple_notification_events).toBeUndefined();
    expect(run.report.join("\n")).toMatch(/apple_notification_events: not on source, skipped/);
    expect(run.report.join("\n")).toContain("- dropped source columns (reviewed drop-list): none");
  });

  it("outcome: a passing assert with disagreeing lines, or a failed re-check, arms the restore", () => {
    const o = (rc: number, out: string, err = "") =>
      pyJson<{ restore: boolean; fatal: string[]; committed: boolean }>(
        `from cutover_copy import billing_outcome
o = billing_outcome(IN[0], phase="copy", source_out=IN[1], target_rc=IN[2], target_out=IN[3], target_err=IN[4])
print(json.dumps({k: o[k] for k in ("restore", "fatal", "committed")}))`,
        [{ tables: [], legacy: null }, "", rc, out, err],
      );
    expect(o(3, "", "psql:f:1: ERROR:  NVB03")).toEqual({
      restore: false,
      committed: false,
      fatal: [expect.stringMatching(/aborted before COMMIT — target unchanged \(SQLSTATE NVB03: target rows over the source keys/)],
    });
    expect(o(0, "").fatal).toEqual(["target script finished without the billing_committed line"]);
    const committedNoFp = o(0, "billing_committed|yes");
    expect(committedNoFp.fatal).toEqual(["missing billing_fp line (pre/post fingerprint)"]);
  });

  it("restore script: guarded by the post-commit fingerprint, checked against the pre-write one", () => {
    const script = py("from cutover_copy import compose_billing_restore_script; print(compose_billing_restore_script('/tmp/x/billing-target-backup.sql'))");
    const at = (n: string) => script.indexOf(n);
    expect(script.startsWith("\\set VERBOSITY sqlstate")).toBe(true);
    expect(at("LOCK TABLE public.subscriptions, public.stripe_webhook_events, public.apple_webhook_events IN EXCLUSIVE MODE")).toBeGreaterThan(at("BEGIN;"));
    expect(at("ERRCODE = 'NVB10'")).toBeLessThan(at("DELETE FROM public.subscriptions;"));
    expect(at("\\i '/tmp/x/billing-target-backup.sql'")).toBeGreaterThan(at("DELETE FROM public.apple_webhook_events;"));
    expect(at("ERRCODE = 'NVB11'")).toBeGreaterThan(at("\\i "));
    expect(at("COMMIT;")).toBeGreaterThan(at("ERRCODE = 'NVB11'"));
    expect(script).toContain(":'fp_post_subscriptions_md5'");
    expect(script).toContain(":'fp_pre_apple_webhook_events_n'");
  });
});

describe("billing copy wiring", () => {
  const fn = WORKFLOW.slice(WORKFLOW.indexOf("def cmd_billing()"), WORKFLOW.indexOf("def cmd_billing_restore()"));
  const step = (id: string) => {
    const at = WORKFLOW.indexOf(`      - id: ${id}\n`);
    expect(at, id).toBeGreaterThan(0);
    const next = WORKFLOW.indexOf("\n      - id: ", at + 10);
    return WORKFLOW.slice(at, next < 0 ? undefined : next);
  };

  it("runs the billing copy in phase=copy after verify and alone in phase=billing", () => {
    expect(WORKFLOW).toMatch(/- billing\n/);
    expect(WORKFLOW).toMatch(/def cmd_billing\(\)/);
    expect(fn).toMatch(/compose_billing_source_script/);
    expect(fn).toMatch(/compose_billing_target_script/);
    expect(fn).toMatch(/billing_outcome\(/);
    const billing = step("billing");
    expect(billing).toMatch(/cutover\.py" billing 2>&1 \| tee "\$\{CUTOVER_LOG_DIR\}\/billing\.log"/);
    expect(billing).toMatch(/if: \$\{\{ inputs\.phase == 'billing' \|\| steps\.verify\.outcome == 'success' \}\}/);
    expect(billing).toMatch(/VERIFY_OUTCOME: \$\{\{ steps\.verify\.outcome \}\}/);
    // W5: set +x, and the log check runs on this step's own output.
    expect(billing).toMatch(/\n {10}set \+x\n/);
    expect(billing).toMatch(/node scripts\/guard-public-ci\.mjs --check-log "\$CUTOVER_LOG_DIR"/);
    const billingAt = WORKFLOW.indexOf("id: billing\n");
    expect(billingAt).toBeGreaterThan(WORKFLOW.indexOf("id: verify\n"));
    expect(WORKFLOW.indexOf("id: billing-restore\n")).toBeGreaterThan(billingAt);
    expect(WORKFLOW.indexOf("id: billing-restore\n")).toBeLessThan(WORKFLOW.indexOf("id: assert-logs\n"));
    for (const id of ["pick-dump", "dump", "restore", "verify", "seal-tokens"]) {
      expect(step(id)).toMatch(/if: \$\{\{ \(inputs\.phase \|\| 'copy'\) == 'copy' \}\}/);
    }
    expect(step("billing-restore")).toMatch(/if: \$\{\{ failure\(\) && steps\.billing\.outcome == 'failure' \}\}/);
    expect(step("billing-restore")).toMatch(/\n {10}set \+x\n/);
  });

  it("W1: source reads are read-only, psql -X -q -tA ON_ERROR_STOP -f, CSVs only under CUTOVER_DUMP_DIR, shredded", () => {
    expect(WORKFLOW).toMatch(/return \["psql", "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1"\]/);
    expect(fn).toMatch(/src_out = run\(billing_psql_file\(\) \+ \["-d", source, "-f", str\(src_script\)\], source=True\)/);
    expect(fn).toMatch(/psql\(source, cols_sql, source=True, extra=\["-X", "-tA"\]\)/);
    expect(WORKFLOW).toMatch(/env\["PGOPTIONS"\] = "-c default_transaction_read_only=on"/);
    expect(fn).toMatch(/work = dump_dir\(\)/);
    expect(fn).toMatch(/str\(work \/ f"billing-\{entry\['table'\]\}\.csv"\)/);
    expect(fn).toMatch(/for path in scratch:\n\s+shred_file\(path\)/);
    expect(step("shred")).toContain("-name 'billing-*.csv'");
    expect(step("shred")).toContain("-name 'billing-target-backup.sql'");
  });

  it("W2: guards — copy after verify, billing only cutover+confirm, dry-run scratch only, no Supabase target", () => {
    const guard = WORKFLOW.slice(WORKFLOW.indexOf("def billing_guard("), WORKFLOW.indexOf("def billing_report("));
    expect(guard).toMatch(/phase == "copy" and \(os\.environ\.get\("VERIFY_OUTCOME"\) or ""\) != "success"/);
    expect(guard).toMatch(/phase == "billing" and \(mode != "cutover" or confirm != "CUTOVER nuvo" or kind != "neon"\)/);
    expect(guard).toMatch(/dry-run refuses a SCRATCH_DATABASE_URL that is TARGET_DATABASE_URL/);
    expect(guard).toMatch(/is_supabase_host\(url_host_db\(target\)\[0\]\)/);
    expect(guard).not.toMatch(/die\(f".*\{target\}/); // never echoes a DSN
    expect(fn.indexOf("billing_guard(phase)")).toBeLessThan(fn.indexOf("psql("));
    expect(WORKFLOW).toMatch(/environment: nuvo-cutover/);
    expect(WORKFLOW).toMatch(/if phase == "billing" and mode != "cutover":/);
    const host = (h: string) => py("from cutover_copy import is_supabase_host; print(is_supabase_host(IN))", h);
    expect(host("db.abcdefgh.supabase.co")).toBe("True");
    expect(host("aws-0-us-east-1.pooler.supabase.com")).toBe("True");
    expect(host("SUPABASE.CO.")).toBe("True");
    expect(host("ep-x.us-east-2.aws.neon.tech")).toBe("False");
    expect(host("notsupabase.com")).toBe("False");
  });

  it("W3: pg_dumps the target billing rows to runner temp before writing, sha256 in the report, never uploaded", () => {
    const dumpAt = fn.indexOf('"pg_dump", "--data-only"');
    expect(dumpAt).toBeGreaterThan(0);
    expect(dumpAt).toBeLessThan(fn.indexOf("run_capture("));
    expect(fn).toMatch(/backup = work \/ "billing-target-backup\.sql"/);
    expect(fn).toMatch(/backup_sha = sha256_file\(backup\)/);
    expect(fn).toMatch(/backup_sha256=backup_sha/);
    expect(fn).toMatch(/billing target backup sha256=\{backup_sha\}/);
    expect(WORKFLOW).toMatch(/ALLOWED_UPLOAD_ARTIFACT_PATHS|path: artifacts\/cutover-report\.md/);
    expect(WORKFLOW.match(/uses: actions\/upload-artifact/g)).toHaveLength(1);
  });

  it("W4/W6: fails on any fatal outcome; allow_target_newer only in phase=billing", () => {
    expect(fn).toMatch(/if result\["fatal"\]:\n\s+.*\n\s+die\(/);
    expect(fn).toMatch(/die\(f"billing copy refused, wrote nothing: \{exc\}"\)/);
    const allow = py(
      "import inspect, cutover_copy as c\nsrc = inspect.getsource(c.billing_outcome)\nprint('allow_newer = phase == \"billing\"' in src)",
    );
    expect(allow).toBe("True");
  });

  it("the doc covers parity-in-txn, the drop-list, the delete policy, the backup and the lock", () => {
    const port = DOC.slice(DOC.indexOf("## Billing port"));
    expect(port).not.toMatch(/separate `psql \\copy` out/);
    expect(port).toMatch(/phase=billing/);
    expect(port).toMatch(/BILLING_DROPPED_SOURCE_COLUMNS/);
    expect(port).toMatch(/before `COMMIT`/);
    expect(port).toMatch(/allow_target_extra/);
    expect(port).toMatch(/sha256/);
    expect(port).toMatch(/SHARE ROW EXCLUSIVE/);
    expect(DOC).toMatch(/### Post-flip debt/);
    expect(DOC).toMatch(/set_updated_at/);
  });
});
