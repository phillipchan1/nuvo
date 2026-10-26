// HTTP access isolation against PGlite + Better Auth tokens.
// Run: node --experimental-strip-types worker/src/accessHttp.check.ts
// User B cannot mirror or dispatch as user A. Unauthenticated → 401.
// POST with A's id is the same as a random id (no existence oracle).

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
import app, { installWorkerFetchForTests } from "./index.ts";

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
const routeSrc = [
  "index.ts",
  "slotMirror.ts",
  "taskMirror.ts",
  "pushDispatch.ts",
  "mirrorTargets.ts",
].map((name) => readFileSync(join(here, name), "utf8")).join("\n");

ok(/sessionUser\(io\.auth/.test(readFileSync(join(here, "index.ts"), "utf8")), "requireStore: owner comes from verified session");
ok(!/c\.req\.query\(["']user_id["']\)/.test(routeSrc), "routes: no user_id query param");
ok(!/c\.req\.header\(["'](?:x-user-id|user-id)["']\)/i.test(routeSrc), "routes: no client user-id header");
ok(/user_id = \$\{store\.userId\}/.test(routeSrc), "mirrors: owner filter is store.userId");
ok(/user_id = \$\{userId\}/.test(readFileSync(join(here, "pushDispatch.ts"), "utf8")), "push-dispatch: per-user iteration");

class PGliteConnection implements DatabaseConnection {
  client: PGlite;
  constructor(client: PGlite) {
    this.client = client;
  }
  async executeQuery<O>(compiled: CompiledQuery): Promise<QueryResult<O>> {
    const result = await this.client.query<O>(compiled.sql, [...compiled.parameters]);
    return {
      rows: result.rows as O[],
      numAffectedRows: BigInt(result.affectedRows ?? 0),
    };
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

const env = {
  DATABASE_URL: "postgresql://neondb@ep-prod.us-east-1.aws.neon.tech/nuvo",
  BETTER_AUTH_SECRET: "access-http-secret-32-bytes-long!!",
  BETTER_AUTH_URL: "http://localhost:8787",
  CRON_SECRET: "access-http-cron-secret",
  ENVIRONMENT: "local",
};

const restoreIo = installRequestIoForTests(() => {
  const auth = createAuth(env, { db: kysely, type: "postgres" });
  return { sql, auth, close: async () => {} };
});

const googleCalls: { method: string; url: string }[] = [];
const restoreFetch = installWorkerFetchForTests(async (input, init) => {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  googleCalls.push({ method, url });
  if (url.includes("/calendars/") && method === "POST") {
    return new Response(JSON.stringify({ id: `gcal-${googleCalls.length}` }), { status: 200 });
  }
  return new Response("", { status: 200 });
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
  ok(res.status === 200, `OTP sign-in ${email}: HTTP ${res.status} ${text.slice(0, 160)}`);
  const body = JSON.parse(text || "{}") as { token?: string; user?: { id?: string } };
  ok(typeof body.token === "string" && body.token.includes("."), `OTP sign-in ${email}: signed token`);
  return { token: body.token ?? "", id: body.user?.id ?? "" };
}

function jsonHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const SLOT_A = "c0a11e00-9999-4000-8000-000000000001";
const TASK_A = "c0a11e00-2222-4000-8000-000000000001";
const DOMAIN_A = "c0a11e00-0000-4000-8000-000000000001";
const PROJECT_A = "c0a11e00-1111-4000-8000-000000000001";
const RANDOM_ID = "b0b0b0b0-0000-4000-8000-00000000ffff";

const a = await signInOtp("iso-a@example.test");
const b = await signInOtp("iso-b@example.test");

const primeA = await withTimeout(request("/api/data/user_settings", { headers: { Authorization: `Bearer ${a.token}` } }), 8000, "prime A");
const primeB = await withTimeout(request("/api/data/user_settings", { headers: { Authorization: `Bearer ${b.token}` } }), 8000, "prime B");
ok(primeA.status === 200, `prime A: HTTP ${primeA.status}`);
ok(primeB.status === 200, `prime B: HTTP ${primeB.status}`);

await db.query(
  `INSERT INTO domains (id, user_id, name, color) VALUES ($1, $2, 'A secret domain', '#111111')`,
  [DOMAIN_A, a.id],
);
await db.query(
  `INSERT INTO projects (id, user_id, name, domain_id) VALUES ($1, $2, 'A secret project', $3)`,
  [PROJECT_A, a.id, DOMAIN_A],
);
await db.query(
  `INSERT INTO tasks (id, user_id, title, notes, status, project_id, start_time, duration_minutes, do_date)
   VALUES ($1, $2, 'A secret task', 'private', 'planned', $3, '2026-10-26T16:00:00Z', 30, '2026-10-26')`,
  [TASK_A, a.id, PROJECT_A],
);
await db.query(
  `INSERT INTO slots (id, user_id, title, do_date, start_time, duration_minutes, project_id)
   VALUES ($1, $2, 'A secret slot', '2026-10-26', '2026-10-26T09:00:00Z', 60, $3)`,
  [SLOT_A, a.id, PROJECT_A],
);
await db.query(
  `INSERT INTO calendar_accounts (id, user_id, provider, email, access_token, access_token_expires_at, sync_direction, mirror_calendar_id)
   VALUES ($1, $2, 'google', 'a@example.test', 'ya29.a-token', $3, 'two_way', 'nuvo-cal-a')`,
  ["c0a11e00-acca-4000-8000-000000000001", a.id, new Date(Date.now() + 3600_000).toISOString()],
);

async function count(table: string, where: string, params: unknown[]): Promise<number> {
  const result = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return Number(result.rows[0]?.n ?? 0);
}

async function scalar<T>(text: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await db.query<Record<string, T>>(text, params);
  const row = result.rows[0];
  if (!row) return undefined;
  return Object.values(row)[0];
}

const unauthRoutes = [
  { method: "POST", path: "/api/slot-mirror", body: { slotId: SLOT_A } },
  { method: "POST", path: "/api/task-mirror", body: { taskId: TASK_A } },
  { method: "POST", path: "/functions/v1/slot-mirror", body: { slotId: SLOT_A } },
  { method: "POST", path: "/functions/v1/task-mirror", body: { taskId: TASK_A } },
  { method: "POST", path: "/api/push-dispatch", body: {} },
  { method: "POST", path: "/functions/v1/push-dispatch", body: {} },
  { method: "POST", path: "/api/cron/push-dispatch", body: {} },
  { method: "POST", path: "/api/cron/nuvo-push-dispatch", body: {} },
  { method: "GET", path: `/api/data/tasks/${TASK_A}` },
  { method: "PATCH", path: `/api/data/tasks/${TASK_A}`, body: { title: "no" } },
];

for (const route of unauthRoutes) {
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

const beforeGoogle = googleCalls.length;

const bSlotA = await withTimeout(
  request("/api/slot-mirror", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ slotId: SLOT_A, tz: "UTC" }),
  }),
  8000,
  "B slot-mirror A",
);
const bSlotRand = await withTimeout(
  request("/api/slot-mirror", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ slotId: RANDOM_ID, tz: "UTC" }),
  }),
  8000,
  "B slot-mirror random",
);
ok(bSlotA.status === 404 && bSlotRand.status === 404, `B slot-mirror A's id vs random: ${bSlotA.status} vs ${bSlotRand.status}`);
ok(JSON.stringify(await bSlotA.json()) === JSON.stringify(await bSlotRand.json()), "B slot-mirror: A's id and random id same body");

const bTaskA = await withTimeout(
  request("/api/task-mirror", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ taskId: TASK_A, tz: "UTC" }),
  }),
  8000,
  "B task-mirror A",
);
const bTaskRand = await withTimeout(
  request("/api/task-mirror", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ taskId: RANDOM_ID, tz: "UTC" }),
  }),
  8000,
  "B task-mirror random",
);
ok(bTaskA.status === 404 && bTaskRand.status === 404, `B task-mirror A's id vs random: ${bTaskA.status} vs ${bTaskRand.status}`);
ok(JSON.stringify(await bTaskA.json()) === JSON.stringify(await bTaskRand.json()), "B task-mirror: A's id and random id same body");
ok(googleCalls.length === beforeGoogle, "B mirror of A's ids: no provider write");

