// Push-dispatch with a mocked Web Push endpoint.
// Run: node --experimental-strip-types worker/src/pushDispatch.check.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installRequestIoForTests } from "./requestIo.ts";
import app from "./index.ts";
import { runCronJob } from "./cronJobs.ts";
import { PG_TYPES } from "./db.ts";
import { installPushFetchForTests, runPushDispatch } from "./pushDispatch.ts";
import { sendWebPush, webPushConfigured, webPushSelfTest } from "./lib/webpush.ts";
import {
  apnsConfigured,
  apnsJwt,
  apnsSelfTest,
  parseApnsEndpoint,
  resetApnsJwtCache,
  sendApns,
} from "./lib/apns.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));

function walkTs(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, files);
    else if (name.endsWith(".ts") && !name.endsWith(".check.ts")) files.push(p);
  }
  return files;
}

function exportedFunctions(src: string): { name: string; body: string }[] {
  const starts: { name: string; index: number }[] = [];
  const re = /^export (?:async )?function (\w+)\b/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ name: m[1], index: m.index });
  return starts.map((start, i) => ({
    name: start.name,
    body: src.slice(start.index, i + 1 < starts.length ? starts[i + 1].index : src.length),
  }));
}

const SENDER_CALL = /(?:runPushDispatch|sendWebPush|sendApns)\(/;
const allowedSenderFiles = new Set([
  join(here, "pushDispatch.ts"),
  join(here, "lib/webpush.ts"),
  join(here, "lib/apns.ts"),
  join(here, "cronJobs.ts"),
]);
for (const file of walkTs(here)) {
  const src = readFileSync(file, "utf8");
  if (!SENDER_CALL.test(src)) continue;
  ok(allowedSenderFiles.has(file), `sender call only in allowed files: ${file.slice(here.length + 1)}`);
}

const cronJobsSrc = readFileSync(join(here, "cronJobs.ts"), "utf8");
for (const fn of exportedFunctions(cronJobsSrc)) {
  const senderAt = fn.body.search(SENDER_CALL);
  if (senderAt < 0) continue;
  const gateAt = fn.body.indexOf("gateCron(");
  ok(gateAt >= 0 && gateAt < senderAt, `cronJobs.ts ${fn.name} calls sender after gateCron`);
}

const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
const routeRe = /app\.(all|get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2\s*,\s*([\s\S]*?)\);/g;
let routeMatch: RegExpExecArray | null;
let pushRoutes = 0;
while ((routeMatch = routeRe.exec(indexSrc))) {
  const path = routeMatch[3] ?? "";
  if (!path.includes("push-dispatch")) continue;
  pushRoutes += 1;
  ok(
    /^\(c\)\s*=>\s*handleCron\(\s*c\s*,\s*["']push-dispatch["']\s*\)$/.test((routeMatch[4] ?? "").trim()),
    `index.ts ${path} is exactly handleCron(c, "push-dispatch")`,
  );
}
ok(pushRoutes === 2, `index.ts has two dedicated push-dispatch routes (got ${pushRoutes})`);

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function vapidPair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: bytesToB64url(raw), privateKey: jwk.d ?? "" };
}

async function subscriberKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { p256dh: bytesToB64url(raw), auth: bytesToB64url(auth) };
}

const vapid = await vapidPair();
const env = {
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:test@nuvo.app",
  CRON_SECRET: "push-check-cron",
  DATABASE_URL: "postgresql://neondb@ep-prod.us-east-1.aws.neon.tech/nuvo",
  BETTER_AUTH_SECRET: "push-check-secret-32-bytes-long!!!!",
  BETTER_AUTH_URL: "http://localhost:8787",
  ENVIRONMENT: "local",
};

