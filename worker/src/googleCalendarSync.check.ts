// One Google calendar must not freeze an account's others (D-243).
//
// Replays the production failure of 2026-08 → 2026-11: an account whose
// import calendars held sync tokens Google had expired. Google answered 410,
// the 410 branch's `continue` sat inside a `do … while (pageToken)` and so
// left the loop having fetched nothing, the window sweep then saw zero events
// against 59 / 317 stored ones, the mass-delete guard threw — and because the
// first throw aborted the account, no calendar after it synced and no sync
// token was ever saved. Every poll replayed the same failure.
//
// Run: node --experimental-strip-types worker/src/googleCalendarSync.check.ts
import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installOutboundFetchForTests } from "./lib/outboundFetch.ts";
import { parseTokenKeyring, sealToken } from "./secrets.ts";
import { loadGoogleAccountById } from "./google/owned.ts";
import { runGoogleSync } from "./google/sync.ts";
import { EMPTY_SWEEP_FLOOR } from "../../supabase/functions/_shared/sweepSafety.ts";
import type { Env } from "./env.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const USER = "11111111-1111-1111-1111-111111111111";
const ACCOUNT = "aaaaaaaa-eeee-4000-8000-000000000001";

const BROKEN = "broken@group.calendar.google.com"; // 500s: a blip, or worse
const EXPIRED = "expired@import.calendar.google.com"; // sync token 410s, window has events
const SMALL = "small@import.calendar.google.com"; // 410 too, under the guard's floor
const SOLO = "solo@import.calendar.google.com"; // the loop bug alone, no other calendar
const GONE = "gone@group.calendar.google.com"; // events 404 AND not in calendarList
const HIDDEN = "hidden@group.calendar.google.com"; // events 404 but still in calendarList
const PRIMARY = "me@example.test"; // first call 401s on a stale access token

const env: Env = {
  BETTER_AUTH_SECRET: "calendar-sync-secret-32-bytes-long!",
  BETTER_AUTH_URL: "http://localhost:8787",
  ENVIRONMENT: "preview",
  CRON_SECRET: "cron-secret",
  TOKEN_ENC_KEY_V1: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
  GOOGLE_CLIENT_ID: "test-google-client",
  GOOGLE_CLIENT_SECRET: "test-google-secret",
  APP_URL: "http://localhost:5717",
  CUTOVER_FLIPPED: "1",
};

const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);

const ring = await parseTokenKeyring(env);
const aad = { table: "calendar_accounts" as const, rowId: ACCOUNT, userId: USER };

const DAY = 86_400_000;
const inWindow = (i: number) => new Date(Date.now() + (i % 30) * DAY + 3_600_000).toISOString();
const ev = (id: string, i: number) => ({
  id,
  status: "confirmed",
  summary: `Event ${id}`,
  start: { dateTime: inWindow(i) },
  end: { dateTime: new Date(Date.parse(inWindow(i)) + 3_600_000).toISOString() },
});

async function seedStored(calendarId: string, ids: string[]) {
  for (const [i, id] of ids.entries()) {
    await sql`
      INSERT INTO external_events (user_id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, busy)
      VALUES (${USER}, ${ACCOUNT}, ${id}, ${calendarId}, ${"stored " + id}, ${inWindow(i)},
              ${new Date(Date.parse(inWindow(i)) + 3_600_000).toISOString()}, false, true)
    `;
  }
}

async function storedIds(calendarId: string): Promise<string[]> {
  const r = await db.query<{ provider_event_id: string }>(
    "SELECT provider_event_id FROM external_events WHERE account_id = $1 AND calendar_id = $2 ORDER BY 1",
    [ACCOUNT, calendarId],
  );
  return r.rows.map((x) => x.provider_event_id);
}

async function calendarsNow(): Promise<Array<Record<string, unknown>>> {
  const r = await db.query<{ calendars: unknown }>("SELECT calendars FROM calendar_accounts WHERE id = $1", [ACCOUNT]);
  const raw = r.rows[0]?.calendars;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as Array<Record<string, unknown>>;
}

async function accountRow(): Promise<{ sync_failures: number; needs_reconnect: boolean }> {
  const r = await db.query<{ sync_failures: number; needs_reconnect: boolean }>(
    "SELECT sync_failures, needs_reconnect FROM calendar_accounts WHERE id = $1",
    [ACCOUNT],
  );
  return r.rows[0]!;
}

