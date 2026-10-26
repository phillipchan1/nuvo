// HTTP access isolation for ported calendar routes + planner twins.
// A/B: B gets 403/404/empty on A's rows. Unauthenticated is 401.
// POST with A's id matches a random id (no existence oracle).
// Run: node --experimental-strip-types worker/src/accessHttp.check.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from "kysely";
import { createAuth } from "./auth.ts";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installRequestIoForTests } from "./requestIo.ts";
import { sealToken, testTokenKey, tokenAad } from "./lib/secrets.ts";
import app from "./index.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}
function denied(status: number): boolean {
  return status === 403 || status === 404;
}

const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
const storeSrc = readFileSync(join(here, "store.ts"), "utf8");
const calStoreSrc = readFileSync(join(here, "calendar/store.ts"), "utf8");
const calHttpSrc = readFileSync(join(here, "calendar/http.ts"), "utf8");
const routeSrc = [indexSrc, calHttpSrc, calStoreSrc].join("\n");

ok(/sessionUser\(io\.auth/.test(indexSrc) && /sessionUser\(io\.auth/.test(calHttpSrc), "owner comes from verified session");
ok(!/c\.req\.query\(["']user_id["']\)/.test(routeSrc), "routes: no user_id query param");
ok(!/c\.req\.header\(["'](?:x-user-id|user-id)["']\)/i.test(routeSrc), "routes: no client user-id header");
ok(/user_id = \$\{store\.userId\}/.test(storeSrc), "store: owner filter is store.userId");
ok(/user_id = \$\{store\.userId\}/.test(calStoreSrc), "calendar store: owner filter is store.userId");
ok(/AND user_id = \$\{/.test(calStoreSrc) || /user_id = \$\{store\.userId\}/.test(calStoreSrc), "calendar writes stay owner-scoped");

class PGliteConnection implements DatabaseConnection {
  client: PGlite;
  constructor(client: PGlite) {
    this.client = client;
  }
  async executeQuery<O>(compiled: CompiledQuery): Promise<QueryResult<O>> {
    const result = await this.client.query<O>(compiled.sql, [...compiled.parameters]);
    return { rows: result.rows as O[], numAffectedRows: BigInt(result.affectedRows ?? 0) };
  }
  async *streamQuery(): AsyncIterableIterator<QueryResult<never>> {
    throw new Error("streamQuery is not supported on PGlite");
  }
}

class PGliteDriver implements Driver {
  client: PGlite;
  constructor(client: PGlite) {
    this.client = client;
  }
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return new PGliteConnection(this.client);
  }
  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("BEGIN"));
  }
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("COMMIT"));
  }
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (
    url.includes("microsoftonline.com") ||
    url.includes("graph.microsoft.com") ||
    url.includes("icloud.com") ||
    url.includes("caldav")
  ) {
    return new Response("stub", { status: 401 });
  }
  return realFetch(input as RequestInfo, init);
};

const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);
const kysely = new Kysely({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new PGliteDriver(db),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const tokenKey = testTokenKey();
const env = {
  DATABASE_URL: "postgresql://neondb@ep-prod.us-east-1.aws.neon.tech/nuvo",
  BETTER_AUTH_SECRET: "access-http-secret-32-bytes-long!!",
  BETTER_AUTH_URL: "http://localhost:8787",
  CRON_SECRET: "access-http-cron-secret",
  ENVIRONMENT: "local",
  TOKEN_ENC_KEY_V1: tokenKey,
  MS_CLIENT_ID: "ms-client",
  MS_CLIENT_SECRET: "ms-secret",
  APP_URL: "http://localhost:8787",
};

const restore = installRequestIoForTests(() => {
  const auth = createAuth(env, { db: kysely, type: "postgres" });
  return { sql, auth, close: async () => {} };
});

const origin = "http://localhost:8787";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", origin);
  return app.request(`http://localhost:8787${path}`, { ...init, headers }, env);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} hung after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function readOtp(email: string): Promise<string> {
  const rows = await db.query<{ value: string }>(
    `SELECT value FROM verification WHERE identifier = $1 ORDER BY "expiresAt" DESC LIMIT 1`,
    [`sign-in-otp-${email}`],
  );
  return (rows.rows[0]?.value ?? "").split(":")[0];
}

async function signInOtp(email: string): Promise<{ token: string; id: string }> {
  const send = await withTimeout(
    request("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, type: "sign-in" }),
    }),
    8000,
    `OTP send ${email}`,
  );
  ok(send.status === 200, `OTP send ${email}: HTTP ${send.status}`);
  const otp = await readOtp(email);
  ok(/^\d{6}$/.test(otp), `OTP send ${email}: captured a 6-digit code`);
  const res = await withTimeout(
    request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp }),
    }),
    8000,
    `OTP sign-in ${email}`,
  );
  const text = await res.text();
  ok(res.status === 200, `OTP sign-in ${email}: HTTP ${res.status}`);
  const body = JSON.parse(text || "{}") as { token?: string; user?: { id?: string } };
  return { token: body.token ?? "", id: body.user?.id ?? "" };
}

function jsonHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const a = await signInOtp("iso-cal-a@example.test");
const b = await signInOtp("iso-cal-b@example.test");
await withTimeout(request("/api/data/user_settings", { headers: { Authorization: `Bearer ${a.token}` } }), 8000, "prime A");
await withTimeout(request("/api/data/user_settings", { headers: { Authorization: `Bearer ${b.token}` } }), 8000, "prime B");

const ACC_A = "c0a11e00-ca11-4000-8000-000000000001";
const EVT_A = "c0a11e00-e711-4000-8000-000000000001";
const RANDOM = "b0b0b0b0-0000-4000-8000-00000000ffff";
const TASK_A = "c0a11e00-2222-4000-8000-000000000001";
const PROJECT_A = "c0a11e00-1111-4000-8000-000000000001";
const DOMAIN_A = "c0a11e00-0000-4000-8000-000000000001";

await db.query(`INSERT INTO domains (id, user_id, name) VALUES ($1, $2, 'A secret domain')`, [DOMAIN_A, a.id]);
await db.query(`INSERT INTO projects (id, user_id, name, domain_id) VALUES ($1, $2, 'A secret project', $3)`, [PROJECT_A, a.id, DOMAIN_A]);
await db.query(
  `INSERT INTO tasks (id, user_id, title, notes, status, project_id) VALUES ($1, $2, 'A secret task', 'private', 'inbox', $3)`,
  [TASK_A, a.id, PROJECT_A],
);

await db.query(
  `INSERT INTO calendar_accounts (id, user_id, provider, email, sync_direction, calendars, needs_reconnect)
   VALUES ($1, $2, 'm365', 'a@outlook.test', 'read_only', '[{"id":"primary","summary":"A Outlook"}]'::jsonb, false)`,
  [ACC_A, a.id],
);
const sealed = await sealToken(tokenKey, "m365-refresh-aaaaaaaa", tokenAad("calendar_accounts", ACC_A, a.id));
await db.query(
  `UPDATE calendar_accounts SET refresh_token_enc = $1, refresh_token_iv = $2, key_version = $3 WHERE id = $4`,
  [sealed.enc, sealed.iv, sealed.keyVersion, ACC_A],
);
await db.query(
  `INSERT INTO external_events (id, user_id, account_id, provider_event_id, calendar_id, title, start_at, end_at)
   VALUES ($1, $2, $3, 'evt-a', 'primary', 'A secret event', '2026-10-26T09:00:00Z', '2026-10-26T10:00:00Z')`,
  [EVT_A, a.id, ACC_A],
);
async function count(table: string, where: string, params: unknown[]): Promise<number> {
  const result = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return Number(result.rows[0]?.n ?? 0);
}