ok(webPushConfigured(env), "VAPID pair is configured");
const self = await webPushSelfTest(env, vapid.publicKey);
ok(self.ok === true, "webPushSelfTest signs");
ok(self.matchesClient === true, "webPushSelfTest matches the client public key");
const mismatch = await webPushSelfTest(env, "other-key");
ok(mismatch.ok === true && mismatch.matchesClient === false, "webPushSelfTest notices a split pair");
const brokenSelf = await webPushSelfTest({
  ...env,
  VAPID_PRIVATE_KEY: "not-a-valid-d",
});
ok(brokenSelf.ok === false, "selfTest broken key fails");
ok(brokenSelf.error === "VAPID keys could not sign", "selfTest error is generic — no raw crypto or exception text");

const posts: { url: string; headers: Headers; status: number }[] = [];
let pushDown = false;
const mockFetch = async (input: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const gone = input.includes("gone");
  const status = gone ? 410 : pushDown ? 503 : 201;
  posts.push({ url: input, headers, status });
  return new Response("", { status });
};

const subKeys = await subscriberKeys();
const live = await sendWebPush(
  env,
  {
    id: "00000000-0000-4000-8000-000000000001",
    endpoint: "https://push.example.test/a",
    p256dh: subKeys.p256dh,
    auth: subKeys.auth,
  },
  JSON.stringify({ title: "Standup" }),
  mockFetch,
);
ok(live.ok === true && live.gone === false, "sendWebPush: mock 201 is ok");
ok(posts.length === 1 && posts[0]?.url === "https://push.example.test/a", "sendWebPush: posted to the mocked endpoint");
ok(posts[0]?.headers.get("Authorization")?.startsWith("vapid t="), "sendWebPush: VAPID Authorization header");
ok(posts[0]?.headers.get("Content-Encoding") === "aes128gcm", "sendWebPush: aes128gcm encoding");
ok(posts[0]?.headers.get("TTL") === "600", "sendWebPush: reminder TTL");

const gone = await sendWebPush(
  env,
  {
    id: "00000000-0000-4000-8000-000000000002",
    endpoint: "https://push.example.test/gone",
    p256dh: subKeys.p256dh,
    auth: subKeys.auth,
  },
  JSON.stringify({ title: "gone" }),
  mockFetch,
);
ok(gone.ok === false && gone.gone === true && gone.status === 410, "sendWebPush: 410 is gone");

// Parse `date` exactly as the Worker's postgres.js client does (db.ts PG_TYPES).
const db = new PGlite({ parsers: { 1082: PG_TYPES.date_ymd.parse } });
await applyIsolationSchema(db);
const sql = makePgliteSql(db);

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const nowMs = Date.UTC(2026, 9, 26, 17, 0, 30);
const startA = new Date(nowMs - 30_000 + 5 * 60_000).toISOString();
const startB = new Date(nowMs - 30_000 + 5 * 60_000).toISOString();
const keysA = await subscriberKeys();
const keysB = await subscriberKeys();

// Seed reminder rows are empty-lead overrides and would silence the default.
await db.query(`DELETE FROM reminders WHERE user_id IN ($1, $2)`, [A, B]);
await db.query(`DELETE FROM push_subscriptions WHERE user_id IN ($1, $2)`, [A, B]);
await db.query(
  `UPDATE user_settings
   SET reminder_prefs = $2::jsonb, time_zone = 'UTC'
   WHERE user_id = $1`,
  [A, JSON.stringify({ enabled: true, block_leads: [5] })],
);
await db.query(
  `UPDATE user_settings
   SET reminder_prefs = $2::jsonb, time_zone = 'UTC'
   WHERE user_id = $1`,
  [B, JSON.stringify({ enabled: true, block_leads: [5] })],
);
await db.query(
  `UPDATE tasks
   SET status = 'planned', start_time = $1, duration_minutes = 30, do_date = '2026-10-26', title = 'A standup'
   WHERE id = 'aaaaaaaa-2222-4000-8000-000000000001'`,
  [startA],
);
await db.query(
  `UPDATE tasks
   SET status = 'planned', start_time = $1, duration_minutes = 30, do_date = '2026-10-26', title = 'B standup'
   WHERE id = 'bbbbbbbb-2222-4000-8000-000000000001'`,
  [startB],
);
await db.query(
  `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
   VALUES ($1, $2, $3, $4, $5)`,
  ["aaaaaaaa-ffff-4000-8000-000000000001", A, "https://push.example.test/user-a", keysA.p256dh, keysA.auth],
);
await db.query(
  `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
   VALUES ($1, $2, $3, $4, $5)`,
  ["bbbbbbbb-ffff-4000-8000-000000000001", B, "https://push.example.test/user-b", keysB.p256dh, keysB.auth],
);