async function logsSince(mark: number) {
  const r = await db.query<{ operation: string; status: string; error: string | null }>(
    "SELECT operation, status, error FROM sync_log WHERE user_id = $1 AND id > $2 ORDER BY id",
    [USER, mark],
  );
  return r.rows;
}

async function logMark(): Promise<number> {
  const r = await db.query<{ m: number | null }>("SELECT max(id)::int AS m FROM sync_log");
  return Number(r.rows[0]?.m ?? 0);
}

const cal = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  summary: id,
  color: null,
  visible: true,
  sync_token: null,
  last_synced_at: null,
  ...extra,
});

async function resetAccount(calendars: Array<Record<string, unknown>>, accessToken = "ya29.fresh") {
  const access = await sealToken(accessToken, aad, ring);
  const refresh = await sealToken("1//refresh", aad, ring, access.keyVersion);
  await sql`
    UPDATE calendar_accounts
    SET calendars = ${JSON.stringify(calendars)}::jsonb,
        access_token = NULL,
        access_token_enc = ${access.ciphertext},
        access_token_iv = ${access.iv},
        access_token_expires_at = ${"2099-01-01T00:00:00Z"},
        refresh_token_enc = ${refresh.ciphertext},
        refresh_token_iv = ${refresh.iv},
        key_version = ${access.keyVersion},
        needs_reconnect = false,
        sync_failures = 0
    WHERE id = ${ACCOUNT} AND user_id = ${USER}
  `;
}

// ── The fake Google ────────────────────────────────────────────────────────
const expiredUpstream = Array.from({ length: 40 }, (_, i) => ev(`x${i}`, i)); // x0..x39
const smallUpstream = [ev("s0", 0), ev("s1", 1), ev("s-new", 2)];
const requests: string[] = [];
let refreshes = 0;
let allBroken = false;
let brokenHeals = false;

const restore = installOutboundFetchForTests(async (input, init) => {
  const url = new URL(String(input));
  const bearer = new Headers(init?.headers).get("authorization") ?? "";
  requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
  if (url.hostname === "oauth2.googleapis.com") {
    refreshes++;
    return Response.json({ access_token: "ya29.refreshed", expires_in: 3600 });
  }
  if (url.pathname.endsWith("/channels/stop")) return new Response("", { status: 204 });
  if (url.pathname.endsWith("/events/watch")) return new Response("no", { status: 403 });

  const listed = url.pathname.match(/\/users\/me\/calendarList\/([^/]+)$/);
  if (listed) {
    const id = decodeURIComponent(listed[1]!);
    return id === GONE ? new Response("Not Found", { status: 404 }) : Response.json({ id });
  }

  const m = url.pathname.match(/\/calendars\/([^/]+)\/events$/);
  if (!m) return new Response("not mocked", { status: 599 });
  const id = decodeURIComponent(m[1]!);
  const token = url.searchParams.get("syncToken");
  if (allBroken) return new Response("backend error", { status: 503 });
  if (bearer === "Bearer ya29.stale") return new Response("Invalid Credentials", { status: 401 });

  switch (id) {
    case BROKEN:
      if (brokenHeals) return Response.json({ items: [ev("b1", 1)], nextSyncToken: "fresh-broken" });
      return new Response("backend error", { status: 500 });
    case GONE:
    case HIDDEN:
      return new Response("Not Found", { status: 404 });
    case EXPIRED:
    case SOLO:
    case SMALL: {
      if (token === "dead") return new Response("Sync token is no longer valid", { status: 410 });
      if (token) return Response.json({ items: [], nextSyncToken: token });
      ok(Boolean(url.searchParams.get("timeMin")), `${id}: the re-list after a 410 is windowed`);
      const items = id === EXPIRED ? expiredUpstream : smallUpstream;
      // Paginate the big one so the restart has to survive more than one page.
      const page = url.searchParams.get("pageToken");
      if (id === EXPIRED && !page) return Response.json({ items: items.slice(0, 25), nextPageToken: "p2" });
      if (id === EXPIRED) return Response.json({ items: items.slice(25), nextSyncToken: `fresh-${id}` });
      return Response.json({ items, nextSyncToken: `fresh-${id}` });
    }
    case PRIMARY:
      if (token) return Response.json({ items: [], nextSyncToken: token });
      return Response.json({ items: [ev("p1", 1)], nextSyncToken: "fresh-primary" });
  }
  return new Response("unknown calendar", { status: 404 });
});

