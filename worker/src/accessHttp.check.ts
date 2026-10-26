// HTTP access isolation against PGlite + Better Auth tokens.
// Run: node --experimental-strip-types worker/src/accessHttp.check.ts
// User B's signed bearer cannot read, edit, or delete user A's rows.
// Unauthenticated requests to user-data routes are 401.

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
import { installSubscriptionFetcherForTests, type SubscriptionColumns } from "./entitlement.ts";
import { PLANNER_TABLES, type PlannerTable } from "./store.ts";
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

ok(/sessionUser\(io\.auth/.test(indexSrc), "requireStore: owner comes from verified session");
ok(!/c\.req\.query\(["']user_id["']\)/.test(indexSrc), "routes: no user_id query param");
ok(!/c\.req\.header\(["'](?:x-user-id|user-id)["']\)/i.test(indexSrc), "routes: no client user-id header");
ok(!/body\.user_id/.test(indexSrc), "routes: body.user_id is not an owner key");
ok(/user_id = \$\{store\.userId\}/.test(storeSrc), "store: owner filter is store.userId");
ok(/readEntitlement\(c\.env, got\.user\.id\)/.test(indexSrc), "entitlement: keyed by the verified session id");
ok(!/STRIPE_SECRET/.test(indexSrc), "entitlement route does not read a Stripe secret");

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
  ok(res.status === 200, `OTP sign-in ${email}: HTTP ${res.status} ${text.slice(0, 160)}`);
  const body = JSON.parse(text || "{}") as { token?: string; user?: { id?: string } };
  ok(typeof body.token === "string" && body.token.includes("."), `OTP sign-in ${email}: signed token`);
  ok(typeof body.user?.id === "string", `OTP sign-in ${email}: user id`);
  return { token: body.token ?? "", id: body.user?.id ?? "" };
}

function authHeaders(token: string, extra: Record<string, string> = {}): HeadersInit {
  return { Authorization: `Bearer ${token}`, ...extra };
}

function jsonHeaders(token: string): HeadersInit {
  return authHeaders(token, { "Content-Type": "application/json" });
}

const A_ROW: Record<PlannerTable, string> = {
  tasks: "c0a11e00-2222-4000-8000-000000000001",
  domains: "c0a11e00-0000-4000-8000-000000000001",
  projects: "c0a11e00-1111-4000-8000-000000000001",
  initiatives: "c0a11e00-7777-4000-8000-000000000001",
  key_results: "c0a11e00-8888-4000-8000-000000000001",
  slots: "c0a11e00-9999-4000-8000-000000000001",
  labels: "c0a11e00-3333-4000-8000-000000000001",
  recurrences: "c0a11e00-aaaa-4000-8000-000000000001",
  record_comments: "c0a11e00-bbbb-4000-8000-000000000001",
  week_reviews: "c0a11e00-cccc-4000-8000-000000000001",
  sprints: "c0a11e00-6666-4000-8000-000000000001",
  reminders: "c0a11e00-4444-4000-8000-000000000001",
  event_domain_routing: "c0a11e00-dddd-4000-8000-000000000001",
  user_settings: "", // filled after sign-in
};

const PATCH: Record<PlannerTable, Record<string, unknown>> = {
  tasks: { title: "hijacked" },
  domains: { name: "hijacked" },
  projects: { name: "hijacked" },
  initiatives: { name: "hijacked" },
  key_results: { name: "hijacked" },
  slots: { title: "hijacked" },
  labels: { name: "hijacked" },
  recurrences: { rrule: "FREQ=YEARLY" },
  record_comments: { body: "hijacked" },
  week_reviews: { report: { stolen: true } },
  sprints: { week_start: "1999-01-01" },
  reminders: { anchor: "end" },
  event_domain_routing: { event_key: "stolen" },
  user_settings: { theme: "dark" },
};

const a = await signInOtp("iso-a@example.test");
const b = await signInOtp("iso-b@example.test");
A_ROW.user_settings = a.id;

const primeA = await withTimeout(request("/api/data/user_settings", { headers: authHeaders(a.token) }), 8000, "prime A");
const primeB = await withTimeout(request("/api/data/user_settings", { headers: authHeaders(b.token) }), 8000, "prime B");
ok(primeA.status === 200, `prime A: HTTP ${primeA.status}`);
ok(primeB.status === 200, `prime B: HTTP ${primeB.status}`);

await db.query(
  `INSERT INTO domains (id, user_id, name, color) VALUES ($1, $2, 'A secret domain', '#111111')`,
  [A_ROW.domains, a.id],
);
await db.query(
  `INSERT INTO initiatives (id, user_id, domain_id, name) VALUES ($1, $2, $3, 'A secret initiative')`,
  [A_ROW.initiatives, a.id, A_ROW.domains],
);
await db.query(
  `INSERT INTO projects (id, user_id, name, domain_id) VALUES ($1, $2, 'A secret project', $3)`,
  [A_ROW.projects, a.id, A_ROW.domains],
);
await db.query(
  `INSERT INTO key_results (id, user_id, initiative_id, name) VALUES ($1, $2, $3, 'A secret KR')`,
  [A_ROW.key_results, a.id, A_ROW.initiatives],
);
await db.query(
  `INSERT INTO tasks (id, user_id, title, notes, status, project_id) VALUES ($1, $2, 'A secret task', 'private', 'inbox', $3)`,
  [A_ROW.tasks, a.id, A_ROW.projects],
);
await db.query(
  `INSERT INTO labels (id, user_id, name) VALUES ($1, $2, 'A secret tag')`,
  [A_ROW.labels, a.id],
);
await db.query(
  `INSERT INTO task_labels (task_id, label_id) VALUES ($1, $2)`,
  [A_ROW.tasks, A_ROW.labels],
);
await db.query(
  `INSERT INTO slots (id, user_id, title, do_date, start_time, duration_minutes, project_id) VALUES ($1, $2, 'A secret slot', '2026-10-26', '2026-10-26T09:00:00Z', 60, $3)`,
  [A_ROW.slots, a.id, A_ROW.projects],
);
await db.query(
  `INSERT INTO recurrences (id, user_id, kind, rrule) VALUES ($1, $2, 'task', 'FREQ=WEEKLY')`,
  [A_ROW.recurrences, a.id],
);
await db.query(
  `INSERT INTO record_comments (id, user_id, project_id, body) VALUES ($1, $2, $3, 'A secret note')`,
  [A_ROW.record_comments, a.id, A_ROW.projects],
);
await db.query(
  `INSERT INTO week_reviews (id, user_id, week_start) VALUES ($1, $2, '2026-10-26')`,
  [A_ROW.week_reviews, a.id],
);
await db.query(
  `INSERT INTO sprints (id, user_id, week_start) VALUES ($1, $2, '2026-10-26')`,
  [A_ROW.sprints, a.id],
);
await db.query(
  `INSERT INTO reminders (id, user_id, target_kind, target_id) VALUES ($1, $2, 'task', $3)`,
  [A_ROW.reminders, a.id, A_ROW.tasks],
);
await db.query(
  `INSERT INTO event_domain_routing (id, user_id, event_key, domain_id) VALUES ($1, $2, 'evt-secret-a', $3)`,
  [A_ROW.event_domain_routing, a.id, A_ROW.domains],
);
await db.query(
  `INSERT INTO contacts_directory (id, user_id, email, name) VALUES ($1, $2, 'secret-a@example.test', 'Secret A')`,
  ["c0a11e00-5555-4000-8000-000000000001", a.id],
);
await db.query(`UPDATE user_settings SET theme = 'light', inbound_token = 'token-a-secret' WHERE user_id = $1`, [a.id]);

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

const unauth: { method: string; path: string; body?: Record<string, unknown> }[] = [
  ...PLANNER_TABLES.flatMap((table) => {
    const id = A_ROW[table];
    return [
      { method: "GET", path: `/api/data/${table}` },
      { method: "GET", path: `/api/data/${table}/${id}` },
      { method: "POST", path: `/api/data/${table}`, body: { name: "no", title: "no" } },
      { method: "PATCH", path: `/api/data/${table}/${id}`, body: PATCH[table] },
      { method: "DELETE", path: `/api/data/${table}/${id}` },
    ];
  }),
  { method: "GET", path: `/api/data/task_labels?task_id=${A_ROW.tasks}` },
  { method: "POST", path: "/api/data/task_labels", body: { task_id: A_ROW.tasks, label_id: A_ROW.labels } },
  { method: "DELETE", path: `/api/data/task_labels?task_id=${A_ROW.tasks}&label_id=${A_ROW.labels}` },
  { method: "POST", path: "/api/rpc/apply_patch", body: { p_table: "tasks", p_match: { id: A_ROW.tasks }, p_patch: { title: "no" } } },
  { method: "POST", path: "/api/rpc/contacts", body: { search: "secret" } },
  { method: "POST", path: "/api/rpc/rotate_inbound_token" },
  { method: "POST", path: "/api/rpc/claim_reminder", body: { reminder_key: A_ROW.reminders, fire_at: "2026-10-26T09:00:00Z" } },
  { method: "GET", path: "/api/entitlement" },
  { method: "POST", path: "/api/entitlement", body: { name: "no" } },
  { method: "PATCH", path: "/api/entitlement", body: { name: "no" } },
  { method: "DELETE", path: "/api/entitlement" },
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

for (const table of PLANNER_TABLES) {
  const id = A_ROW[table];
  const list = await withTimeout(
    request(`/api/data/${table}`, { headers: authHeaders(b.token) }),
    8000,
    `B list ${table}`,
  );
  ok(list.status === 200, `B list ${table}: HTTP ${list.status}`);
  const listed = (await list.json()) as { data?: { id?: string; user_id?: string }[] };
  const rows = Array.isArray(listed.data) ? listed.data : [];
  if (table === "user_settings") {
    ok(rows.every((row) => row.user_id === b.id), `B list ${table}: only own settings`);
    ok(!rows.some((row) => row.user_id === a.id), `B list ${table}: omits A`);
  } else {
    ok(!rows.some((row) => row.id === id), `B list ${table}: omits A's row`);
  }

  const read = await withTimeout(
    request(`/api/data/${table}/${id}`, { headers: authHeaders(b.token) }),
    8000,
    `B get ${table}`,
  );
  ok(denied(read.status), `B get ${table}/${id}: HTTP ${read.status} (403/404)`);

  const headerSpoof = await withTimeout(
    request(`/api/data/${table}/${id}`, {
      headers: authHeaders(b.token, { "X-User-Id": a.id }),
    }),
    8000,
    `B get ${table} spoof header`,
  );
  ok(denied(headerSpoof.status), `B get ${table} with X-User-Id:A: HTTP ${headerSpoof.status}`);

  const patch = await withTimeout(
    request(`/api/data/${table}/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(b.token),
      body: JSON.stringify(PATCH[table]),
    }),
    8000,
    `B patch ${table}`,
  );
  ok(denied(patch.status), `B patch ${table}/${id}: HTTP ${patch.status} (403/404)`);

  const del = await withTimeout(
    request(`/api/data/${table}/${id}`, {
      method: "DELETE",
      headers: authHeaders(b.token),
    }),
    8000,
    `B delete ${table}`,
  );
  ok(denied(del.status), `B delete ${table}/${id}: HTTP ${del.status} (403/404)`);

  const still = table === "user_settings"
    ? await count("user_settings", "user_id = $1", [a.id])
    : await count(table, "id = $1 AND user_id = $2", [id, a.id]);
  ok(still === 1, `B mutate ${table}: A's row still present`);
}

ok((await scalar<string>("SELECT title FROM tasks WHERE id = $1", [A_ROW.tasks])) === "A secret task", "B patch: A task title unchanged");
ok((await scalar<string>("SELECT name FROM domains WHERE id = $1", [A_ROW.domains])) === "A secret domain", "B patch: A domain name unchanged");
ok((await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [a.id])) === "light", "B patch: A theme unchanged");

const labels = await withTimeout(
  request(`/api/data/task_labels?task_id=${A_ROW.tasks}`, { headers: authHeaders(b.token) }),
  8000,
  "B list task_labels",
);
ok(labels.status === 200, `B list task_labels: HTTP ${labels.status}`);
const labelBody = (await labels.json()) as { data?: unknown[] };
ok(Array.isArray(labelBody.data) && labelBody.data.length === 0, "B list task_labels: empty for A's task");

const tag = await withTimeout(
  request("/api/data/task_labels", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ task_id: A_ROW.tasks, label_id: A_ROW.labels }),
  }),
  8000,
  "B insert task_label",
);
ok(denied(tag.status) || tag.status === 400, `B insert task_label: HTTP ${tag.status}`);
ok((await count("task_labels", "task_id = $1 AND label_id = $2", [A_ROW.tasks, A_ROW.labels])) === 1, "B insert task_label: A's link unchanged");

const untag = await withTimeout(
  request(`/api/data/task_labels?task_id=${A_ROW.tasks}&label_id=${A_ROW.labels}`, {
    method: "DELETE",
    headers: authHeaders(b.token),
  }),
  8000,
  "B delete task_label",
);
const untagBody = (await untag.json()) as { deleted?: number };
ok(untag.status === 200 && untagBody.deleted === 0, `B delete task_label: deleted=${untagBody.deleted}`);
ok((await count("task_labels", "task_id = $1", [A_ROW.tasks])) === 1, "B delete task_label: A's link still present");

const sneak = await withTimeout(
  request("/api/rpc/apply_patch", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ p_table: "tasks", p_match: { id: A_ROW.tasks }, p_patch: { title: "patched by B" } }),
  }),
  8000,
  "B apply_patch task",
);
const sneakBody = (await sneak.json()) as { data?: { matched?: number } };
ok(sneak.status === 200 && sneakBody.data?.matched === 0, `B apply_patch task: matched=${sneakBody.data?.matched}`);
ok((await scalar<string>("SELECT title FROM tasks WHERE id = $1", [A_ROW.tasks])) === "A secret task", "B apply_patch: A title unchanged");

const sneakTheme = await withTimeout(
  request("/api/rpc/apply_patch", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ p_table: "user_settings", p_match: { id: a.id }, p_patch: { theme: "dark" } }),
  }),
  8000,
  "B apply_patch settings",
);
const sneakThemeBody = (await sneakTheme.json()) as { data?: { matched?: number } };
ok(sneakTheme.status === 200 && sneakThemeBody.data?.matched === 0, "B apply_patch settings: matched 0");
ok((await scalar<string>("SELECT theme FROM user_settings WHERE user_id = $1", [a.id])) === "light", "B apply_patch settings: A theme unchanged");

