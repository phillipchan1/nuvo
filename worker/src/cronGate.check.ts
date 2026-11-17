// The minute cron's gate (D-239): a quiet minute runs zero SQL; due work runs.
// Run: node --experimental-strip-types worker/src/cronGate.check.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { PG_TYPES, type Sql } from "./db.ts";
import {
  applyPoke,
  applyReport,
  CAL_PULL_MS,
  CronGate,
  emptyGateState,
  FULL_RUN_CAP_MS,
  gateState,
  LEASE_MS,
  planTick,
  PUSH_HORIZON_MS,
} from "./cronGate.ts";
import { gatePokeFor } from "./gatePoke.ts";
import { MINUTE_CRON, runMinuteTick } from "./cronJobs.ts";
import { installPushFetchForTests, nextLookAt } from "./pushDispatch.ts";
import { calendarSyncInterval, googleChannelsLive } from "./google/owned.ts";
import type { Env } from "./env.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

// ── Pure state machine ──────────────────────────────────────────────────────
const T = Date.UTC(2026, 10, 16, 12, 0, 0);
{
  const first = planTick(emptyGateState(), T);
  ok(first.plan.push === "all" && first.plan.calendar, "fresh state runs everything");
  const reported = applyReport(first.state, { push: { scope: "all", next: { u1: T + 10 * 60_000, u2: null } }, calendar: { next: T + 30 * 60_000 } }, T);
  ok(reported.pushAllAt === T + FULL_RUN_CAP_MS, "a full run sets the next one a cap away");
  ok(reported.pushNext.u1 === T + 10 * 60_000 && !("u2" in reported.pushNext), "report keeps only accounts that can fire");

  const quiet = planTick(reported, T + 60_000);
  ok(quiet.plan.push === null && !quiet.plan.calendar, "nothing due → quiet minute");

  const poked = applyPoke(quiet.state, { users: ["u3"] });
  const afterPoke = planTick(poked, T + 2 * 60_000);
  ok(JSON.stringify(afterPoke.plan.push) === '["u3"]' && !afterPoke.plan.calendar, "a poke re-plans that account only");
  ok(afterPoke.state.pushNext.u3 === T + 2 * 60_000 + LEASE_MS, "a planned account is leased");
  ok(afterPoke.state.pushDirty.length === 0, "the plan clears the dirty set");
  const lost = planTick(afterPoke.state, T + 3 * 60_000);
  ok(JSON.stringify(lost.plan.push) === '["u3"]', "a lost report retries the leased account next minute");

  const due = planTick(reported, T + 10 * 60_000);
  ok(JSON.stringify(due.plan.push) === '["u1"]', "an account's own next time runs it");

  const cal = planTick(reported, T + 30 * 60_000 - CAL_PULL_MS);
  ok(cal.plan.calendar, "calendar runs inside its pull window");
  ok(!planTick(reported, T + 30 * 60_000 - CAL_PULL_MS - 60_000).plan.calendar, "…and not before");
  ok(applyPoke(reported, { calendar: true }).calNext === 0, "a calendar poke makes it due");

  const capped = planTick(reported, T + FULL_RUN_CAP_MS);
  ok(capped.plan.push === "all", "the cap re-plans everyone");
  ok(applyPoke(reported, { all: true }).pushAllAt === 0, "an unscoped poke re-plans everyone");

  const noCal = applyReport(reported, { calendar: { next: null } }, T);
  ok(noCal.calNext === T + FULL_RUN_CAP_MS, "no claimable calendar → look again at the cap");
}

// ── Next look for one account ───────────────────────────────────────────────
{
  const r = (fireAtMs: number) => ({ fireAtMs }) as never;
  ok(nextLookAt([], T, false) === T + PUSH_HORIZON_MS, "no reminders → the horizon");
  ok(PUSH_HORIZON_MS === 24 * 60 * 60_000, "horizon is window minus the longest lead (one day)");
  ok(nextLookAt([r(T - 60_000), r(T + 5 * 60_000)], T, false) === T + 5 * 60_000 + 30_000, "earliest future fire plus the dispatch lag");
  ok(nextLookAt([r(T - 10_000)], T, false) === T + 20_000, "a fire inside the lag is still ahead");
  ok(nextLookAt([r(T + 5 * 60_000)], T, true) === T + 60_000, "a transient failure retries next minute");
}