// ── 0. The loop bug on its own: one calendar, an expired sync token ───────
// Under the guard's floor the old loop quietly swept the window to nothing.
await resetAccount([cal(SOLO, { sync_token: "dead" })]);
await seedStored(SOLO, ["s0", "s1"]);
await runGoogleSync(sql, env, { mode: "poll", accountId: ACCOUNT, userId: USER });
ok(
  JSON.stringify(await storedIds(SOLO)) === JSON.stringify(["s-new", "s0", "s1"]),
  `a 410 restarts the listing instead of sweeping against nothing (got ${JSON.stringify(await storedIds(SOLO))})`,
);
ok((await calendarsNow())[0]?.sync_token === `fresh-${SOLO}`, "a 410 replaces the dead sync token");

// ── 1. A mixed account: one 500, one gone, one hidden, two expired tokens, one stale access token ──
await resetAccount(
  [
    cal(BROKEN),
    cal(EXPIRED, { sync_token: "dead" }),
    cal(SMALL, { sync_token: "dead" }),
    cal(GONE, { channel_id: "ch-gone", resource_id: "res-gone" }),
    cal(HIDDEN),
    cal(PRIMARY),
  ],
  "ya29.stale",
);
// Stored: what the account held when its tokens died. x0..x29 are still
// upstream, x30-old was deleted upstream since. Above the guard's floor.
await seedStored(EXPIRED, [...Array.from({ length: 30 }, (_, i) => `x${i}`), "x30-old"]);
// Under the floor: the old loop SWEPT these to nothing on every 410.
await seedStored(SMALL, ["s0", "s1"]);
await seedStored(GONE, ["g0", "g1", "g2"]);
await seedStored(HIDDEN, ["h0", "h1"]);
ok(EMPTY_SWEEP_FLOOR > 2 && 31 >= EMPTY_SWEEP_FLOOR, "fixture straddles the mass-delete guard's floor");

let mark = await logMark();
await runGoogleSync(sql, env, { mode: "poll", accountId: ACCOUNT, userId: USER });

const expiredIds = await storedIds(EXPIRED);
ok(expiredIds.length === 40, `410 calendar re-lists its window across pages (got ${expiredIds.length} rows, want 40)`);
ok(!expiredIds.includes("x30-old"), "410 calendar: an event deleted upstream is swept by the re-list");
ok(expiredIds.includes("x39"), "410 calendar: an event added upstream lands");
const smallIds = await storedIds(SMALL);
ok(
  JSON.stringify(smallIds) === JSON.stringify(["s-new", "s0", "s1"]),
  `410 under the floor is re-listed, not wiped (got ${JSON.stringify(smallIds)})`,
);
ok((await storedIds(PRIMARY)).includes("p1"), "a 401 on a stale access token refreshes once and syncs");
ok(refreshes >= 1, "the 401 triggered a token refresh");

const after = await calendarsNow();
const byId = new Map(after.map((c) => [String(c.id), c]));
ok(!byId.has(GONE), "a calendar Google no longer lists is dropped from the account");
ok((await storedIds(GONE)).length === 0, "a dropped calendar's events go with it");
ok(requests.some((r) => r.startsWith("POST") && r.endsWith("/channels/stop")), "a dropped calendar's push channel is stopped");
ok(byId.has(HIDDEN), "a 404 on events alone does NOT drop a calendar still in the calendar list");
ok((await storedIds(HIDDEN)).length === 2, "…and keeps its events");
ok(String(byId.get(HIDDEN)?.sync_error ?? "").includes("404"), "…and records the error on the calendar");
ok(String(byId.get(BROKEN)?.sync_error ?? "").includes("500"), "a failing calendar records its own error");
ok(byId.get(EXPIRED)?.sync_token === `fresh-${EXPIRED}`, "the 410 calendar saves its new sync token");
ok(byId.get(SMALL)?.sync_token === `fresh-${SMALL}`, "the small 410 calendar saves its new sync token");
ok(byId.get(PRIMARY)?.sync_token === "fresh-primary", "a calendar AFTER the failing ones syncs and saves its token");
ok(byId.get(EXPIRED)?.sync_error == null && Boolean(byId.get(EXPIRED)?.last_synced_at), "a synced calendar has no error and a fresh last_synced_at");

