// The change marker (D-245): a quiet feed poll answers from the edge with zero
// SQL, any write by any writer voids that, and every way the marker can be
// missing, cold or wrong falls back to asking Postgres.
// Run: node --experimental-strip-types worker/src/syncMarker.check.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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
import { resetSyncFeedForTests, type FeedAnswer } from "./syncFeed.ts";
import {
  CRED_TTL_MS,
  MarkerState,
  PROOF_TTL_MS,
  SyncMarker,
  TICKET_TTL_MS,
  credentialKey,
  endsSession,
  feedPokeFor,
  type Ticket,
} from "./syncMarker.ts";
import { workerRoute } from "../../src/lib/workerRoute.ts";
import app from "./index.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

// ── The state machine ───────────────────────────────────────────────────────
{
  const T = Date.UTC(2026, 10, 17, 12, 0, 0);
  const s = new MarkerState("inc-1");
  const miss = (a: ReturnType<MarkerState["check"]>) => (a.quiet ? null : a.ticket);
  const prove = (ticket: Ticket, since: string, cursor = since, now = T, extra: Partial<{ cred: string; user: string; quiet: boolean; sessionUntil: number }> = {}) =>
    s.prove({ cred: "credA", user: "A", ticket, since, cursor, quiet: true, ...extra }, now);

  const t0 = miss(s.check("credA", "100", T));
  ok(t0, "cold: an unknown credential is asked about");
  ok(prove(t0!, "100", "105"), "an empty Postgres answer is recorded as a proof");
  ok(s.check("credA", "105", T + 1).quiet, "the cursor Postgres handed back is answered at the edge");
  ok(s.check("credA", "100", T + 1).quiet, "…and the one it was asked with");
  ok(!s.check("credA", "99", T + 1).quiet, "a cursor below the proof is asked about");
  ok(!s.check("credA", "106", T + 1).quiet, "a cursor the proof never handed out is asked about");
  ok(!s.check("credB", "105", T + 1).quiet, "another credential is unknown");
  ok(!s.check("credA", null, T + 1).quiet && !s.check("credA", "nope", T + 1).quiet, "no cursor or a malformed one is asked about");
  ok(!s.check(null, "105", T + 1).quiet, "no credential is asked about");
  ok(!s.check("credA", "105", T + 1, true).quiet, "p_fresh always asks Postgres");

  s.poke({ users: ["B"] }, T + 2);
  ok(s.check("credA", "105", T + 3).quiet, "another account's write leaves the proof standing");
  s.poke({ users: ["A"] }, T + 4);
  ok(!s.check("credA", "105", T + 5).quiet, "a write to the account voids its proof");

  // The race the ticket exists for: a write commits while the feed query runs.
  const t1 = miss(s.check("credA", "105", T + 6))!;
  s.poke({ users: ["A"] }, T + 7);
  ok(!prove(t1, "105", "105", T + 8), "a proof whose ticket predates a poke is refused");
  ok(!s.check("credA", "105", T + 9).quiet, "…so the write is asked about next time");
  const t2 = miss(s.check("credA", "105", T + 10))!;
  ok(prove(t2, "105", "110", T + 11), "a ticket with no poke after it proves");

  // A second device of the same account, further behind.
  const t3 = miss(s.check("credA2", "90", T + 12))!;
  ok(prove(t3, "90", "110", T + 13, { cred: "credA2" }), "a second device proves its own cursor");
  ok(s.check("credA2", "90", T + 14).quiet && s.check("credA", "110", T + 14).quiet, "both devices are answered at the edge");

  // Stale or foreign tickets.
  const t4 = miss(s.check("credA", "1", T + 15))!;
  ok(!prove({ ...t4, inc: "inc-0" }, "1", "1", T + 16), "a ticket from another incarnation is refused");
  ok(!prove(t4, "1", "1", T + 15 + TICKET_TTL_MS + 1), "a ticket older than its TTL is refused");
  ok(!prove({ ...t4, clock: t4.clock + 99 }, "1", "1", T + 16), "a ticket from the future is refused");
  ok(!prove(t4, "5", "1", T + 16), "a cursor that went backwards is refused");

  // A non-empty answer teaches the credential but proves nothing.
  const t5 = miss(s.check("credC", "50", T + 20))!;
  ok(!s.prove({ cred: "credC", user: "C", ticket: t5, since: "50", cursor: "55", quiet: false }, T + 21), "a non-empty answer is no proof");
  ok(s.creds.get("credC")?.user === "C", "…but the verified credential is remembered");

  // Everyone.
  const tAll = miss(s.check("credA", "1", T + 22))!;
  s.poke({ all: true }, T + 23);
  ok(!s.check("credA", "110", T + 24).quiet && !s.check("credA2", "90", T + 24).quiet, "an unscoped poke voids every proof");
  ok(!prove(tAll, "110", "110", T + 25), "…and every ticket issued before it");

  // Time.
  const t6 = miss(s.check("credA", "110", T + 30))!;
  prove(t6, "110", "110", T + 30);
  ok(s.check("credA", "110", T + 30 + PROOF_TTL_MS - 1).quiet, "a proof stands until its TTL");
  ok(!s.check("credA", "110", T + 30 + PROOF_TTL_MS).quiet, "no proof outlives its TTL (the backstop for a writer that never pokes)");
  ok(CRED_TTL_MS <= PROOF_TTL_MS, "a credential is never trusted longer than a proof");

  const t7 = miss(s.check("credS", "1", T + 40))!;
  prove(t7, "1", "1", T + 40, { cred: "credS", user: "S", sessionUntil: T + 1000 });
  ok(s.check("credS", "1", T + 999).quiet && !s.check("credS", "1", T + 1000).quiet, "a credential is forgotten when its session expires");
  const t8 = miss(s.check("credD", "1", T + 50))!;
  prove(t8, "1", "1", T + 50, { cred: "credD", user: "D" });
  s.poke({ dropCreds: ["credD"] }, T + 51);
  ok(!s.check("credD", "1", T + 52).quiet, "a signed-out credential is forgotten");

  // Memory.
  s.sweep(T + 30 + PROOF_TTL_MS + TICKET_TTL_MS + 1);
  ok(s.users.size === 0, "the sweep forgets accounts with no standing proof and no recent poke");
}