// ── Which requests poke ─────────────────────────────────────────────────────
{
  const base = { touchedDb: true, status: 200, user: "u1" };
  const p = (method: string, path: string, over: Partial<typeof base> = {}) => gatePokeFor({ ...base, ...over, method, path });
  ok(JSON.stringify(p("PATCH", "/api/rest/v1/tasks")) === '{"users":["u1"]}', "REST write pokes its account");
  ok(p("POST", "/api/rest/v1/rpc/apply_patch") !== null, "apply_patch pokes");
  ok(p("POST", "/api/rpc/apply_patch") !== null, "legacy apply_patch pokes");
  ok(p("POST", "/api/mcp") !== null && p("POST", "/api/capture") !== null && p("POST", "/api/agent") !== null, "agent, MCP and capture poke");
  ok(p("POST", "/api/rest/v1/rpc/sync_changes") === null, "the change feed does not poke");
  ok(p("POST", "/api/rpc/claim_reminder") === null, "a client claim does not poke");
  ok(p("GET", "/api/rest/v1/tasks") === null, "reads do not poke");
  ok(p("POST", "/api/rest/v1/tasks", { status: 401 }) === null, "a refused write does not poke");
  ok(p("POST", "/api/rest/v1/tasks", { status: 500 }) !== null, "a 5xx may have half-written: poke");
  ok(p("POST", "/api/rest/v1/tasks", { touchedDb: false }) === null, "no database, no write");
  ok(JSON.stringify(p("POST", "/api/google-webhook", { user: null as never })) === '{"all":true,"calendar":true}', "unknown account → everyone");
  ok(p("POST", "/api/ics-subscribe")?.calendar === true, "connecting a calendar pokes the calendar side");
  ok(p("GET", "/api/google-oauth")?.calendar === true, "an OAuth callback (GET) pokes the calendar side");
  ok(p("GET", "/api/calendar-refresh") === null, "listing accounts does not poke");
}

// ── Intervals ───────────────────────────────────────────────────────────────
{
  const live = [{ id: "c", visible: true, channel_id: "x", channel_expires_at: new Date(T + 3600_000).toISOString() }];
  const expired = [{ id: "c", visible: true, channel_id: "x", channel_expires_at: new Date(T - 1).toISOString() }];
  ok(googleChannelsLive(live, T) && !googleChannelsLive(expired, T), "live channels need an unexpired channel per visible calendar");
  ok(!googleChannelsLive([{ id: "c", visible: true }], T), "no channel → not watched");
  ok(calendarSyncInterval("google", 0, true) === 1800 && calendarSyncInterval("google", 0) === 600, "google: 30 min watched, 10 min not");
  ok(calendarSyncInterval("icloud", 0) === 900 && calendarSyncInterval("ics", 0) === 1800, "icloud 15 min, ics 30 min");
  ok(calendarSyncInterval("google", 9) === 600 * 32 && calendarSyncInterval("ics", 9) === 1800 * 32, "backoff stops doubling after five failures");
  ok(CAL_PULL_MS < calendarSyncInterval("google", 0) * 1000, "pull window is shorter than the shortest claim lease");
}

// ── Wiring ──────────────────────────────────────────────────────────────────
{
  const here = dirname(fileURLToPath(import.meta.url));
  const index = readFileSync(join(here, "index.ts"), "utf8");
  for (const prefix of ["/api/*", "/functions/v1/*"]) {
    const poke = index.indexOf(`app.use("${prefix}", pokeGate)`);
    const close = index.indexOf(`app.use("${prefix}", closeIo)`);
    ok(poke >= 0 && poke < close, `pokeGate wraps ${prefix} outside closeIo`);
  }
  ok(/export \{ CronGate \}/.test(index), "index.ts exports the Durable Object class");
  const wrangler = readFileSync(join(here, "..", "..", "wrangler.jsonc"), "utf8");
  ok((wrangler.match(/"name": "CRON_GATE", "class_name": "CronGate"/g) ?? []).length === 2, "CRON_GATE bound in production and preview");
  ok(/"new_sqlite_classes": \["CronGate"\]/.test(wrangler), "CronGate has a SQLite migration");
}

