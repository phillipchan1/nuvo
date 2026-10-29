// The SPA's own supabase-js builder, through src/lib/workerRoute.ts, against the
// Worker's PostgREST subset on PGlite + Better Auth.
// Run: node --experimental-strip-types worker/src/rest.check.ts
//
// Proves the wire, not a model of it: every call below is a real
// `supabase.from()` / `.rpc()` chain the app makes, and B's bearer can never
// read, change or point at A's rows.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
import { resetRestCatalogForTests } from "./rest.ts";
import { workerRoute } from "../../src/lib/workerRoute.ts";
import app from "./index.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

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

const db = new PGlite();
await applyIsolationSchema(db);
// Prod Neon is Supabase's own public schema (pg_dump); the preview's neon.sql
// lacks the sync columns. Add the ones this suite exercises.
await db.exec(`
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE task_labels ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE sprints ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE external_events ADD COLUMN IF NOT EXISTS raw JSONB;
`);
resetRestCatalogForTests();
const sql = makePgliteSql(db);
const kysely = new Kysely({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new PGliteDriver(db),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const env: Record<string, string> = {
  DATABASE_URL: "postgresql://neondb@ep-prod.us-east-1.aws.neon.tech/nuvo",
  BETTER_AUTH_SECRET: "rest-check-secret-32-bytes-long!!!",
  BETTER_AUTH_URL: "http://localhost:8787",
  ENVIRONMENT: "local",
};

const restoreIo = installRequestIoForTests(() => {
  const auth = createAuth(env as never, { db: kysely, type: "postgres" });
  return { sql, auth, close: async () => {} };
});

const WORKER = "http://localhost:8787";
const SUPABASE = "https://example.supabase.co";

async function call(path: string, init: RequestInit = {}, extraEnv: Record<string, string> = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", WORKER);
  return app.request(`${WORKER}${path}`, { ...init, headers }, { ...env, ...extraEnv });
}

async function signIn(email: string): Promise<{ token: string; id: string }> {
  await call("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, type: "sign-in" }),
  });
  const otp = (
    await db.query<{ value: string }>(
      `SELECT value FROM verification WHERE identifier = $1 ORDER BY "expiresAt" DESC LIMIT 1`,
      [`sign-in-otp-${email}`],
    )
  ).rows[0]?.value.split(":")[0];
  const res = await call("/api/auth/sign-in/email-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, otp }),
  });
  const body = (await res.json()) as { token?: string; user?: { id?: string } };
  ok(res.status === 200 && body.token?.includes("."), `sign-in ${email}: signed token`);
  return { token: body.token ?? "", id: body.user?.id ?? "" };
}