const book = await withTimeout(
  request("/api/rpc/contacts", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ search: "secret" }),
  }),
  8000,
  "B contacts",
);
ok(book.status === 200, `B contacts: HTTP ${book.status}`);
const bookBody = (await book.json()) as { data?: { email?: string }[] };
ok(Array.isArray(bookBody.data) && !bookBody.data.some((c) => c.email === "secret-a@example.test"), "B contacts: omits A's contact");

const rotate = await withTimeout(
  request("/api/rpc/rotate_inbound_token", { method: "POST", headers: authHeaders(b.token) }),
  8000,
  "B rotate",
);
ok(rotate.status === 200, `B rotate: HTTP ${rotate.status}`);
ok((await scalar<string>("SELECT inbound_token FROM user_settings WHERE user_id = $1", [a.id])) === "token-a-secret", "B rotate: A inbound_token unchanged");

const claim = await withTimeout(
  request("/api/rpc/claim_reminder", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ reminder_key: A_ROW.reminders, fire_at: "2026-10-26T09:00:00Z" }),
  }),
  8000,
  "B claim",
);
ok(denied(claim.status) || claim.status === 400, `B claim_reminder: HTTP ${claim.status}`);
ok((await count("reminder_deliveries", "user_id = $1", [a.id])) === 0, "B claim_reminder: no delivery on A");