const unauth = [
  { method: "GET", path: "/api/data/tasks" },
  { method: "POST", path: "/api/calendar-refresh", body: {} },
  { method: "POST", path: "/functions/v1/calendar-refresh", body: {} },
  { method: "POST", path: "/api/m365-sync", body: { accountId: ACC_A } },
  { method: "POST", path: "/functions/v1/m365-sync", body: { accountId: ACC_A } },
  { method: "POST", path: "/api/icloud-sync", body: { accountId: ACC_A } },
  { method: "POST", path: "/api/icloud-contacts", body: { accountId: ACC_A } },
  { method: "POST", path: "/api/icloud-events", body: { eventId: EVT_A, action: "delete" } },
  { method: "POST", path: "/functions/v1/icloud-events", body: { eventId: EVT_A, action: "delete" } },
  { method: "POST", path: "/api/icloud-connect", body: { appleId: "a@icloud.com", appPassword: "abcdefghijklmnop" } },
  { method: "POST", path: "/api/ics-subscribe", body: { url: "https://example.test/cal.ics" } },
  { method: "POST", path: "/api/ics-sync", body: { accountId: ACC_A } },
  { method: "GET", path: "/api/m365-oauth?action=start" },
  { method: "POST", path: "/api/cron/m365-sync" },
  { method: "POST", path: "/api/cron/calendar-dispatch" },
];

for (const route of unauth) {
  const res = await withTimeout(
    request(route.path, {
      method: route.method,
      headers: route.body ? { "Content-Type": "application/json" } : undefined,
      body: route.body ? JSON.stringify(route.body) : undefined,
    }),
    8000,
    `anon ${route.method} ${route.path}`,
  );
  ok(res.status === 401, `unauthenticated ${route.method} ${route.path}: HTTP ${res.status}`);
}

const bTask = await withTimeout(
  request("/api/data/tasks", {
    headers: { Authorization: `Bearer ${b.token}` },
  }),
  8000,
  "B list tasks",
);
const bTaskBody = (await bTask.json()) as { data?: { id?: string }[] };
ok(bTask.status === 200, `B list tasks: HTTP ${bTask.status}`);
ok(!(bTaskBody.data ?? []).some((row) => row.id === TASK_A), "B list tasks: omits A's task");

const bGet = await withTimeout(
  request(`/api/data/tasks/${TASK_A}`, { headers: { Authorization: `Bearer ${b.token}` } }),
  8000,
  "B get A task",
);
ok(denied(bGet.status), `B get A's task: HTTP ${bGet.status}`);

const bFk = await withTimeout(
  request("/api/data/tasks", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ title: "plant", project_id: PROJECT_A }),
  }),
  8000,
  "B FK plant",
);
ok(bFk.status === 400 || denied(bFk.status), `B POST task on A's project: HTTP ${bFk.status}`);
ok((await count("tasks", "user_id = $1 AND project_id = $2", [b.id, PROJECT_A])) === 0, "B FK plant: no row on A's project");

const bSyncA = await withTimeout(
  request("/api/m365-sync", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ accountId: ACC_A }),
  }),
  8000,
  "B sync A's m365",
);
const bSyncRand = await withTimeout(
  request("/api/m365-sync", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ accountId: RANDOM }),
  }),
  8000,
  "B sync random",
);
ok(bSyncA.status === bSyncRand.status, `B m365-sync A's id vs random: ${bSyncA.status} vs ${bSyncRand.status}`);
const syncABody = await bSyncA.json();
const syncRBody = await bSyncRand.json();
ok(JSON.stringify(syncABody) === JSON.stringify(syncRBody), "B m365-sync: A's id and random id same body");
ok((await count("external_events", "id = $1 AND title = $2", [EVT_A, "A secret event"])) === 1, "B m365-sync: A's event unchanged");

const bIcsA = await withTimeout(
  request("/functions/v1/ics-sync", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ accountId: ACC_A }),
  }),
  8000,
  "B ics-sync A",
);
const bIcsR = await withTimeout(
  request("/functions/v1/ics-sync", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ accountId: RANDOM }),
  }),
  8000,
  "B ics-sync random",
);
ok(bIcsA.status === bIcsR.status, `B ics-sync A's id vs random: ${bIcsA.status} vs ${bIcsR.status}`);

const bCloudA = await withTimeout(
  request("/api/icloud-sync", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ accountId: ACC_A }),
  }),
  8000,
  "B icloud-sync A",
);
const bCloudR = await withTimeout(
  request("/api/icloud-sync", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ accountId: RANDOM }),
  }),
  8000,
  "B icloud-sync random",
);
ok(bCloudA.status === bCloudR.status, `B icloud-sync A's id vs random: ${bCloudA.status} vs ${bCloudR.status}`);