/** The app's client, as `src/lib/supabase.ts` builds it with the flag on. */
let frozen = false;
function clientFor(token: string | null): SupabaseClient {
  const routed: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = workerRoute(url, SUPABASE, `${WORKER}/api`);
    if (!target) throw new Error(`not routed: ${url}`);
    const req = new Request(target, init);
    if (token) req.headers.set("Authorization", `Bearer ${token}`);
    else req.headers.delete("Authorization");
    req.headers.delete("apikey");
    return app.request(req, undefined, { ...env, ...(frozen ? { MAINTENANCE_WRITE_FREEZE: "1" } : {}) });
  };
  return createClient(SUPABASE, "anon-key", {
    global: { fetch: routed },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// --- route mapping -----------------------------------------------------------
ok(workerRoute(`${SUPABASE}/rest/v1/tasks?select=*`, SUPABASE, `${WORKER}/api`) === `${WORKER}/api/rest/v1/tasks?select=*`, "route: PostgREST → /api/rest/v1");
ok(workerRoute(`${SUPABASE}/functions/v1/task-mirror`, SUPABASE, `${WORKER}/api`) === `${WORKER}/functions/v1/task-mirror`, "route: function → Worker twin");
ok(workerRoute(`${SUPABASE}/functions/v1/stripe-checkout`, SUPABASE, `${WORKER}/api`) === null, "route: billing stays on Supabase");
ok(workerRoute(`${SUPABASE}/auth/v1/token`, SUPABASE, `${WORKER}/api`) === null, "route: GoTrue untouched");
ok(workerRoute(`https://elsewhere.test/rest/v1/tasks`, SUPABASE, `${WORKER}/api`) === null, "route: other origins untouched");
ok(workerRoute(`${SUPABASE}/rest/v1/tasks`, SUPABASE, "") === null, "route: flag off → nothing rerouted");

// --- sessions ----------------------------------------------------------------
const a = await signIn("rest-a@example.test");
const b = await signIn("rest-b@example.test");
const A = clientFor(a.token);
const B = clientFor(b.token);
const anon = clientFor(null);

const unauth = await anon.from("tasks").select("*");
ok(unauth.error?.code === "PGRST301", `unauth: PGRST301 (${unauth.error?.code})`);

// --- A builds a small life ---------------------------------------------------
const domainId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const labelId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const stepId = crypto.randomUUID();
{
  const d = await A.from("domains").insert({ id: domainId, user_id: a.id, name: "Work", color: "#123456" });
  ok(!d.error, `A insert domain: ${d.error?.message}`);
  const p = await A.from("projects").insert({ id: projectId, name: "Launch", domain_id: domainId }).select("id").single();
  ok(p.data?.id === projectId, `A insert project → single: ${p.error?.message}`);
  const l = await A.from("labels").insert({ id: labelId, name: "deep" });
  ok(!l.error, `A insert label: ${l.error?.message}`);
  // The outbox's insert: upsert + ignoreDuplicates on the client-minted id.
  const t = await A.from("tasks").upsert(
    {
      id: taskId, title: "Write the brief", status: "planned", project_id: projectId,
      do_date: "2026-10-29", start_time: "2026-10-29T16:00:00Z", duration_minutes: 30,
      field_ts: { title: "2026-10-29T15:00:00.000Z" },
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  ok(!t.error, `A outbox insert task: ${t.error?.message}`);
  const again = await A.from("tasks").upsert({ id: taskId, title: "dupe" }, { onConflict: "id", ignoreDuplicates: true });
  ok(!again.error, "A replayed insert: ignored, not an error");
  const tl = await A.from("task_labels").upsert({ task_id: taskId, label_id: labelId }, { onConflict: "task_id,label_id", ignoreDuplicates: true });
  ok(!tl.error, `A label the task: ${tl.error?.message}`);
  const s = await A.from("tasks").insert({ id: stepId, title: "Outline", status: "planned", parent_task_id: taskId });
  ok(!s.error, `A add a step: ${s.error?.message}`);
}

// --- reads: the app's own queries --------------------------------------------
{
  const row = await A.from("tasks").select("*, task_labels(label_id)").eq("id", taskId).single();
  ok(row.data?.user_id === a.id, "A read own task");
  ok(row.data?.do_date === "2026-10-29", `date stays a date: ${row.data?.do_date}`);
  ok(typeof row.data?.start_time === "string" && row.data.start_time.startsWith("2026-10-29T16:00:00"), `timestamp keeps its offset: ${row.data?.start_time}`);
  ok(Array.isArray(row.data?.task_labels) && row.data.task_labels[0]?.label_id === labelId, "embed task_labels(label_id)");
  const stamped = row.data?.field_ts as Record<string, string> | undefined;
  ok(stamped?.title === "2026-10-29T15:00:00.000Z", "insert keeps the outbox's own field_ts");
  ok(typeof stamped?.status === "string", "insert stamps the unstamped fields (stamp_unstamped_field_ts)");

  const day = await A.from("tasks").select("*, task_labels(label_id)")
    .eq("do_date", "2026-10-29").in("status", ["planned", "done"]).is("parent_task_id", null)
    .order("sort_order").order("created_at");
  ok(day.data?.length === 1 && day.data[0].id === taskId, `useTasks day query: ${day.error?.message ?? day.data?.length}`);

  const ranged = await A.from("tasks").select("id")
    .not("start_time", "is", null).gte("start_time", "2026-10-29T00:00:00Z").lt("start_time", "2026-10-30T00:00:00Z");
  ok(ranged.data?.length === 1, `scheduled range (timestamptz compare): ${ranged.error?.message ?? ranged.data?.length}`);

  const steps = await A.from("tasks").select("id").eq("parent_task_id", taskId).neq("status", "trashed");
  ok(steps.data?.length === 1 && steps.data[0].id === stepId, "steps of a task");

  const paged = await A.from("tasks").select("*").neq("status", "trashed").is("parent_task_id", null)
    .order("sort_order").order("created_at").order("id").range(0, 0);
  ok(paged.data?.length === 1, "range() pages");

  const search = await A.from("tasks").select("id").or("title.ilike.%brief%,notes.ilike.%brief%");
  ok(search.data?.length === 1, `or() + ilike: ${search.error?.message ?? search.data?.length}`);

  const none = await A.from("tasks").select("*").eq("id", crypto.randomUUID()).maybeSingle();
  ok(!none.error && none.data === null, "maybeSingle on nothing → null");
  const notOne = await A.from("tasks").select("*").eq("id", crypto.randomUUID()).single();
  ok(notOne.error?.code === "PGRST116", `single on nothing → PGRST116 (${notOne.error?.code})`);

  const nest = await A.from("initiatives").select("*, key_results(*)").order("sort_order");
  ok(!nest.error, `initiatives + key_results embed: ${nest.error?.message}`);

  const bad = await A.from("tasks").select("nope");
  ok(bad.error?.code === "42703", `unknown column → 42703 (${bad.error?.code})`);
  const unknownTable = await A.from("users").select("*");
  ok(unknownTable.error && unknownTable.status === 404, "tables outside the policy do not exist here");
}

// --- B cannot see, change, delete, or point at A's rows ---------------------
{
  const list = await B.from("tasks").select("*");
  ok(!list.error && !(list.data ?? []).some((r) => r.id === taskId), "B list: no A rows");
  const byId = await B.from("tasks").select("*").eq("id", taskId).maybeSingle();
  ok(byId.data === null, "B by id: nothing");
  const embedded = await B.from("task_labels").select("*").eq("task_id", taskId);
  ok((embedded.data ?? []).length === 0, "B task_labels of A's task: nothing");

  const upd = await B.from("tasks").update({ title: "hijacked" }).eq("id", taskId).select("id");
  ok(!upd.error && (upd.data ?? []).length === 0, "B update A's task: zero rows");
  const merge = await B.from("tasks").upsert({ id: taskId, title: "hijacked" }, { onConflict: "id" });
  ok(merge.error == null || merge.error.code === "23505", "B merge-upsert onto A's id: no write");
  const del = await B.from("tasks").delete().eq("id", taskId);
  ok(!del.error, "B delete A's task: no error, no effect");
  const still = await A.from("tasks").select("title").eq("id", taskId).single();
  ok(still.data?.title === "Write the brief", `A's task untouched by B: ${still.data?.title}`);

  const forged = await B.from("tasks").insert({ title: "as A", user_id: a.id });
  ok(forged.error?.code === "42501", `B insert as A: 42501 (${forged.error?.code})`);
  const plant = await B.from("tasks").insert({ title: "into A's project", project_id: projectId });
  ok(plant.error?.code === "42501", `B FK into A's project: 42501 (${plant.error?.code})`);
  const tag = await B.from("task_labels").insert({ task_id: taskId, label_id: labelId });
  ok(tag.error?.code === "42501", `B label A's task: 42501 (${tag.error?.code})`);
  const patch = await B.rpc("apply_patch", { p_table: "tasks", p_match: { id: taskId }, p_patch: { title: "x" }, p_field_ts: {} });
  ok((patch.data as { matched?: number } | null)?.matched === 0, "B apply_patch on A's id: matched 0");
  const remind = await B.from("reminders").insert({ target_kind: "task", target_id: taskId });
  ok(remind.error?.code === "42501", `B reminder on A's task: 42501 (${remind.error?.code})`);

  await db.query(
    `INSERT INTO contacts_directory (user_id, email, name) VALUES ($1, 'secret-a@example.test', 'Secret A')`,
    [a.id],
  );
  const mine = await A.rpc("contacts", { search: "secret" });
  ok((mine.data as { email: string }[] | null)?.some((c) => c.email === "secret-a@example.test"), `A contacts: own address book ${JSON.stringify(mine.data ?? mine.error)}`);
  const theirs = await B.rpc("contacts", { search: "secret" });
  ok(!(theirs.data as { email: string }[] | null)?.some((c) => c.email === "secret-a@example.test"), "B contacts: not A's");
  await db.query(
    `INSERT INTO external_events (user_id, title, start_at, end_at, raw)
     VALUES ($1, 'A secret meeting', now(), now(), '{"attendees":[{"email":"met-a@example.test","displayName":"Met A"}]}')`,
    [a.id],
  );
  const met = await A.rpc("contacts", { search: "met-a" });
  ok((met.data as { email: string; sources: string[] }[] | null)?.some((c) => c.email === "met-a@example.test" && c.sources.includes("meeting")), `A contacts: people met on events ${JSON.stringify(met.data ?? met.error)}`);
  const notMet = await B.rpc("contacts", { search: "met-a" });
  ok(!(notMet.data as { email: string }[] | null)?.some((c) => c.email === "met-a@example.test"), "B contacts: not A's meetings");
}

// --- writes keep Supabase's rules -------------------------------------------
{
  const deeper = await A.from("tasks").insert({ title: "step of a step", parent_task_id: stepId });
  ok(deeper.error?.code === "23514", `steps are one level deep (${deeper.error?.code})`);
  const unfiltered = await A.from("labels").update({ name: "all" });
  ok(unfiltered.error?.code === "PGRST100", `unfiltered update refused (${unfiltered.error?.code})`);

  // The outbox's update: per-field LWW.
  const newer = await A.rpc("apply_patch", {
    p_table: "tasks", p_match: { id: taskId }, p_patch: { title: "Brief v2" }, p_field_ts: { title: "2026-10-29T15:30:00.000Z" },
  });
  ok((newer.data as { applied?: string[] } | null)?.applied?.includes("title"), `apply_patch newer → applied: ${JSON.stringify(newer.data ?? newer.error)}`);
  const older = await A.rpc("apply_patch", {
    p_table: "tasks", p_match: { id: taskId }, p_patch: { title: "stale" }, p_field_ts: { title: "2026-10-29T15:10:00.000Z" },
  });
  ok((older.data as { rejected?: string[] } | null)?.rejected?.includes("title"), "apply_patch older → rejected");
  const after = await A.from("tasks").select("title, updated_at, created_at").eq("id", taskId).single();
  ok(after.data?.title === "Brief v2", `LWW kept the newer title: ${after.data?.title}`);

  // A natural-key upsert, as useVertical ensures the week's sprint.
  const sprint = await A.from("sprints").upsert({ user_id: a.id, week_start: "2026-10-26" }, { onConflict: "user_id,week_start" }).select("*").single();
  ok(sprint.data?.week_start === "2026-10-26", `sprint upsert on (user_id, week_start): ${sprint.error?.message}`);
  const sprintAgain = await A.from("sprints").upsert({ user_id: a.id, week_start: "2026-10-26" }, { onConflict: "user_id,week_start" }).select("*").single();
  ok(sprintAgain.data?.id === sprint.data?.id, "sprint upsert is idempotent");
  const sprintB = await B.from("sprints").upsert({ user_id: b.id, week_start: "2026-10-26" }, { onConflict: "user_id,week_start" }).select("*").single();
  ok(sprintB.data && sprintB.data.id !== sprint.data?.id, "B's sprint for the same week is B's own");

  // inbound_token only moves through rotate_inbound_token.
  await A.from("user_settings").update({ inbound_token: "forged" }).eq("user_id", a.id);
  const settings = await A.from("user_settings").select("*").maybeSingle();
  ok(settings.data?.inbound_token !== "forged", "inbound_token is not client-writable");
  const rotated = await A.rpc("rotate_inbound_token");
  ok(typeof rotated.data === "string" && rotated.data.length === 12, `rotate_inbound_token: 12 chars (${rotated.data})`);

  const first = await A.rpc("claim_reminder", { p_key: "task:x:start:10", p_fire_at: "2026-10-29T16:00:00.400Z", p_channel: "foreground" });
  const second = await A.rpc("claim_reminder", { p_key: "task:x:start:10", p_fire_at: "2026-10-29T16:00:00Z", p_channel: "push" });
  const other = await B.rpc("claim_reminder", { p_key: "task:x:start:10", p_fire_at: "2026-10-29T16:00:00Z" });
  ok(first.data === true && second.data === false, `claim_reminder: first wins once (${first.data}, ${second.data})`);
  ok(other.data === true, "claim_reminder: per account");

  const contacts = await A.rpc("contacts", { search: "" });
  ok(!contacts.error && Array.isArray(contacts.data), `contacts: ${contacts.error?.message}`);

  const hidden = await A.from("calendar_accounts").select("refresh_token_enc");
  ok(hidden.error != null, "calendar_accounts token columns are not readable");
  const cleanup = await A.from("tasks").delete().eq("id", stepId);
  ok(!cleanup.error, "A delete own step");
  const gone = await A.from("tasks").select("id").eq("id", stepId);
  ok((gone.data ?? []).length === 0, "deleted");
}

// --- freeze ------------------------------------------------------------------
frozen = true;
{
  const read = await A.from("tasks").select("id").eq("id", taskId);
  ok(!read.error && read.data?.length === 1, "frozen: reads still work");
  const write = await A.from("labels").insert({ name: "during freeze" });
  ok(write.error && write.status === 503, `frozen: writes 503 (${write.status})`);
  const contacts = await A.rpc("contacts", { search: "" });
  ok(!contacts.error, "frozen: contacts still answers");
}
frozen = false;

// --- CORS preflight for the builder's headers --------------------------------
{
  const pre = await call("/api/rest/v1/tasks", {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Method": "PATCH",
      "Access-Control-Request-Headers": "authorization, apikey, content-type, prefer, content-profile, x-client-info",
    },
  });
  const allow = pre.headers.get("access-control-allow-headers") ?? "";
  ok(pre.status === 204 && ["prefer", "content-profile", "accept-profile", "authorization"].every((h) => allow.includes(h)), "preflight allows the builder's headers");
}

restoreIo();
await kysely.destroy();
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("rest (PostgREST subset): ok");