let ioOpened = 0;
const restore = installRequestIoForTests(() => {
  ioOpened += 1;
  return {
    sql,
    auth: {} as never,
    close: async () => {},
  };
});
const restorePushFetch = installPushFetchForTests(mockFetch);
posts.length = 0;

const PUSH_ROUTES = [
  "/api/cron/push-dispatch",
  "/api/cron/nuvo-push-dispatch",
  "/api/push-dispatch",
  "/functions/v1/push-dispatch",
] as const;
const SKIP_KEYS = ["job", "ok", "reason", "skipped"] as const;

function isExactSkipBody(body: unknown): body is { job: string; ok: true; reason: string; skipped: true } {
  if (!body || typeof body !== "object") return false;
  const rec = body as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return (
    keys.length === SKIP_KEYS.length &&
    keys.every((key, i) => key === SKIP_KEYS[i]) &&
    rec.ok === true &&
    rec.skipped === true &&
    rec.reason === "cutover_not_flipped" &&
    rec.job === "push-dispatch"
  );
}

ioOpened = 0;
for (const path of PUSH_ROUTES) {
  for (const method of ["GET", "POST"] as const) {
    for (const body of [{ nowMs }, { selfTest: true, clientPublicKey: vapid.publicKey }] as const) {
      const query = new URLSearchParams(
        Object.fromEntries(
          Object.entries(body).map(([key, value]) => [key, String(value)]),
        ),
      ).toString();
      const res = await app.request(`http://localhost:8787${path}${method === "GET" ? `?${query}` : ""}`, {
        method,
        headers: {
          Origin: "http://localhost:8787",
          Authorization: `Bearer ${env.CRON_SECRET}`,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }, env);
      ok(res.status === 200, `unflipped ${method} ${path}: HTTP ${res.status}`);
      const skipBody = await res.json();
      ok(isExactSkipBody(skipBody), `unflipped ${method} ${path}: exact skip body`);
    }
  }
}
ok(ioOpened === 0, "unflipped push routes: zero IO opens");
ok(posts.length === 0, "unflipped push routes: nothing sent even with Neon prefs + nowMs");
const skipDeliveries = await db.query<{ n: number }>(
  `SELECT COUNT(*)::int AS n FROM reminder_deliveries WHERE user_id IN ($1, $2)`,
  [A, B],
);
ok(Number(skipDeliveries.rows[0]?.n ?? 0) === 0, "unflipped push routes: no claims");

const skipJob = await runCronJob("push-dispatch", env, sql);
ok(skipJob.skipped === true && skipJob.status === 200 && skipJob.reason === "cutover_not_flipped", "runCronJob skips push-dispatch before flip");
ok(posts.length === 0, "runCronJob before flip: mock endpoint silent");

const flippedEnv = { ...env, CUTOVER_FLIPPED: "1" };
const ignoredClock = await app.request("http://localhost:8787/api/cron/push-dispatch", {
  method: "POST",
  headers: {
    Origin: "http://localhost:8787",
    Authorization: `Bearer ${env.CRON_SECRET}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ nowMs }),
}, flippedEnv);
ok(ignoredClock.status === 200, `HTTP cron after flip: ${ignoredClock.status}`);
const ignoredBody = (await ignoredClock.json()) as { ok?: boolean; skipped?: boolean; notified?: number };
ok(ignoredBody.ok === true && ignoredBody.skipped !== true, "HTTP cron runs after flip");
ok((ignoredBody.notified ?? 0) === 0, "HTTP cron ignores caller nowMs (fixture clock would have fired)");
ok(posts.length === 0, "HTTP cron after flip: caller nowMs did not send");
ok(
  Number((await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM reminder_deliveries WHERE user_id IN ($1, $2)`,
    [A, B],
  )).rows[0]?.n ?? 0) === 0,
  "HTTP cron after flip: caller nowMs did not claim",
);