// ── A real minute tick on PGlite ────────────────────────────────────────────
const db = new PGlite({ parsers: { 1082: PG_TYPES.date_ymd.parse } });
await applyIsolationSchema(db);
const raw = makePgliteSql(db);
let statements = 0;
const sql = new Proxy(raw as object, {
  apply(target, thisArg, args) {
    statements += 1;
    return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
  },
}) as Sql;

/** In-memory DO namespace over the real class. */
function fakeNamespace() {
  const store = new Map<string, unknown>();
  const instance = new CronGate({
    storage: {
      get: async <T>(k: string) => store.get(k) as T | undefined,
      put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    },
    blockConcurrencyWhile: (fn) => fn(),
  });
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (input: string, init?: RequestInit) => {
        calls += 1;
        return instance.fetch(new Request(input, init));
      },
    }),
  };
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const now0 = Date.now();
const vapid = await (async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sub = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const subRaw = new Uint8Array(await crypto.subtle.exportKey("raw", sub.publicKey));
  return { publicKey: b64(rawKey), privateKey: jwk.d ?? "", p256dh: b64(subRaw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) };
})();

await db.query(`DELETE FROM reminders`);
await db.query(`DELETE FROM push_subscriptions`);
await db.query(`UPDATE user_settings SET reminder_prefs = $1::jsonb, time_zone = 'UTC'`, [JSON.stringify({ enabled: true, block_leads: [5] })]);
// Only A has a device; its block starts in 20 minutes (reminder at +15).
await db.query(`UPDATE tasks SET start_time = NULL, deadline = NULL, do_date = NULL`);
const startA = new Date(now0 + 20 * 60_000).toISOString();
await db.query(
  `UPDATE tasks SET status = 'planned', start_time = $1, duration_minutes = 30, title = 'A standup' WHERE id = 'aaaaaaaa-2222-4000-8000-000000000001'`,
  [startA],
);
await db.query(
  `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)`,
  ["aaaaaaaa-ffff-4000-8000-000000000001", A, "https://push.example.test/user-a", vapid.p256dh, vapid.auth],
);
// Calendars: every account synced recently, next due in 40 minutes.
await db.query(`UPDATE calendar_accounts SET next_sync_at = now() + interval '40 minutes', needs_reconnect = false`);

const posts: string[] = [];
const restoreFetch = installPushFetchForTests(async (input: string) => {
  posts.push(input);
  return new Response("", { status: 201 });
});
const sent: unknown[] = [];
const ns = fakeNamespace();
const env: Env = {
  CUTOVER_FLIPPED: "1",
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:test@nuvo.app",
  CRON_GATE: ns,
  CALENDAR_SYNC_QUEUE: { send: async (m) => void sent.push(m) },
};
let opened = 0;
const open = () => {
  opened += 1;
  return sql;
};
const tick = async (atMs: number) => {
  statements = 0;
  opened = 0;
  const out = await runMinuteTick(env, open, atMs);
  return { out, statements, opened };
};

const first = await tick(now0);
ok(first.opened === 1 && first.statements > 0, "first tick (fresh gate) runs everything");
ok(sent.length === 0, "first tick: no calendar due yet, nothing enqueued");
const s1 = await gateState(env);
ok(s1 != null && Math.abs((s1.pushNext[A] ?? 0) - (now0 + 15 * 60_000 + 30_000)) < 2000, `gate holds A's next reminder (${s1 && s1.pushNext[A] - now0})`);
ok(s1 != null && !(B in s1.pushNext), "B has no device: the gate does not watch it");
ok(s1 != null && s1.calNext > now0 + 39 * 60_000, "gate holds the calendar's next sync");