const bContactsA = await withTimeout(
  request("/api/icloud-contacts", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ accountId: ACC_A }),
  }),
  8000,
  "B icloud-contacts A",
);
const bContactsR = await withTimeout(
  request("/api/icloud-contacts", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ accountId: RANDOM }),
  }),
  8000,
  "B icloud-contacts random",
);
ok(bContactsA.status === bContactsR.status, `B icloud-contacts A's id vs random: ${bContactsA.status} vs ${bContactsR.status}`);

const evA = await withTimeout(
  request("/api/icloud-events", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ eventId: EVT_A, action: "delete" }),
  }),
  8000,
  "B delete A's event",
);
const evR = await withTimeout(
  request("/api/icloud-events", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ eventId: RANDOM, action: "delete" }),
  }),
  8000,
  "B delete random event",
);
ok(denied(evA.status) && evA.status === evR.status, `B icloud-events A's id vs random: ${evA.status} vs ${evR.status}`);
const evABody = await evA.json();
const evRBody = await evR.json();
ok(JSON.stringify(evABody) === JSON.stringify(evRBody), "B icloud-events: no existence oracle");
ok((await count("external_events", "id = $1", [EVT_A])) === 1, "B icloud-events: A's event still present");

const refreshB = await withTimeout(
  request("/api/calendar-refresh", { method: "POST", headers: jsonHeaders(b.token), body: "{}" }),
  8000,
  "B refresh",
);
ok(refreshB.status === 200, `B calendar-refresh: HTTP ${refreshB.status}`);
const refreshBody = (await refreshB.json()) as { synced?: number };
ok(refreshBody.synced === 0, "B calendar-refresh: no foreign accounts");
ok((await count("external_events", "id = $1 AND title = $2", [EVT_A, "A secret event"])) === 1, "B refresh: A's event unchanged");

const icsBlocked = await withTimeout(
  request("/api/ics-subscribe", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ url: "https://127.0.0.1/secret.ics" }),
  }),
  8000,
  "B ics localhost",
);
ok(icsBlocked.status === 400, `B ics-subscribe localhost: HTTP ${icsBlocked.status}`);

const icsPlant = await withTimeout(
  request("/api/ics-subscribe", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ url: "https://127.0.0.1/secret.ics", user_id: a.id, id: ACC_A }),
  }),
  8000,
  "B ics plant",
);
ok(icsPlant.status === 400, `B ics-subscribe plant: HTTP ${icsPlant.status}`);
ok((await count("calendar_accounts", "id = $1 AND user_id = $2", [ACC_A, a.id])) === 1, "B ics-subscribe: A's account unchanged");

const connectBad = await withTimeout(
  request("/api/icloud-connect", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ appleId: "not-an-email", appPassword: "short" }),
  }),
  8000,
  "B icloud-connect bad",
);
ok(connectBad.status === 400, `B icloud-connect bad: HTTP ${connectBad.status}`);

const cronNo = await withTimeout(request("/api/cron/m365-sync", { method: "POST" }), 8000, "cron unauth");
ok(cronNo.status === 401, `cron unauth: HTTP ${cronNo.status}`);
const cronOk = await withTimeout(
  request("/api/cron/m365-sync", { method: "POST", headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }),
  8000,
  "cron m365",
);
ok(cronOk.status === 200, `cron m365-sync authorized: HTTP ${cronOk.status}`);
ok((await count("external_events", "id = $1 AND title = $2", [EVT_A, "A secret event"])) === 1, "cron m365: fixture event not wiped by empty graph");

const cronPush = await withTimeout(
  request("/api/cron/push-dispatch", { method: "POST", headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }),
  8000,
  "cron push",
);
ok(cronPush.status === 501, `cron push-dispatch stays blocked: HTTP ${cronPush.status}`);

const aOwn = await withTimeout(
  request(`/api/data/tasks/${TASK_A}`, { headers: { Authorization: `Bearer ${a.token}` } }),
  8000,
  "A re-read",
);
ok(aOwn.status === 200, `A still reads own task: HTTP ${aOwn.status}`);

restore();
await kysely.destroy();
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("access http isolation: ok");