// ── Storage round trip ──────────────────────────────────────────────────────
{
  const T = Date.UTC(2026, 10, 17, 13, 0, 0);
  const disk = new Map<string, unknown>();
  const flush = (st: MarkerState) => {
    for (const [k, v] of st.takeDirty()) v == null ? disk.delete(k) : disk.set(k, structuredClone(v));
  };
  const s1 = new MarkerState("inc-A");
  const t = s1.check("cred", "7", T);
  if (!t.quiet) s1.prove({ cred: "cred", user: "U", ticket: t.ticket, since: "7", cursor: "9", quiet: true }, T);
  s1.poke({ users: ["V"] }, T + 1);
  flush(s1);
  const s2 = MarkerState.restore(disk);
  ok(s2.inc === "inc-A" && s2.clock === s1.clock, "restore keeps the incarnation and the clock");
  ok(s2.check("cred", "8", T + 2).quiet, "a proof survives a restart");
  s2.poke({ users: ["U"] }, T + 3);
  flush(s2);
  ok(!MarkerState.restore(disk).check("cred", "8", T + 4).quiet, "…and so does the poke that voids it");
  disk.set("u:W", { inc: "inc-other", pokedAt: 0, pokedAtMs: 0, proof: { clock: 999, at: T, floor: "0", ceil: "99" } });
  disk.set("c:credW", { inc: "inc-other", user: "W", until: T + PROOF_TTL_MS });
  ok(!MarkerState.restore(disk).check("credW", "5", T + 5).quiet, "a record from another incarnation is ignored");
  disk.delete("meta");
  const s3 = MarkerState.restore(disk);
  ok(s3.inc !== "inc-A" && !s3.check("cred", "8", T + 6).quiet, "no meta → a fresh incarnation that trusts nothing");
}