const bDelete = await withTimeout(
  request("/api/slot-mirror", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ slotId: SLOT_A, deleted: true, googleEventId: "evt-a" }),
  }),
  8000,
  "B slot-mirror delete A",
);
ok(bDelete.status === 200, `B slot-mirror delete (no B calendar): HTTP ${bDelete.status}`);
const bDeleteBody = (await bDelete.json()) as { skipped?: string };
ok(bDeleteBody.skipped === "no mirror calendar", "B delete uses B's accounts, not A's");

const headerSpoof = await withTimeout(
  request("/api/task-mirror", {
    method: "POST",
    headers: { ...jsonHeaders(b.token), "X-User-Id": a.id },
    body: JSON.stringify({ taskId: TASK_A }),
  }),
  8000,
  "B task-mirror spoof",
);
ok(denied(headerSpoof.status), `B task-mirror with X-User-Id:A: HTTP ${headerSpoof.status}`);

const aSlot = await withTimeout(
  request("/api/slot-mirror", {
    method: "POST",
    headers: jsonHeaders(a.token),
    body: JSON.stringify({ slotId: SLOT_A, tz: "America/New_York" }),
  }),
  8000,
  "A slot-mirror",
);
ok(aSlot.status === 200, `A slot-mirror own: HTTP ${aSlot.status}`);
ok((await aSlot.json() as { ok?: boolean }).ok === true, "A slot-mirror: ok");
ok((await scalar<string>("SELECT google_event_id FROM slots WHERE id = $1", [SLOT_A]))?.startsWith("gcal-"), "A slot-mirror: wrote google_event_id on A");
ok(googleCalls.some((c) => c.method === "POST" && c.url.includes("nuvo-cal-a")), "A slot-mirror: posted to A's calendar");

