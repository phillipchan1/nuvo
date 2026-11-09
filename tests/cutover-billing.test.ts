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

// Supabase shape (migrations 41, 66–70, 75): subscriptions carries a column
// Neon does not have, to prove the intersection drops it.
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
  apple_auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  supabase_only_note TEXT
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

async function seedSource(db: PGlite, { legacy = true } = {}): Promise<void> {
  await db.exec(SUPABASE_BILLING_DDL);
  if (legacy) await db.exec(LEGACY_DDL);
  await db.exec(`
    INSERT INTO public.subscriptions
      (user_id, status, trial_ends_at, stripe_customer_id, price_id, created_at, updated_at,
       referral_code, plan_source, apple_status, supabase_only_note)
    VALUES
      ('${U1}', 'active', '2026-10-01T00:00:00Z', 'cus_1', 'price_m', '2026-09-01T00:00:00Z',
       '2026-11-01T10:00:00.123456Z', 'ABC, "quoted"', 'stripe', NULL, 'drop me'),
      ('${U2}', 'trialing', '2026-11-20T00:00:00Z', NULL, NULL, '2026-11-06T00:00:00Z',
       '2026-11-06T00:00:00Z', NULL, NULL, 'active', ''),
      ('${U3}', 'cancelled', '2026-08-01T00:00:00Z', 'cus_3', 'price_a', '2026-07-01T00:00:00Z',
       '2026-10-15T08:30:00Z', '', 'apple', 'expired', NULL);
    INSERT INTO public.stripe_webhook_events (event_id, created_at) VALUES
      ('evt_1', '2026-11-01T00:00:00Z'), ('evt_2', '2026-11-02T00:00:00Z');
    INSERT INTO public.apple_webhook_events (event_id, created_at) VALUES
      ('apple-new-1', '2026-11-03T00:00:00Z');
  `);
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

type SqlBits = {
  session: string;
  begin: string;
  copies: Record<string, string>;
  srcHash: Record<string, string>;
  prepare: string;
  apply: string;
  parity: string;
};

function sqlFor(plan: Plan): SqlBits {
  return pyJson<SqlBits>(
    `from cutover_copy import *
entries = billing_plan_entries(IN)
print(json.dumps({
  "session": billing_session_sql(),
  "begin": billing_source_begin_sql(),
  "copies": {e["table"]: billing_source_copy_query(e) for e in entries},
  "srcHash": {e["table"]: billing_source_hash_sql(e) for e in entries},
  "prepare": billing_target_prepare_sql(IN),
  "apply": billing_apply_txn_sql(IN),
  "parity": billing_target_parity_sql(IN),
}))`,
    plan,
  );
}

type Run = {
  plan: Plan;
  source: Parsed;
  target: Parsed;
  problems: string[];
  report: string[];
};

async function runBillingCopy(
  source: PGlite,
  target: PGlite,
  opts: { phase?: "copy" | "billing"; beforeParity?: () => Promise<void> } = {},
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
  }
  await source.exec("COMMIT");

  // Target: temp tables typed like the target, load, one transaction, parity.
  await target.exec(bits.session);
  await target.exec(bits.prepare);
  for (const entry of entries) {
    const cols = entry.columns.join(", ");
    await target.query(`COPY cutover_billing_${entry.table} (${cols}) FROM '/dev/blob' WITH CSV`, [], {
      blob: new Blob([csv[entry.table]]),
    });
  }
  const applied = await lines(target, bits.apply);
  if (opts.beforeParity) await opts.beforeParity();
  const parity = await lines(target, bits.parity);
  await target.exec("DISCARD TEMP");

  const out = pyJson<{ source: Parsed; target: Parsed; problems: string[]; report: string[] }>(
    `from cutover_copy import parse_billing_lines, billing_parity_problems, billing_report_lines
src = parse_billing_lines(IN["src"])
dst = parse_billing_lines(IN["dst"])
problems = billing_parity_problems(src, dst, IN["plan"], allow_target_newer=IN["phase"] == "billing")
print(json.dumps({"source": src, "target": dst, "problems": problems,
  "report": billing_report_lines(src, dst, IN["plan"], problems, phase=IN["phase"])}))`,
    { src: srcLines.join("\n"), dst: `${applied}\n${parity}`, plan, phase },
  );
  return { plan, ...out };
}

async function count(db: PGlite, sql: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(sql);
  return Number(rows[0]?.n);
}