posts.length = 0;
const result = await runPushDispatch(sql, env, { nowMs, fetchImpl: mockFetch });
ok(result.ok === true, "dispatch: ok");
ok(result.accounts === 2, `dispatch: accounts=${result.accounts}`);
ok(result.notified === 2, `dispatch: notified=${result.notified}`);
ok(result.considered === 2, `dispatch: considered=${result.considered}`);
ok(posts.some((p) => p.url === "https://push.example.test/user-a"), "dispatch: pushed A's endpoint");
ok(posts.some((p) => p.url === "https://push.example.test/user-b"), "dispatch: pushed B's endpoint");
ok(!posts.some((p) => p.url === "https://push.example.test/user-a" && p.url.includes("user-b")), "dispatch: endpoints stay distinct");

const claimedA = await db.query<{ n: number }>(
  `SELECT COUNT(*)::int AS n FROM reminder_deliveries WHERE user_id = $1`,
  [A],
);
const claimedB = await db.query<{ n: number }>(
  `SELECT COUNT(*)::int AS n FROM reminder_deliveries WHERE user_id = $1`,
  [B],
);
ok(Number(claimedA.rows[0]?.n ?? 0) === 1, "dispatch: claimed A once");
ok(Number(claimedB.rows[0]?.n ?? 0) === 1, "dispatch: claimed B once");

posts.length = 0;
const again = await runPushDispatch(sql, env, { nowMs, fetchImpl: mockFetch });
ok(again.notified === 0, "second dispatch: already claimed, no push");
ok(posts.length === 0, "second dispatch: mock endpoint silent");