let quietMinutes = 0;
let quietStatements = 0;
let quietOpens = 0;
for (let m = 1; m <= 14; m++) {
  const t = await tick(now0 + m * 60_000);
  quietMinutes += 1;
  quietStatements += t.statements;
  quietOpens += t.opened;
}
ok(quietStatements === 0 && quietOpens === 0, `14 quiet minutes: ${quietStatements} statements, ${quietOpens} opens`);

const fire = await tick(now0 + 16 * 60_000);
ok(fire.statements > 0, "the reminder's minute runs push-dispatch");
ok(posts.length === 1 && posts[0] === "https://push.example.test/user-a", `A's reminder was sent on time (${posts.length})`);
ok(fire.out.find((r) => r.job === "calendar-dispatch")?.skipped === true, "calendar stays asleep on the reminder's minute");

const after = await tick(now0 + 17 * 60_000);
ok(after.statements === 0, "quiet again after the reminder");

// A write from the app moves B's world: a device appears and a block lands.
await db.query(
  `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)`,
  ["bbbbbbbb-ffff-4000-8000-000000000001", B, "https://push.example.test/user-b", vapid.p256dh, vapid.auth],
);
await db.query(
  `UPDATE tasks SET status = 'planned', start_time = $1, duration_minutes = 30, title = 'B block' WHERE id = 'bbbbbbbb-2222-4000-8000-000000000001'`,
  [new Date(now0 + 18 * 60_000 + 5 * 60_000 + 10_000).toISOString()],
);
const poke = gatePokeFor({ method: "PATCH", path: "/api/rest/v1/tasks", status: 204, touchedDb: true, user: B });
const { gatePoke } = await import("./cronGate.ts");
await gatePoke(env, poke!);
const poked = await tick(now0 + 18 * 60_000);
ok(poked.statements > 0 && poked.statements < first.statements, `a poke re-plans only B (${poked.statements} < ${first.statements})`);
const s2 = await gateState(env);
ok(s2 != null && typeof s2.pushNext[B] === "number", "B now has a next time");
const bFire = await tick(s2!.pushNext[B]!);
ok(posts.includes("https://push.example.test/user-b"), "B's reminder fired after the poke");

// Calendar: inside the pull window the due accounts are claimed and enqueued.
// Claims read the database clock, so this part ticks on the real one: the
// accounts fall due 3 minutes from now, and a calendar poke (a sync landed)
// makes the gate look.
await db.query(`UPDATE calendar_accounts SET next_sync_at = now() + interval '3 minutes'`);
await gatePoke(env, { calendar: true });
const realNow = Date.now();
const calTick = await tick(realNow);
const claimable = Number((await db.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM calendar_accounts WHERE provider IN ('google', 'icloud', 'ics') AND NOT needs_reconnect`,
)).rows[0]?.n);
ok(claimable > 1 && sent.length === claimable, `one wake claims every account due in the window (${sent.length}/${claimable})`);
ok(calTick.statements > 0, "calendar wake touches the database");
const s3 = await gateState(env);
ok(s3 != null && s3.calNext >= realNow + 9 * 60_000, `after the claim the gate holds the lease (${s3 && s3.calNext - realNow})`);
const nextMinute = await tick(realNow + 61_000);
ok(nextMinute.statements === 0, "the minute after a calendar wake is quiet");
void bFire;

// No gate bound: the old behaviour, every minute.
const ungated = { ...env, CRON_GATE: undefined };
statements = 0;
await runMinuteTick(ungated, open, now0 + 60 * 60_000);
ok(statements > 0, "no gate → runs ungated");

// Unflipped: neither the gate nor SQL is touched.
const before = ns.calls;
statements = 0;
opened = 0;
await runMinuteTick({ ...env, CUTOVER_FLIPPED: undefined }, open, now0);
ok(ns.calls === before && opened === 0 && statements === 0, "unflipped: no gate call, no SQL");
ok(MINUTE_CRON === "* * * * *", "minute cron expression");

restoreFetch();
await db.close();

console.log(`cronGate: ${checks - fails.length}/${checks} checks passed (${quietMinutes} quiet minutes, 0 statements)`);
if (fails.length) {
  for (const f of fails) console.error("  ✗", f);
  process.exit(1);
}