const forged = await withTimeout(
  request("/api/data/tasks", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ title: "forged as A", user_id: a.id }),
  }),
  8000,
  "B forged user_id",
);
ok(forged.status === 200, `B POST task with A's user_id: HTTP ${forged.status}`);
const forgedBody = (await forged.json()) as { data?: { user_id?: string; id?: string } };
ok(forgedBody.data?.user_id === b.id, "B POST: client user_id ignored; row is B's");
ok((await count("tasks", "user_id = $1 AND title = $2", [a.id, "forged as A"])) === 0, "B POST: no row planted on A");

const stealDomain = await withTimeout(
  request("/api/data/projects", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ name: "planted on A", domain_id: A_ROW.domains, user_id: a.id }),
  }),
  8000,
  "B plant on A domain",
);
ok(stealDomain.status === 400 || denied(stealDomain.status), `B POST project on A's domain: HTTP ${stealDomain.status}`);
ok((await count("projects", "user_id = $1 AND domain_id = $2", [b.id, A_ROW.domains])) === 0, "B POST: no B project on A domain");
ok((await count("projects", "id = $1", [A_ROW.projects])) === 1, "B POST: A project still present");

const aOwn = await withTimeout(
  request(`/api/data/tasks/${A_ROW.tasks}`, { headers: authHeaders(a.token) }),
  8000,
  "A re-read",
);
ok(aOwn.status === 200, `A still reads own task: HTTP ${aOwn.status}`);
const aOwnBody = (await aOwn.json()) as { data?: { title?: string } };
ok(aOwnBody.data?.title === "A secret task", "A still reads own task title");