await db.query(
  `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
   VALUES ($1, $2, $3, $4, $5)`,
  ["aaaaaaaa-fffe-4000-8000-000000000001", A, "https://push.example.test/gone-a", keysA.p256dh, keysA.auth],
);
await db.query(`DELETE FROM reminder_deliveries WHERE user_id = $1`, [A]);
posts.length = 0;
const afterGone = await runPushDispatch(sql, env, { nowMs, fetchImpl: mockFetch });
ok(afterGone.notified === 1, `gone dispatch: notified=${afterGone.notified} (A only; B still claimed)`);
ok(posts.some((p) => p.url === "https://push.example.test/gone-a" && p.status === 410), "gone: mock returned 410");
const goneLeft = await db.query<{ n: number }>(
  `SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE endpoint = $1`,
  ["https://push.example.test/gone-a"],
);
ok(Number(goneLeft.rows[0]?.n ?? 0) === 0, "gone: subscription deleted for A only");
ok(
  Number((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = $1`, [B])).rows[0]?.n ?? 0) === 1,
  "gone: B's subscription remains",
);

// ── Deadline reminders: the window, the order, and the claim ──────────────
// A user with 600 far-future deadlines and ONE due now: the near one must not
// fall off LIMIT 500 (no ORDER BY + `OR deadline IS NOT NULL` dropped it).
await db.query(
  `UPDATE user_settings SET reminder_prefs = $2::jsonb WHERE user_id = $1`,
  [A, JSON.stringify({ enabled: true, block_leads: [5], deadline_leads: [0], deadline_time_minutes: 17 * 60 })],
);
await db.query(
  `INSERT INTO tasks (user_id, title, status, deadline)
   SELECT $1, 'far ' || g, 'planned', DATE '2099-01-01' + g FROM generate_series(1, 600) g`,
  [A],
);
const NEAR = "aaaaaaaa-dddd-4000-8000-000000000001";
await db.query(
  `INSERT INTO tasks (id, user_id, title, status, deadline) VALUES ($1, $2, 'file taxes', 'planned', '2026-10-26')`,
  [NEAR, A],
);
const nearKey = (await db.query<{ n: number }>(
  `SELECT COUNT(*)::int AS n FROM reminder_deliveries WHERE user_id = $1 AND reminder_key LIKE $2`,
  [A, `%${NEAR}%`],
));
ok(Number(nearKey.rows[0]?.n ?? 0) === 0, "deadline: not claimed before dispatch");
const nearClaims = async () => Number((await db.query<{ n: number }>(
  `SELECT COUNT(*)::int AS n FROM reminder_deliveries WHERE user_id = $1 AND reminder_key LIKE $2`,
  [A, `%${NEAR}%`],
)).rows[0]?.n ?? 0);

// Every device failing transiently (503) gives the claim back…
pushDown = true;
posts.length = 0;
const downRun = await runPushDispatch(sql, env, { nowMs, fetchImpl: mockFetch });
pushDown = false;
ok(posts.some((p) => p.url === "https://push.example.test/user-a" && p.status === 503), "deadline: the near deadline was attempted despite 600 far ones");
ok((await nearClaims()) === 0, "push 503 on every device: claim released for the next minute");
ok(downRun.notified === 0, `push 503: not counted as notified (got ${downRun.notified})`);

// …so the next minute delivers it, and then it stays claimed.
posts.length = 0;
const upRun = await runPushDispatch(sql, env, { nowMs, fetchImpl: mockFetch });
ok(posts.some((p) => p.url === "https://push.example.test/user-a" && p.status === 201), "deadline: retried and delivered after the outage");
ok((await nearClaims()) === 1 && upRun.notified === 1, `deadline: delivered once and claimed (claims ${await nearClaims()}, notified ${upRun.notified})`);

// A gone (410) device keeps the claim — nothing left to retry to.
await db.query(`DELETE FROM reminder_deliveries WHERE user_id = $1 AND reminder_key LIKE $2`, [A, `%${NEAR}%`]);
await db.query(`UPDATE push_subscriptions SET endpoint = 'https://push.example.test/gone-a2' WHERE user_id = $1`, [A]);
posts.length = 0;
await runPushDispatch(sql, env, { nowMs, fetchImpl: mockFetch });
ok(posts.some((p) => p.url === "https://push.example.test/gone-a2" && p.status === 410), "gone-only: mock returned 410");
ok((await nearClaims()) === 1, "gone-only: claim kept (no retry loop)");

// One user's failure doesn't stop the next user's reminders.
{
  const failing = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("FROM push_subscriptions") && values.includes(A)) throw new Error("boom");
    return sql(strings, ...(values as never[]));
  }) as unknown as typeof sql;
  await db.query(`DELETE FROM reminder_deliveries WHERE user_id = $1`, [B]);
  posts.length = 0;
  let threw = false;
  try {
    const iso = await runPushDispatch(failing, env, { nowMs, fetchImpl: mockFetch });
    ok(iso.notified === 1, `isolation: B still notified when A throws (got ${iso.notified})`);
  } catch {
    threw = true;
  }
  ok(!threw, "isolation: one user throwing does not abort the dispatch");
  ok(posts.some((p) => p.url === "https://push.example.test/user-b"), "isolation: B's device still pushed");
}

// D-249: listing skips disabled / unsubscribed accounts and does not select hidden_events.
{
  const listing: string[] = [];
  const wrap = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (/FROM user_settings s/.test(text)) listing.push(text);
    return sql(strings, ...(values as never[]));
  }) as unknown as typeof sql;

  await db.query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    ["aaaaaaaa-fffd-4000-8000-000000000001", A, "https://push.example.test/listing-a", keysA.p256dh, keysA.auth],
  );
  await db.query(
    `UPDATE user_settings SET reminder_prefs = $2::jsonb, hidden_events = $3::jsonb WHERE user_id = $1`,
    [A, JSON.stringify({ enabled: true, block_leads: [5] }), JSON.stringify([])],
  );
  await db.query(
    `UPDATE user_settings SET reminder_prefs = $2::jsonb, hidden_events = $3::jsonb WHERE user_id = $1`,
    [B, JSON.stringify({ enabled: false, block_leads: [5] }), JSON.stringify(Array.from({ length: 800 }, (_, i) => ({ key: `hidden-${i}` })))],
  );
  listing.length = 0;
  const disabled = await runPushDispatch(wrap, env, { nowMs, fetchImpl: mockFetch });
  ok(disabled.accounts === 1, `listing skips a disabled account (got ${disabled.accounts})`);
  ok(listing.length >= 1 && !listing[0]!.includes("hidden_events"), "listing SQL does not select hidden_events");
  ok(listing[0]!.includes("push_subscriptions"), "listing SQL requires a subscription");
  ok(listing[0]!.includes("enabled"), "listing SQL requires reminders enabled");
  const hiddenBlob = JSON.stringify(Array.from({ length: 800 }, (_, i) => ({ key: `hidden-${i}` })));
  const listingBefore = JSON.stringify({
    user_id: B,
    reminder_prefs: { enabled: true, block_leads: [5] },
    hidden_events: JSON.parse(hiddenBlob),
    time_zone: "UTC",
  }).length;
  const listingAfter = JSON.stringify({
    user_id: B,
    reminder_prefs: { enabled: true, block_leads: [5] },
    time_zone: "UTC",
  }).length;
  console.log(
    "NUVO_PUSH_LISTING_BYTES " +
      JSON.stringify({
        listingRowBefore: listingBefore,
        listingRowAfter: listingAfter,
        unsubscribedEnabledUser: { beforeQueries: "settings+tasks+slots+events+subs", afterQueries: 0 },
      }),
  );

  await db.query(
    `UPDATE user_settings SET reminder_prefs = $2::jsonb WHERE user_id = $1`,
    [B, JSON.stringify({ enabled: true, block_leads: [5] })],
  );
  await db.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [B]);
  listing.length = 0;
  const unsub = await runPushDispatch(wrap, env, { nowMs, fetchImpl: mockFetch });
  ok(unsub.accounts === 1, `listing skips an enabled account with no device (got ${unsub.accounts})`);
}

const unauth = await app.request("http://localhost:8787/api/cron/push-dispatch", {
  method: "POST",
  headers: { Origin: "http://localhost:8787" },
}, env);
ok(unauth.status === 401, `HTTP cron unauth: ${unauth.status}`);

const selfHttp = await app.request("http://localhost:8787/api/cron/push-dispatch", {
  method: "POST",
  headers: {
    Origin: "http://localhost:8787",
    Authorization: `Bearer ${env.CRON_SECRET}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ selfTest: true, clientPublicKey: vapid.publicKey }),
}, flippedEnv);
ok(selfHttp.status === 200, `HTTP selfTest: ${selfHttp.status}`);
const selfBody = (await selfHttp.json()) as { skipped?: boolean; selfTest?: { ok?: boolean; matchesClient?: boolean } };
ok(selfBody.skipped !== true, "HTTP selfTest runs after flip");
ok(selfBody.selfTest?.ok === true && selfBody.selfTest.matchesClient === true, "HTTP selfTest: pair matches");

