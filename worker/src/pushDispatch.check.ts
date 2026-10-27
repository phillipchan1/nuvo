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
import { installPushFetchForTests, runPushDispatch } from "./pushDispatch.ts";
import { sendWebPush, webPushConfigured, webPushSelfTest } from "./lib/webpush.ts";

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

const SENDER_CALL = /(?:runPushDispatch|sendWebPush)\(/;
const allowedSenderFiles = new Set([
  join(here, "pushDispatch.ts"),
  join(here, "lib/webpush.ts"),
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