const restoreSubs = installSubscriptionFetcherForTests(async (_env, userId) => {
  const rows: Record<string, SubscriptionColumns> = {
    [a.id]: {
      user_id: a.id,
      status: "active",
      trial_ends_at: "2026-08-01T00:00:00Z",
      plan_source: "stripe",
    },
    [b.id]: {
      user_id: b.id,
      status: "trialing",
      trial_ends_at: "2026-11-01T00:00:00Z",
      plan_source: null,
    },
  };
  return rows[userId] ?? null;
});

const aEnt = await withTimeout(request("/api/entitlement", { headers: authHeaders(a.token) }), 8000, "A entitlement");
ok(aEnt.status === 200, `A entitlement: HTTP ${aEnt.status}`);
const aEntBody = (await aEnt.json()) as { entitled?: boolean; plan?: string; plan_source?: string };
ok(aEntBody.entitled === true && aEntBody.plan === "active", "A entitlement: own Stripe-active row");
ok(aEntBody.plan_source === "stripe", "A entitlement: stripe source");

const bEnt = await withTimeout(
  request(`/api/entitlement?user_id=${a.id}`, { headers: authHeaders(b.token, { "X-User-Id": a.id }) }),
  8000,
  "B entitlement spoof",
);
ok(bEnt.status === 200, `B entitlement: HTTP ${bEnt.status}`);
const bEntBody = (await bEnt.json()) as { entitled?: boolean; plan?: string; plan_source?: string | null };
ok(bEntBody.plan === "trialing" && bEntBody.plan_source == null, "B entitlement: own trial, not A's paid row");
ok(bEntBody.entitled === true, "B entitlement: live trial is entitled");