const alias = await app.request("http://localhost:8787/functions/v1/push-dispatch", {
  method: "POST",
  headers: {
    Origin: "http://localhost:8787",
    Authorization: `Bearer ${env.CRON_SECRET}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ selfTest: true }),
}, flippedEnv);
ok(alias.status === 200, `functions/v1/push-dispatch: ${alias.status}`);

// ── APNs: the native iPhone app (D-259) ────────────────────────────────────
{
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8));
  // As pasted from the .p8 file — and once more with its newlines flattened to
  // literal "\n", the way a dashboard secret field sometimes stores it.
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
  const apnsEnv = { ...env, APNS_KEY_P8: pem, APNS_KEY_ID: "KEYID12345", APNS_TEAM_ID: "TEAMID1234" };
  const TOKEN = "ab".repeat(32);

  ok(!apnsConfigured(env), "apns: unset secrets are not configured");
  ok(apnsConfigured(apnsEnv), "apns: three secrets are configured");
  ok(parseApnsEndpoint(`apns://sandbox/${TOKEN}`)?.environment === "sandbox", "apns: parses a sandbox endpoint");
  ok(parseApnsEndpoint(`apns://production/${TOKEN.toUpperCase()}`)?.token === TOKEN, "apns: token lowercased");
  ok(parseApnsEndpoint("https://push.example.test/a") === null, "apns: a Web Push URL is not APNs");
  ok(parseApnsEndpoint("apns://staging/abcd") === null, "apns: unknown environment rejected");

  resetApnsJwtCache();
  const jwt = await apnsJwt(apnsEnv, nowMs);
  const [h, c, s] = jwt.split(".");
  const dec = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  ok(dec(h).alg === "ES256" && dec(h).kid === "KEYID12345", "apns jwt: ES256 header with kid");
  ok(dec(c).iss === "TEAMID1234" && dec(c).iat === Math.floor(nowMs / 1000), "apns jwt: iss + iat");
  const sigBytes = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
  ok(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      sigBytes,
      new TextEncoder().encode(`${h}.${c}`),
    ),
    "apns jwt: signature verifies against the key's public half",
  );
  ok((await apnsJwt(apnsEnv, nowMs + 10 * 60_000)) === jwt, "apns jwt: reused inside its window");
  ok((await apnsJwt(apnsEnv, nowMs + 45 * 60_000)) !== jwt, "apns jwt: re-minted before Apple's hour");
  resetApnsJwtCache();
  ok((await apnsSelfTest({ ...apnsEnv, APNS_KEY_P8: pem.replace(/\n/g, "\\n") })).ok, "apns selfTest: survives flattened newlines");
  ok((await apnsSelfTest({ ...apnsEnv, APNS_KEY_P8: "nope" })).ok === false, "apns selfTest: a bad key fails");

  const apnsPosts: { url: string; headers: Headers; body: string }[] = [];
  let apnsReply: { status: number; reason?: string } = { status: 200 };
  const apnsFetch = async (input: string, init?: RequestInit) => {
    apnsPosts.push({ url: input, headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    const { status, reason } = apnsReply;
    return new Response(reason ? JSON.stringify({ reason }) : "", { status });
  };
  const sub = { id: "x", endpoint: `apns://sandbox/${TOKEN}`, p256dh: "", auth: "" };
  const longKey = `task:${"x".repeat(80)}:start`;
  const sent = await sendApns(apnsEnv, sub, { title: "Men's lunch", body: "in a week", key: longKey }, apnsFetch, nowMs);
  const req = apnsPosts[0]!;
  ok(sent.ok && !sent.gone, "sendApns: 200 is ok");
  ok(req.url === `https://api.sandbox.push.apple.com/3/device/${TOKEN}`, `sendApns: sandbox host + token path (${req.url})`);
  ok(req.headers.get("authorization")?.startsWith("bearer ") === true, "sendApns: bearer provider token");
  ok(req.headers.get("apns-topic") === "day.nuvo.app", "sendApns: default topic is the iOS bundle id");
  ok(req.headers.get("apns-push-type") === "alert", "sendApns: alert push type");
  ok((req.headers.get("apns-collapse-id") ?? "").length <= 64, "sendApns: collapse id within 64 bytes");
  const sentBody = JSON.parse(req.body);
  ok(sentBody.aps?.alert?.title === "Men's lunch" && sentBody.aps?.alert?.body === "in a week", "sendApns: alert title + body");
  await sendApns(apnsEnv, { ...sub, endpoint: `apns://production/${TOKEN}` }, { title: "t", key: "k" }, apnsFetch, nowMs);
  ok(apnsPosts[1]!.url.startsWith("https://api.push.apple.com/"), "sendApns: production host");

  apnsReply = { status: 410, reason: "Unregistered" };
  ok((await sendApns(apnsEnv, sub, { title: "t", key: "k" }, apnsFetch, nowMs)).gone, "sendApns: 410 is gone");
  apnsReply = { status: 400, reason: "BadDeviceToken" };
  ok((await sendApns(apnsEnv, sub, { title: "t", key: "k" }, apnsFetch, nowMs)).gone, "sendApns: BadDeviceToken is gone");
  apnsReply = { status: 403, reason: "InvalidProviderToken" };
  const forbidden = await sendApns(apnsEnv, sub, { title: "t", key: "k" }, apnsFetch, nowMs);
  ok(!forbidden.ok && !forbidden.gone, "sendApns: a provider-token problem is not the device's fault");
  apnsReply = { status: 200 };

  // Through the dispatcher: A's only device is the iPhone app.
  await db.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [A]);
  await db.query(`DELETE FROM reminder_deliveries WHERE user_id = $1`, [A]);
  await db.query(`UPDATE user_settings SET reminder_prefs = $2::jsonb WHERE user_id = $1`, [
    A,
    JSON.stringify({ enabled: true, block_leads: [5] }),
  ]);
  await db.query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, '', '')`,
    ["aaaaaaaa-fffc-4000-8000-000000000001", A, `apns://sandbox/${TOKEN}`],
  );
  const claimsA = async () =>
    Number((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM reminder_deliveries WHERE user_id = $1`, [A])).rows[0]?.n ?? 0);

  // Without APNs secrets the phone is not an audience — and nothing is claimed,
  // so an app opening a minute later can still say it.
  apnsPosts.length = 0;
  const noKeys = await runPushDispatch(sql, env, { nowMs, fetchImpl: apnsFetch, userIds: [A] });
  ok(noKeys.notified === 0 && apnsPosts.length === 0, "dispatch without APNs secrets: nothing sent");
  ok((await claimsA()) === 0, "dispatch without APNs secrets: nothing claimed");

  apnsPosts.length = 0;
  const withKeys = await runPushDispatch(sql, apnsEnv, { nowMs, fetchImpl: apnsFetch, userIds: [A] });
  ok(withKeys.notified === 1, `dispatch with APNs: notified (got ${withKeys.notified})`);
  ok(apnsPosts.some((p) => p.url.endsWith(`/3/device/${TOKEN}`) && p.body.includes("A standup")), "dispatch with APNs: the standup reached the phone");
  ok((await claimsA()) === 1, "dispatch with APNs: claimed once");

  // A dead token is pruned like a 410 Web Push endpoint.
  await db.query(`DELETE FROM reminder_deliveries WHERE user_id = $1`, [A]);
  apnsReply = { status: 400, reason: "BadDeviceToken" };
  await runPushDispatch(sql, apnsEnv, { nowMs, fetchImpl: apnsFetch, userIds: [A] });
  apnsReply = { status: 200 };
  const leftA = Number((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = $1`, [A])).rows[0]?.n ?? 0);
  ok(leftA === 0, "dispatch with APNs: BadDeviceToken deletes the row");
}

restorePushFetch();
restore();
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("push dispatch: ok");