// ── Which requests poke ─────────────────────────────────────────────────────
{
  const base = { touchedDb: true, status: 200, user: "u1" as string | null };
  const p = (method: string, path: string, over: Partial<typeof base> = {}) => feedPokeFor({ ...base, ...over, method, path });
  ok(JSON.stringify(p("POST", "/api/rest/v1/rpc/apply_patch")) === '{"users":["u1"]}', "the outbox's write pokes its account");
  ok(p("PATCH", "/api/rest/v1/tasks") && p("DELETE", "/api/rest/v1/tasks") && p("POST", "/api/rest/v1/tasks"), "REST writes poke");
  ok(p("POST", "/api/mcp") && p("POST", "/api/agent") && p("POST", "/api/capture") && p("POST", "/api/route-events"), "agent, MCP, capture and routing poke");
  ok(p("GET", "/api/rollover"), "a GET on an app.all route pokes (any method may write)");
  ok(p("GET", "/api/google-oauth", { user: null }) !== null, "an OAuth callback with no session pokes everyone");
  ok(p("GET", "/api/rest/v1/tasks") === null, "a REST read does not poke");
  ok(p("POST", "/api/rest/v1/rpc/sync_changes") === null && p("POST", "/api/rest/v1/rpc/contacts") === null, "the feed and contacts do not poke");
  ok(p("POST", "/api/rest/v1/tasks", { touchedDb: false }) === null, "no database, no write");
  ok(p("POST", "/api/rest/v1/tasks", { status: 409 }) !== null, "a refused write with a known account still pokes it");
  ok(p("POST", "/api/rest/v1/tasks", { status: 401, user: null }) === null, "a refused request with no account pokes nobody");
  ok(JSON.stringify(p("POST", "/api/cron/rollover", { user: null })) === '{"all":true}', "a cron route (no account) pokes everyone");
  ok(JSON.stringify(p("POST", "/api/google-webhook", { user: null, status: 500 })) === '{"all":true}', "a 5xx with no account pokes everyone");
  ok(p("POST", "/api/auth/sign-in/email-otp") === null, "auth routes write only Better Auth's tables");
  ok(endsSession("POST", "/api/auth/sign-out") && !endsSession("GET", "/api/auth/get-session"), "sign-out ends the session's credential");
  const k1 = await credentialKey(new Headers({ authorization: "Bearer t.s", cookie: "x=1; better-auth.session_token=a.b" }));
  const k2 = await credentialKey(new Headers({ authorization: "Bearer t.s", cookie: "better-auth.session_token=a.b; y=2" }));
  const k3 = await credentialKey(new Headers({ authorization: "Bearer other.s" }));
  ok(k1 && k1 === k2, "the credential key ignores unrelated cookies");
  ok(k3 && k3 !== k1, "different credentials, different keys");
  ok((await credentialKey(new Headers({ cookie: "theme=dark" }))) === null, "no session credential → no key");
  ok(!k1!.includes("t.s"), "the key never contains the token");
}

// ── End to end on PGlite: the Worker, Better Auth, the feed, the marker ─────
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
  async beginTransaction(c: DatabaseConnection): Promise<void> {
    await c.executeQuery(CompiledQuery.raw("BEGIN"));
  }
  async commitTransaction(c: DatabaseConnection): Promise<void> {
    await c.executeQuery(CompiledQuery.raw("COMMIT"));
  }
  async rollbackTransaction(c: DatabaseConnection): Promise<void> {
    await c.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

const db = new PGlite();
await applyIsolationSchema(db);
await db.exec(`
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE task_labels ADD COLUMN IF NOT EXISTS field_ts JSONB NOT NULL DEFAULT '{}'::jsonb;
`);
resetRestCatalogForTests();
resetSyncFeedForTests();

// Every statement anyone sends — the Worker's client and Better Auth's — counts.
let statements = 0;
const rawQuery = db.query.bind(db);
const rawExec = db.exec.bind(db);
(db as unknown as { query: unknown }).query = (...args: Parameters<PGlite["query"]>) => {
  statements += 1;
  return rawQuery(...args);
};
(db as unknown as { exec: unknown }).exec = (...args: Parameters<PGlite["exec"]>) => {
  statements += 1;
  return rawExec(...args);
};
const sql = makePgliteSql(db);
const kysely = new Kysely({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new PGliteDriver(db),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});
const baseEnv: Record<string, unknown> = {
  DATABASE_URL: "postgresql://neondb@ep-prod.us-east-1.aws.neon.tech/nuvo",
  BETTER_AUTH_SECRET: "marker-check-secret-32-bytes-long!!",
  BETTER_AUTH_URL: "http://localhost:8787",
  ENVIRONMENT: "local",
};
const restoreIo = installRequestIoForTests(() => {
  const auth = createAuth(baseEnv as never, { db: kysely, type: "postgres" });
  return { sql, auth, close: async () => {} };
});

/** The real class over Map storage. `evict()` drops the object, keeps storage (what a DO does after
 *  a few idle seconds); `wipe()` loses storage too; `broken` fails every call like a dead DO. */
function markerNamespace() {
  let store = new Map<string, unknown>();
  const make = () =>
    new SyncMarker({
      storage: {
        list: async <T>() => new Map([...store].map(([k, v]) => [k, structuredClone(v) as T])),
        put: async (entries: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(entries)) store.set(k, structuredClone(v));
        },
        delete: async (keys: string[]) => keys.filter((k) => store.delete(k)).length,
      },
      blockConcurrencyWhile: (fn) => fn(),
    });
  let instance = make();
  const ns = {
    calls: 0,
    broken: false,
    get stored() {
      return store.size;
    },
    evict() {
      instance = make();
    },
    wipe() {
      store = new Map();
      instance = make();
    },
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (input: string, init?: RequestInit) => {
        ns.calls += 1;
        if (ns.broken) throw new Error("durable object unavailable");
        return instance.fetch(new Request(input, init));
      },
    }),
  };
  return ns;
}
const marker = markerNamespace();
let env: Record<string, unknown> = { ...baseEnv, SYNC_MARKER: marker };

