// The Worker's writes, held against production's REAL schema (D-241).
//
// The agent and MCP write recurrences and event routing through store.ts, and
// Google sync writes external_events. Each once targeted a shape only neon.sql
// had: `recurrences.rrule`, `event_domain_routing.id`, and a plain
// `external_events.recurring_event_id` (prod generates it from raw — writing it
// stopped every Google sync in prod, 2026-11-13..17). neon.sql is now generated
// from prod (scripts/schema-drift.mjs keeps it honest), so these run on PGlite
// from neon.sql by default — and on the pg_dump copy itself when given one:
//
//   node --experimental-strip-types worker/src/prodShape.check.ts
//   PROD_COPY_URL=postgres://postgres@127.0.0.1:5432/nuvo_drift_prod \
//     node --experimental-strip-types worker/src/prodShape.check.ts
//
// Everything runs in one transaction that is rolled back.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import type { Sql } from "./db.ts";
import { reconcileEvents } from "./google/eventSync.ts";
import type { EventRow } from "./lib/eventHash.ts";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { deleteOwned, getOwned, insertOwned, makeStore, updateOwned, upsertOwned } from "./store.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const U = "c0ffee00-0000-4000-8000-000000000001";
const D1 = "c0ffee00-0001-4000-8000-000000000001";
const D2 = "c0ffee00-0001-4000-8000-000000000002";
const P1 = "c0ffee00-0002-4000-8000-000000000001";
const ACCOUNT = "c0ffee00-0003-4000-8000-000000000001";

const copyUrl = process.env.PROD_COPY_URL;
let sql: Sql;
let close = async () => {};
if (copyUrl) {
  const pg = postgres(copyUrl, { max: 1, onnotice: () => {} });
  sql = pg as unknown as Sql;
  close = () => pg.end();
} else {
  const db = new PGlite();
  await applyIsolationSchema(db);
  sql = makePgliteSql(db);
}
console.log(copyUrl ? "against the pg_dump copy (PROD_COPY_URL)" : "against neon.sql on PGlite");

const ROLLBACK = new Error("rollback");