const aTask = await withTimeout(
  request("/functions/v1/task-mirror", {
    method: "POST",
    headers: jsonHeaders(a.token),
    body: JSON.stringify({ taskId: TASK_A, tz: "UTC" }),
  }),
  8000,
  "A task-mirror",
);
ok(aTask.status === 200, `A task-mirror own: HTTP ${aTask.status}`);
ok((await scalar<string>("SELECT google_event_id FROM tasks WHERE id = $1", [TASK_A]))?.startsWith("gcal-"), "A task-mirror: wrote google_event_id on A");

const forged = await withTimeout(
  request("/api/data/tasks", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ title: "forged as A", user_id: a.id, id: TASK_A }),
  }),
  8000,
  "B POST task A's id",
);
ok(forged.status === 200 || forged.status === 400, `B POST task with A's id: HTTP ${forged.status}`);
if (forged.status === 200) {
  const forgedBody = (await forged.json()) as { data?: { user_id?: string; id?: string } };
  ok(forgedBody.data?.user_id === b.id, "B POST: client user_id ignored");
  ok(forgedBody.data?.id !== TASK_A, "B POST: did not take A's id");
}
ok((await scalar<string>("SELECT title FROM tasks WHERE id = $1", [TASK_A])) === "A secret task", "B POST: A task unchanged");

const bTask = await withTimeout(
  request("/api/data/tasks", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ title: "B own task" }),
  }),
  8000,
  "B own task",
);
ok(bTask.status === 200, `B create own task: HTTP ${bTask.status}`);
const bTaskId = ((await bTask.json()) as { data?: { id?: string } }).data?.id ?? "";
const bFk = await withTimeout(
  request(`/api/data/tasks/${bTaskId}`, {
    method: "PATCH",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ project_id: PROJECT_A }),
  }),
  8000,
  "B FK plant",
);
ok(denied(bFk.status) || bFk.status === 400, `B PATCH task.project_id → A's project: HTTP ${bFk.status}`);
ok((await scalar<string>("SELECT project_id::text FROM tasks WHERE id = $1", [bTaskId])) !== PROJECT_A, "B PATCH FK: B task not pointed at A's project");

const stealDomain = await withTimeout(
  request("/api/data/projects", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ name: "planted on A", domain_id: DOMAIN_A, user_id: a.id }),
  }),
  8000,
  "B plant on A domain",
);
ok(stealDomain.status === 400 || denied(stealDomain.status), `B POST project on A's domain: HTTP ${stealDomain.status}`);
ok((await count("projects", "user_id = $1 AND domain_id = $2", [b.id, DOMAIN_A])) === 0, "B POST: no B project on A domain");

const aStill = await withTimeout(
  request(`/api/data/tasks/${TASK_A}`, { headers: { Authorization: `Bearer ${a.token}` } }),
  8000,
  "A re-read",
);
ok(aStill.status === 200, `A still reads own task: HTTP ${aStill.status}`);

restoreFetch();
restoreIo();
await kysely.destroy();
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("access http isolation: ok");