const WORKER = "http://localhost:8787";
const SUPABASE = "https://example.supabase.co";
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} };
async function settle() {
  while (pending.length) await pending.shift();
}
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", WORKER);
  const res = await app.request(`${WORKER}${path}`, { ...init, headers }, env, ctx as never);
  await settle();
  return res;
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
  ok(res.status === 200 && body.token, `sign-in ${email}`);
  return { token: body.token ?? "", id: body.user?.id ?? "" };
}
function clientFor(token: string): SupabaseClient {
  const routed: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = workerRoute(url, SUPABASE, `${WORKER}/api`);
    if (!target) throw new Error(`not routed: ${url}`);
    const req = new Request(target, init);
    req.headers.set("Authorization", `Bearer ${token}`);
    req.headers.delete("apikey");
    const res = await app.request(req, undefined, env, ctx as never);
    await settle();
    return res;
  };
  return createClient(SUPABASE, "anon-key", {
    global: { fetch: routed },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
/** One feed poll: the answer and how many statements it cost. */
async function poll(client: SupabaseClient, since: string | null, fresh = false) {
  const before = statements;
  const { data, error } = await client.rpc("sync_changes", fresh ? { p_since: since, p_fresh: true } : { p_since: since });
  if (error) return { error, sql: statements - before, answer: null as Extract<FeedAnswer, { mode: "delta" }> | null };
  return { error: null, sql: statements - before, answer: data as Extract<FeedAnswer, { mode: "delta" }> };
}
const age = () => rawExec(`UPDATE sync_changes SET at = at - interval '1 hour'`);

const a = await signIn("marker-a@example.test");
const phone = await signIn("marker-a@example.test");
const b = await signIn("marker-b@example.test");
ok(a.id === phone.id && a.token !== phone.token, "the Mac and the phone are two sessions of one account");
const Mac = clientFor(a.token);
const Phone = clientFor(phone.token);
const B = clientFor(b.token);

const taskId = crypto.randomUUID();
{
  const t = await Phone.from("tasks").insert({ id: taskId, title: "Write the brief", status: "planned" });
  ok(!t.error, `seed task: ${t.error?.message}`);
}
await B.from("tasks").insert({ id: crypto.randomUUID(), title: "B's own", status: "planned" });
await age();

// Launch: no cursor → Postgres, reset.
let r = await poll(Mac, null);
ok(r.answer?.reset && r.sql > 0, "launch: no cursor asks Postgres and resets");
let cursor = r.answer!.cursor;

// First poll with a cursor: cold marker → Postgres, empty → proven.
r = await poll(Mac, cursor);
ok(!r.error && r.sql > 0 && r.answer?.changes.length === 0, "a cold marker asks Postgres");
cursor = r.answer!.cursor;

// The idle hour: every minute's poll is answered with no SQL at all.
let idleSql = 0;
for (let minute = 0; minute < 60; minute++) {
  r = await poll(Mac, cursor);
  idleSql += r.sql;
  ok(r.answer?.mode === "delta" && !r.answer.reset && r.answer.changes.length === 0 && r.answer.cursor === cursor, `idle minute ${minute}: nothing moved`);
}
ok(idleSql === 0, `an idle hour of polls costs zero SQL statements (got ${idleSql})`);

// A Durable Object is evicted after a few idle seconds; a feed polls once a
// minute. The first build kept this in memory and was empty at every real poll.
marker.evict();
r = await poll(Mac, cursor);
ok(r.sql === 0, "an evicted marker answers from storage: still zero SQL");

// Another account's write: still quiet for A.
await B.from("tasks").insert({ id: crypto.randomUUID(), title: "B again", status: "planned" });
r = await poll(Mac, cursor);
ok(r.sql === 0, "another account's write leaves A's poll at the edge");

// The phone edits A's task: the Mac's next poll asks Postgres and gets it.
const edit = await Phone.from("tasks").update({ title: "moved on the phone" }).eq("id", taskId);
ok(!edit.error, `phone edit: ${edit.error?.message}`);
r = await poll(Mac, cursor);
ok(r.sql > 0, "after the phone's write the Mac asks Postgres");
ok(r.answer?.changes.some((c) => c.table === "tasks" && c.new?.title === "moved on the phone"), "…and the phone's edit arrives on the next poll");
cursor = r.answer!.cursor;
await age();
r = await poll(Mac, cursor);
cursor = r.answer!.cursor;
r = await poll(Mac, cursor);
ok(r.answer?.changes.length === 0, "once settled, nothing more moves");
r = await poll(Mac, cursor);
ok(r.sql === 0, "…and the Mac is back at the edge");

// The writer itself: its forced post-write poll asks Postgres.
r = await poll(Phone, cursor, true);
ok(r.sql > 0, "p_fresh (a poll after this device's own write) asks Postgres");

// The agent / MCP path writes through its own route — covered by the same catch-all.
{
  const before = marker.calls;
  const res = await call("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${phone.token}` },
    body: JSON.stringify({ tool: "update_task", args: { id: taskId, title: "renamed by the agent" } }),
  });
  ok(res.status < 500 && marker.calls > before, `an agent write pokes the marker (${res.status})`);
  r = await poll(Mac, cursor);
  ok(r.sql > 0, "…so the Mac asks Postgres after it");
  await age();
  cursor = (await poll(Mac, cursor)).answer!.cursor;
  await poll(Mac, cursor);
}

// A writer that never pokes (psql, a migration): hidden until the proof's TTL.
await rawExec(`UPDATE tasks SET title = 'edited in psql' WHERE id = '${taskId}'`);
r = await poll(Mac, cursor);
ok(r.sql === 0, "a write outside the Worker is not seen at the edge (PROOF_TTL_MS is the backstop)");

// Lost storage: a new incarnation trusts nothing → Postgres.
marker.wipe();
r = await poll(Mac, cursor);
ok(r.sql > 0 && r.answer?.changes.some((c) => c.new?.title === "edited in psql"), "a marker that lost its storage asks Postgres (and finds the out-of-band write)");
await age();
cursor = (await poll(Mac, cursor)).answer!.cursor;
r = await poll(Mac, cursor);
r = await poll(Mac, cursor);
ok(r.sql === 0, "…and is warm again after one empty answer");

// Dead marker: fail open.
marker.broken = true;
r = await poll(Mac, cursor);
ok(!r.error && r.sql > 0, "a failing marker falls back to Postgres");
const brokenEdit = await Phone.from("tasks").update({ title: "edited while the marker was down" }).eq("id", taskId);
ok(!brokenEdit.error, "a write still succeeds while the marker is down");
marker.broken = false;
// The one gap: that write's poke never landed, and the proof is stored.
r = await poll(Mac, cursor);
ok(r.sql === 0, "a poke lost to an outage leaves the proof standing (the documented gap)");
r = await poll(Mac, cursor, true);
ok(r.answer?.changes.some((c) => c.new?.title === "edited while the marker was down"), "…which a launch or post-write poll (p_fresh) closes");
await age();
cursor = (await poll(Mac, cursor, true)).answer!.cursor;

// No binding at all: exactly the old behaviour.
env = { ...baseEnv };
r = await poll(Mac, cursor);
ok(r.sql > 0, "no SYNC_MARKER binding → every poll asks Postgres");
env = { ...baseEnv, SYNC_MARKER: marker };

// Signing out forgets the credential: the next poll goes to Postgres and is refused.
await age();
cursor = (await poll(Mac, cursor)).answer!.cursor;
await poll(Mac, cursor);
ok((await poll(Mac, cursor)).sql === 0, "warm before sign-out");
const out = await call("/api/auth/sign-out", {
  method: "POST",
  headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
  body: "{}",
});
ok(out.status === 200, `sign-out ${out.status}`);
r = await poll(Mac, cursor);
ok(r.sql > 0 && r.error, "after sign-out the credential is asked about, and refused");

restoreIo();
await db.close();

// ── Every writer is accounted for ───────────────────────────────────────────
// A write that reaches Postgres from somewhere the marker never hears about is
// hidden until PROOF_TTL_MS. These are all the places the Worker opens a
// database client or keeps working past a response; each pokes, or says why
// it needn't. A new one fails here until it is classified.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts") && !name.endsWith(".check.ts") && !name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(here);
  const COVERED: Record<string, string> = {
    // HTTP: every request's client is the context's io; pokeGate pokes after closeIo closes it.
    "requestIo.ts": "the HTTP client, closed inside pokeGate",
    "session.ts": "opens the HTTP client (requestIo)",
    "db.ts": "defines openSql",
    "auth.ts": "Better Auth's own pool: auth tables only, never a synced table",
    // Off the request path — each must call markerPoke itself.
    "index.ts": "scheduled + email",
    "cronJobs.ts": "queue consumer + in-process calendar dispatch",
    "inboundMail.ts": "the email handler; index.ts email() pokes everyone after it",
    "calendar/http.ts": "first syncs after connect run in waitUntil",
    "agentHttp.ts": "the streamed agent turn writes after the response began",
  };
  const MUST_POKE = new Set(["index.ts", "cronJobs.ts", "calendar/http.ts", "agentHttp.ts"]);
  const site = /\bopenSql\(|\bopenRequestIo\(|new Pool\(|\bpostgres\(|\.waitUntil\(|new TransformStream|new ReadableStream/;
  for (const file of files) {
    const rel = relative(here, file);
    const src = readFileSync(file, "utf8");
    if (!site.test(src)) continue;
    ok(rel in COVERED, `${rel} opens a database client or works past a response — classify it in syncMarker.check.ts (D-245)`);
    if (MUST_POKE.has(rel)) ok(/\bmarkerPoke\(/.test(src), `${rel} must poke the change marker`);
  }
  // Every non-HTTP gate poke has a marker poke beside it.
  for (const file of files) {
    const rel = relative(here, file);
    const src = readFileSync(file, "utf8");
    if (rel === "cronGate.ts" || !/\bgatePoke\(/.test(src)) continue;
    ok(/\bmarkerPoke\(/.test(src), `${rel} pokes the cron gate but not the change marker`);
  }
  const index = readFileSync(join(here, "index.ts"), "utf8");
  ok(/export \{ CronGate, SyncMarker \}/.test(index), "index.ts exports SyncMarker");
  const wrangler = readFileSync(join(here, "..", "..", "wrangler.jsonc"), "utf8");
  ok((wrangler.match(/"name": "SYNC_MARKER", "class_name": "SyncMarker"/g) ?? []).length === 2, "SYNC_MARKER bound in production and preview");
  ok(/"new_sqlite_classes": \["SyncMarker"\]/.test(wrangler), "SyncMarker has a migration");
}

if (fails.length) {
  console.error(`syncMarker.check: ${fails.length}/${checks} failed`);
  for (const f of fails) console.error("  ✗", f);
  process.exit(1);
}
console.log(`syncMarker.check: ${checks} checks passed`);
process.exit(0);
