// Push-dispatch with a mocked Web Push endpoint.
// Run: node --experimental-strip-types worker/src/pushDispatch.check.ts
import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installRequestIoForTests } from "./requestIo.ts";
import app from "./index.ts";
import { runCronJob } from "./cronJobs.ts";
import { installPushFetchForTests, runPushDispatch } from "./pushDispatch.ts";
import { sendWebPush, webPushConfigured, webPushSelfTest } from "./lib/webpush.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

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

const posts: { url: string; headers: Headers; status: number }[] = [];
const mockFetch = async (input: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const gone = input.includes("gone");
  const status = gone ? 410 : 201;
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

const db = new PGlite();
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

const restore = installRequestIoForTests(() => ({
  sql,
  auth: {} as never,
  close: async () => {},
}));
const restorePushFetch = installPushFetchForTests(mockFetch);
posts.length = 0;
const skipHttp = await app.request("http://localhost:8787/api/cron/push-dispatch", {
  method: "POST",
  headers: {
    Origin: "http://localhost:8787",
    Authorization: `Bearer ${env.CRON_SECRET}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ nowMs }),
}, env);
ok(skipHttp.status === 200, `HTTP cron before flip: ${skipHttp.status}`);
const skipHttpBody = (await skipHttp.json()) as { ok?: boolean; skipped?: boolean; reason?: string };
ok(skipHttpBody.ok === true && skipHttpBody.skipped === true && skipHttpBody.reason === "cutover_not_flipped", "HTTP cron skips before flip");
ok(posts.length === 0, "HTTP cron before flip: nothing sent even with Neon prefs + nowMs");
const skipDeliveries = await db.query<{ n: number }>(
  `SELECT COUNT(*)::int AS n FROM reminder_deliveries WHERE user_id IN ($1, $2)`,
  [A, B],
);
ok(Number(skipDeliveries.rows[0]?.n ?? 0) === 0, "HTTP cron before flip: no claims");

const skipJob = await runCronJob("push-dispatch", env, sql);
ok(skipJob.skipped === true && skipJob.status === 200, "runCronJob skips push-dispatch before flip");
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

restorePushFetch();
restore();
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("push dispatch: ok");