const acct = await accountRow();
ok(acct.sync_failures === 0, `one bad calendar does not back the whole account off (sync_failures=${acct.sync_failures})`);
ok(acct.needs_reconnect === false, "a 401 that a refresh cures does not ask for reconnect");
let logs = await logsSince(mark);
ok(logs.some((l) => l.operation === "calendar-gone" && String(l.error).includes(GONE)), "dropping a calendar is logged");
ok(logs.filter((l) => l.status === "error" && String(l.error).includes(BROKEN)).length === 1, "the broken calendar logs one error");
ok(!logs.some((l) => String(l.error).startsWith("refusing to sweep")), "no mass-delete refusal");
ok(logs.some((l) => l.operation === "poll-sync" && l.status === "ok"), "the account run itself logs ok");

// The public status carries the per-calendar error for the client to show.
{
  const { publicGoogleAccount } = await import("./google/owned.ts");
  const loaded = await loadGoogleAccountById(sql, ACCOUNT);
  const status = loaded ? publicGoogleAccount(loaded) : null;
  const broken = status?.calendars.find((c) => c.id === BROKEN);
  ok(Boolean(broken?.sync_error) && Boolean(broken?.sync_error_at), "status exposes sync_error / sync_error_at");
}

// ── 2. The next run: a calendar that recovers clears its error ────────────
{
  const cals = await calendarsNow();
  for (const c of cals) c.last_synced_at = null; // every calendar poll-stale again
  await sql`UPDATE calendar_accounts SET calendars = ${JSON.stringify(cals)}::jsonb WHERE id = ${ACCOUNT}`;
  brokenHeals = true;
  await runGoogleSync(sql, env, { mode: "poll", accountId: ACCOUNT, userId: USER });
  brokenHeals = false;
  const healed = new Map((await calendarsNow()).map((c) => [String(c.id), c]));
  ok(healed.get(BROKEN)?.sync_error == null && healed.get(BROKEN)?.sync_error_at == null, "a calendar that syncs again clears its error");
  ok((await storedIds(BROKEN)).includes("b1"), "…and its events land");
  ok(String(healed.get(HIDDEN)?.sync_error ?? "").includes("404"), "a calendar still failing keeps its error");
}

// ── 3. Every calendar fails: the account backs off, logged once per calendar ─
await resetAccount([cal(BROKEN), cal(EXPIRED, { sync_token: `fresh-${EXPIRED}` })]);
allBroken = true;
mark = await logMark();
let threw = false;
try {
  await runGoogleSync(sql, env, { mode: "poll", accountId: ACCOUNT, userId: USER });
} catch {
  threw = true;
}
allBroken = false;
ok(!threw, "runGoogleSync still isolates a failed account from the cron");
ok((await accountRow()).sync_failures === 1, "when every calendar fails, the account backs off");
logs = await logsSince(mark);
ok(logs.filter((l) => l.status === "error").length === 2, `one error row per calendar, no duplicate account row (got ${logs.filter((l) => l.status === "error").length})`);
{
  const cals = new Map((await calendarsNow()).map((c) => [String(c.id), c]));
  ok(String(cals.get(EXPIRED)?.sync_error ?? "").includes("503"), "an all-fail run still saves each calendar's error");
}

// ── 4. A dead grant is account-wide: no per-calendar error, reconnect asked ──
await resetAccount([cal(BROKEN), cal(PRIMARY)], "ya29.stale");
const restoreDead = installOutboundFetchForTests(async (input) => {
  const url = new URL(String(input));
  if (url.hostname === "oauth2.googleapis.com") return Response.json({ error: "invalid_grant" }, { status: 400 });
  return new Response("Invalid Credentials", { status: 401 });
});
await runGoogleSync(sql, env, { mode: "poll", accountId: ACCOUNT, userId: USER });
restoreDead();
ok((await accountRow()).needs_reconnect === true, "a 401 whose refresh is invalid_grant asks the user to reconnect");
{
  const cals = await calendarsNow();
  ok(cals.every((c) => c.sync_error == null), "an auth failure is not smeared onto each calendar");
}

restore();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("google calendar sync isolation: ok");