const postExisting = await withTimeout(
  request("/api/entitlement", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ user_id: a.id, entitled: true }),
  }),
  8000,
  "B POST entitlement with A's id",
);
const postMissing = await withTimeout(
  request("/api/entitlement", {
    method: "POST",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ user_id: "00000000-0000-4000-8000-000000000099", entitled: true }),
  }),
  8000,
  "B POST entitlement with unknown id",
);
ok(postExisting.status === 404, `B POST entitlement A's id: HTTP ${postExisting.status}`);
ok(postMissing.status === 404, `B POST entitlement unknown id: HTTP ${postMissing.status}`);
const postExistingText = await postExisting.text();
const postMissingText = await postMissing.text();
ok(postExistingText === postMissingText, "B POST entitlement: same body — no existence oracle");

const patchEnt = await withTimeout(
  request("/api/entitlement", {
    method: "PATCH",
    headers: jsonHeaders(b.token),
    body: JSON.stringify({ user_id: a.id, status: "cancelled" }),
  }),
  8000,
  "B PATCH entitlement",
);
ok(patchEnt.status === 404, `B PATCH entitlement: HTTP ${patchEnt.status}`);

const aEntAgain = await withTimeout(request("/api/entitlement", { headers: authHeaders(a.token) }), 8000, "A entitlement after B write");
const aEntAgainBody = (await aEntAgain.json()) as { plan?: string };
ok(aEntAgain.status === 200 && aEntAgainBody.plan === "active", "B write attempt did not change A's entitlement");

restoreSubs();
restore();
await kysely.destroy();
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("access http isolation: ok");