describe("billing copy SQL builders", () => {
  const meta = (cols: [string, boolean, boolean][]) =>
    cols.map(([name, nullable, has_default]) => ({ name, nullable, has_default }));

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
          ["supabase_only", true, false],
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

  it("builds a read-only one-snapshot source script and a newer-wins target script", () => {
    const plan: Plan = {
      tables: [
        { table: "subscriptions", key: "user_id", columns: ["user_id", "status", "updated_at"] },
        { table: "stripe_webhook_events", key: "event_id", columns: ["event_id", "created_at"] },
        { table: "apple_webhook_events", key: "event_id", columns: ["event_id", "created_at"] },
      ],
      legacy: { table: "apple_notification_events", key: "notification_uuid", columns: ["notification_uuid", "received_at"] },
    };
    const files = Object.fromEntries(
      [...plan.tables, plan.legacy!].map((e) => [e.table, `/tmp/run/billing-${e.table}.csv`]),
    );
    const [src, dst] = pyJson<[string, string]>(
      "from cutover_copy import compose_billing_source_script, compose_billing_target_script\nprint(json.dumps([compose_billing_source_script(IN[0], IN[1]), compose_billing_target_script(IN[0], IN[1])]))",
      [plan, files],
    );
    const srcLines = src.trim().split("\n");
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

    expect(dst).toMatch(/^\\set VERBOSITY sqlstate/);
    expect(dst).toContain("ON CONFLICT (user_id) DO UPDATE SET");
    expect(dst).toContain("WHERE EXCLUDED.updated_at > t.updated_at");
    expect(dst).not.toMatch(/user_id = EXCLUDED\.user_id/);
    expect(dst.match(/ON CONFLICT \(event_id\) DO NOTHING/g)).toHaveLength(3);
    expect(dst).toContain("INSERT INTO public.apple_webhook_events AS t (event_id, created_at)");
    expect(dst).toContain("SELECT s.notification_uuid, COALESCE(s.received_at, now())");
    expect(dst).toContain("DISABLE TRIGGER subscriptions_set_updated_at");
    expect(dst.indexOf("DISABLE TRIGGER")).toBeLessThan(dst.indexOf("ENABLE TRIGGER"));
    expect(dst.indexOf("ENABLE TRIGGER")).toBeLessThan(dst.indexOf("COMMIT;"));
    expect(dst).toContain("SET LOCAL lock_timeout = '10s'");
    // Legacy ledger goes in after the real Apple ledger, so a shared id keeps its own created_at.
    expect(dst.indexOf("billing|written|apple_webhook_events")).toBeLessThan(
      dst.indexOf("billing|written|apple_notification_events"),
    );
    // Every parity line is counts + hashes; no column of a row is ever selected bare.
    for (const line of dst.split("\n").filter((l) => l.startsWith("SELECT 'billing|"))) {
      expect(line).toMatch(/^SELECT 'billing\|(load|cmp|dst|newer|missing|extra|written)\|\w+\|' \|\| (COUNT\(\*\)|'0\|-')/);
    }
  });

  it("extracts the billing DDL from neon.sql and refuses a file without it", () => {
    const ddl = py("from cutover_copy import billing_schema_sql; print(billing_schema_sql(IN))", NEON_SQL);
    expect(ddl).toMatch(/^CREATE OR REPLACE FUNCTION public\.set_updated_at\(\)/);
    for (const t of ["subscriptions", "stripe_webhook_events", "apple_webhook_events"]) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`);
    }
    expect(ddl).toContain("subscriptions_set_updated_at");
    expect(ddl).not.toMatch(/public\.tasks|public\.domains/);
    expect(
      py(
        "from cutover_copy import billing_schema_sql, BillingCopyError\ntry:\n  billing_schema_sql('CREATE TABLE x (id int);'); print('ok')\nexcept BillingCopyError as e:\n  print(e)",
      ),
    ).toMatch(/billing section not found/);
  });

  it("parity: passes on equal, fails on a load, content, missing or newer mismatch", () => {
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
    // Accounting: a compared set that silently drops rows is caught.
    expect(check(tweak((d) => {
      d.subscriptions.cmp = { n: 2, hash: h("d") };
      d.subscriptions.dst = { n: 2, hash: h("d") };
    }), true)).toEqual([expect.stringMatching(/compared 2 \+ target_newer 0 != loaded 3/)]);
  });
});

describe.sequential("billing copy on PGlite", { timeout: 120_000 }, () => {
  it("copies Supabase → Neon over the common columns with parity, and maps the legacy Apple ledger", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);

    const run = await runBillingCopy(source, target);
    expect(run.problems).toEqual([]);
    expect(run.plan.tables[0].columns).not.toContain("supabase_only_note");
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
    expect(report).not.toContain(U1);
    expect(report).not.toMatch(/cus_|evt_|legacy-uuid/);
    expect(report).toMatch(/billing mismatches: 0/);
  });

  it("re-runs idempotently: ledgers DO NOTHING, subscriptions write nothing when nothing is newer", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);
    await runBillingCopy(source, target);
    const before = await count(target, "SELECT count(*)::int AS n FROM public.apple_webhook_events");

    const again = await runBillingCopy(source, target, { phase: "billing" });
    expect(again.problems).toEqual([]);
    for (const t of ["subscriptions", "stripe_webhook_events", "apple_webhook_events", "apple_notification_events"]) {
      expect(again.target[t].written.n).toBe(0);
    }
    expect(await count(target, "SELECT count(*)::int AS n FROM public.apple_webhook_events")).toBe(before);
  });

  it("newer wins, older loses (the post-switch delta)", async () => {
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
      INSERT INTO public.subscriptions (user_id, trial_ends_at) VALUES ('44444444-4444-4444-8444-444444444444', now());
    `);

    // Before the flip a newer target row is a failure.
    const strict = await runBillingCopy(source, target, { phase: "copy" });
    expect(strict.problems).toEqual([expect.stringMatching(/subscriptions: 1 target row\(s\) newer than source/)]);

    const delta = await runBillingCopy(source, target, { phase: "billing" });
    expect(delta.problems).toEqual([]);
    expect(delta.target.subscriptions.newer.n).toBe(1);
    expect(delta.target.subscriptions.extra.n).toBe(1);
    expect(delta.target.stripe_webhook_events.written.n).toBe(0); // the strict run already landed it
    const rows = await target.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM public.subscriptions WHERE user_id IN ('${U1}', '${U3}') ORDER BY user_id`,
    );
    expect(rows.rows).toEqual([
      { user_id: U1, status: "past_due" }, // source newer → copied
      { user_id: U3, status: "cancelled" }, // target newer → kept
    ]);
    expect(await count(target, "SELECT count(*)::int AS n FROM public.stripe_webhook_events WHERE event_id = 'evt_3'")).toBe(1);
  });

  it("fails parity when a target row differs at the same updated_at, or a ledger key is gone", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source);
    await runBillingCopy(source, target);

    // Same updated_at, different content: the upsert will not overwrite it, parity must notice.
    await target.exec(`ALTER TABLE public.subscriptions DISABLE TRIGGER subscriptions_set_updated_at;
      UPDATE public.subscriptions SET price_id = 'price_tampered' WHERE user_id = '${U2}';
      ALTER TABLE public.subscriptions ENABLE TRIGGER subscriptions_set_updated_at;`);
    const tampered = await runBillingCopy(source, target, { phase: "billing" });
    expect(tampered.problems).toEqual([expect.stringMatching(/^subscriptions: target 3\/[0-9a-f]{32} != source 3\//)]);
    expect(tampered.report.join("\n")).toMatch(/\| subscriptions \|.*\| NO \|/);

    const gone = await runBillingCopy(source, target, {
      phase: "billing",
      beforeParity: async () => {
        await target.exec("DELETE FROM public.apple_webhook_events WHERE event_id = 'legacy-uuid-1'");
        await target.exec("DELETE FROM public.stripe_webhook_events WHERE event_id = 'evt_1'");
      },
    });
    expect(gone.problems).toEqual(
      expect.arrayContaining([
        "stripe_webhook_events: 1 source key(s) missing on target",
        "apple_notification_events: 1 source key(s) missing on target",
      ]),
    );
  });

  it("skips the legacy ledger cleanly when the source has no apple_notification_events", async () => {
    const source = new PGlite();
    const target = await newTarget();
    await seedSource(source, { legacy: false });
    const run = await runBillingCopy(source, target);
    expect(run.plan.legacy).toBeNull();
    expect(run.problems).toEqual([]);
    expect(run.target.apple_notification_events).toBeUndefined();
    expect(run.report.join("\n")).toMatch(/apple_notification_events: not on source, skipped/);
  });
});

describe("billing copy wiring", () => {
  // The workflow-wiring test ships with the cutover-migrate.yml change (held: needs a workflow-scoped push).
  it("the doc replaces the hand-run \\copy with the scripted copy", () => {
    const port = DOC.slice(DOC.indexOf("## Billing port"));
    expect(port).not.toMatch(/separate `psql \\copy` out/);
    expect(port).toMatch(/phase=billing/);
    expect(DOC).toMatch(/### Post-flip debt/);
    expect(DOC).toMatch(/set_updated_at/);
  });
});