async function run(tx: Sql) {
  // --- the shape itself --------------------------------------------------
  const cols = async (table: string) =>
    (
      await tx`
        SELECT attname::text AS name, attgenerated::text AS gen FROM pg_attribute
        WHERE attrelid = ${`public.${table}`}::regclass AND attnum > 0 AND NOT attisdropped`
    ).map((r) => r as { name: string; gen: string });
  const rec = await cols("recurrences");
  ok(!rec.some((c) => c.name === "rrule"), "recurrences has no rrule (prod's rule is columns)");
  ok(["freq", "interval", "byweekday", "anchor_date"].every((n) => rec.some((c) => c.name === n)), "recurrences has freq/interval/byweekday/anchor_date");
  const routing = await cols("event_domain_routing");
  ok(!routing.some((c) => c.name === "id"), "event_domain_routing has no id");
  ok(routing.some((c) => c.name === "manual_domain_id"), "event_domain_routing has manual_domain_id");
  ok(
    (await cols("external_events")).find((c) => c.name === "recurring_event_id")?.gen === "s",
    "external_events.recurring_event_id is generated",
  );

  // --- a minimal account -------------------------------------------------
  await tx`INSERT INTO users (id, email) VALUES (${U}, 'prod-shape@example.test')`;
  await tx`INSERT INTO domains (id, user_id, name) VALUES (${D1}, ${U}, 'Work'), (${D2}, ${U}, 'Home')`;
  await tx`INSERT INTO projects (id, user_id, name, domain_id) VALUES (${P1}, ${U}, 'Launch', ${D1})`;
  const store = makeStore(tx, U);

  // --- recurrences: create / update / delete in prod's shape -------------
  const created = await insertOwned(store, "recurrences", {
    kind: "task",
    freq: "weekly",
    interval: 1,
    byweekday: [1, 3],
    anchor_date: "2026-11-17",
    title: "Standup",
    duration_minutes: 15,
    time_of_day_minutes: 540,
    project_id: P1,
    domain_id: D1,
    priority: "high",
  });
  ok(created?.freq === "weekly", "agent create recurrence: row written in prod's shape");
  ok(JSON.stringify(created?.byweekday) === "[1,3]", "…byweekday stored as int[]");
  ok(created?.priority === "high" && created?.project_id === P1, "…priority (enum) and project kept");
  const rid = String(created?.id);

  ok((await insertOwned(store, "recurrences", { kind: "task", freq: "weekly" })) === null, "create without anchor_date → null, not a 500");
  ok((await insertOwned(store, "recurrences", { kind: "task", freq: "hourly", anchor_date: "2026-11-17" })) === null, "unknown freq → null");
  ok(
    (await insertOwned(store, "recurrences", { freq: "monthly", anchor_date: "2026-11-17", bysetpos: 1, bymonthday: 3 })) === null,
    "positional + day-of-month together → null (one-day rule)",
  );

  const edited = await updateOwned(store, "recurrences", rid, {
    title: "Daily standup",
    freq: "daily",
    exdates: ["2026-11-20"],
    until_date: "2026-12-31",
    active: false,
  });
  ok(edited?.title === "Daily standup" && edited?.freq === "daily", "agent update recurrence: fields written");
  ok(Array.isArray(edited?.exdates) && (edited?.exdates as unknown[]).length === 1, "…exdates stored as date[]");
  ok(edited?.active === false, "…active written");
  ok(JSON.stringify(edited?.byweekday) === "[1,3]" && edited?.priority === "high", "…untouched fields unchanged");
  const cleared = await updateOwned(store, "recurrences", rid, { until_date: null });
  ok(cleared && cleared.until_date == null, "update can clear until_date");
  ok((await updateOwned(store, "recurrences", rid, { rrule: "FREQ=DAILY" })) === null, "an rrule patch is a no-op (prod has none)");
  ok((await updateOwned(store, "recurrences", rid, { freq: "hourly" })) === null, "update with an unknown freq → null");
  ok((await upsertOwned(store, "recurrences", { id: rid, title: "Upserted" }))?.title === "Upserted", "upsert of an owned id updates");
  ok((await deleteOwned(store, "recurrences", rid)) === 1, "delete recurrence");

  // --- routing: keyed (user_id, event_key) -------------------------------
  const routed = await insertOwned(store, "event_domain_routing", { event_key: "gcal:standup", domain_id: D1 });
  ok(routed?.event_key === "gcal:standup" && routed?.domain_id === D1, "agent routing upsert: inserted without an id");
  const manual = await upsertOwned(store, "event_domain_routing", { event_key: "gcal:standup", manual_domain_id: D2 });
  ok(manual?.manual_domain_id === D2 && manual?.domain_id === D1, "setting the person's domain keeps the model's");
  const again = await insertOwned(store, "event_domain_routing", { event_key: "gcal:standup", domain_id: D2 });
  ok(again?.domain_id === D2 && again?.manual_domain_id === D2, "re-routing upserts on (user_id, event_key)");
  ok((await getOwned(store, "event_domain_routing", "gcal:standup"))?.event_key === "gcal:standup", "get routing by event_key");
  const patched = await updateOwned(store, "event_domain_routing", "gcal:standup", { domain_id: null });
  ok(patched && patched.domain_id == null && patched.manual_domain_id === D2, "update routing by event_key");
  ok((await deleteOwned(store, "event_domain_routing", "gcal:standup")) === 1, "delete routing by event_key");

  // --- Google sync: recurring_event_id comes from raw, never written -----
  await tx`
    INSERT INTO calendar_accounts (id, user_id, provider, email, sync_direction)
    VALUES (${ACCOUNT}, ${U}, 'google', 'cal@example.test', 'two_way')`;
  const row = (title: string): EventRow => ({
    user_id: U,
    account_id: ACCOUNT,
    provider_event_id: "evt_20261117",
    calendar_id: "primary",
    title,
    start_at: "2026-11-17T17:00:00Z",
    end_at: "2026-11-17T17:15:00Z",
    all_day: false,
    location: null,
    busy: true,
    raw: { id: "evt_20261117", recurringEventId: "evt", summary: title },
    last_synced_at: "2026-11-17T12:00:00Z",
    recurring_event_id: "evt",
  });
  const scope = { accountId: ACCOUNT, userId: U };
  const first = await reconcileEvents(tx, scope, [row("Standup")], { sweep: false });
  ok(first.written === 1, "google sync: a changed event is written");
  const stored = await tx`SELECT title, recurring_event_id FROM external_events WHERE account_id = ${ACCOUNT}`;
  ok(stored[0]?.recurring_event_id === "evt", "…recurring_event_id derived from raw by production");
  await reconcileEvents(tx, scope, [row("Standup (moved)")], { sweep: false });
  const updated = await tx`SELECT title FROM external_events WHERE account_id = ${ACCOUNT}`;
  ok(updated[0]?.title === "Standup (moved)", "…and the conflict update path works too");
}

try {
  await sql.begin(async (tx) => {
    await run(tx as unknown as Sql);
    throw ROLLBACK;
  });
} catch (err) {
  if (err !== ROLLBACK) {
    fails.push(`threw: ${err instanceof Error ? err.message : String(err)}`);
  }
} finally {
  await close();
}

// --- no Worker source writes a generated column ------------------------------
// The Google paths not exercised above (events.ts upsertMapped, seriesRows.ts)
// are held by the source: `recurring_event_id` is never an insert column or a SET.
const here = dirname(fileURLToPath(import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") && !e.name.endsWith(".check.ts") ? [join(dir, e.name)] : [],
  );
for (const file of walk(here)) {
  const src = readFileSync(file, "utf8");
  const inserts = src.match(/INSERT INTO external_events\s*\([^)]*\)/g) ?? [];
  ok(!inserts.some((cols) => cols.includes("recurring_event_id")), `${file.slice(here.length + 1)}: no insert writes recurring_event_id`);
  ok(!/recurring_event_id\s*=\s*(EXCLUDED\.|\$\{)/.test(src.replace(/AND\s+\(?\s*(id = \$\{\w+\} OR )?recurring_event_id = \$\{/g, "")), `${file.slice(here.length + 1)}: no SET writes recurring_event_id`);
}

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("production-shape writes: ok");
