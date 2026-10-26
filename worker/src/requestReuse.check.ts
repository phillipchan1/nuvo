// Sequential requests on one Worker-shaped instance (same env object).
// Caching a postgres.js client or Better Auth pg Pool across requests hangs
// on Workers — they cannot reuse I/O. This drives OTP send, an authed write,
// and an invalid-bearer 401 through the real Hono app, each on a fresh
// per-request client that is closed after the response.
// Run: node --experimental-strip-types worker/src/requestReuse.check.ts

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
import { createServer, type Socket } from "node:net";
import { createAuth } from "./auth.ts";
import { CONNECT_TIMEOUT_MS } from "./db.ts";
import { isUnavailableText } from "./http.ts";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { installRequestIoForTests } from "./requestIo.ts";
import app from "./index.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const dbSrc = readFileSync(join(here, "db.ts"), "utf8");
const authSrc = readFileSync(join(here, "auth.ts"), "utf8");
const indexSrc = readFileSync(join(here, "index.ts"), "utf8");
const ioSrc = readFileSync(join(here, "requestIo.ts"), "utf8");

ok(!/WeakMap/.test(dbSrc), "db.ts does not cache clients in a WeakMap");
ok(!/\bcache\b/.test(dbSrc), "db.ts has no module-scope client cache");
ok(!/WeakMap/.test(authSrc), "auth.ts does not cache Better Auth in a WeakMap");
ok(!/\bcache\b/.test(authSrc), "auth.ts has no module-scope auth cache");
ok(/openSql/.test(dbSrc), "db.ts exports openSql (per-request)");
ok(/openAuth/.test(authSrc), "auth.ts exports openAuth (per-request)");
ok(/waitUntil/.test(ioSrc), "requestIo closes via waitUntil");
ok(/requestIo/.test(indexSrc) && /scheduleClose/.test(indexSrc), "index.ts uses per-request IO + scheduleClose");
ok(/requireSignature:\s*true/.test(authSrc), "createAuth requires signed bearer tokens");
ok(/requireEmailVerification:\s*true/.test(authSrc), "createAuth requires email verification (no unverified password session)");
ok(/exposeSignedAuthToken/.test(indexSrc), "auth responses rewrite the JSON token to the signed form");
ok(/signBearerToken/.test(authSrc), "auth.ts can HMAC a raw session token for cookie-only get-session");
ok(/SessionLookupError/.test(authSrc), "session lookup failures are not treated as no session");
ok(/clientSsl/.test(dbSrc) && /isHyperdriveHostname/.test(dbSrc), "db.ts disables client TLS for Hyperdrive");
ok(/clientConnection/.test(dbSrc) && /stripSslMode/.test(dbSrc), "db.ts strips sslmode when Hyperdrive TLS is off");
ok(/clientConnection/.test(authSrc), "openAuth uses clientConnection (no client TLS to Hyperdrive)");
ok(/sanitizeAuthResponse/.test(indexSrc), "auth 5xx bodies are sanitized (no internal host)");
ok(/requireJsonObject/.test(indexSrc), "data POST/PATCH require a JSON object");
ok(/sqlUnavailable|SELECT 1/.test(indexSrc), "auth 5xx probes SQL when Better Auth swallows the driver error");
ok(
  /catch[\s\S]*sqlUnavailable\(io\.sql\)/.test(indexSrc),
  "auth outer catch probes SQL (Better Auth throws before sanitizeAuthResponse)",
);
ok(/raceTimeout\(Promise\.resolve\(sql`SELECT 1`\), CONNECT_TIMEOUT_MS\)/.test(indexSrc), "auth probe is time-limited");
ok(/connect_timeout:\s*CONNECT_TIMEOUT_SECONDS/.test(dbSrc), "openSql sets postgres.js connect_timeout");
ok(/connectionTimeoutMillis:\s*CONNECT_TIMEOUT_MS/.test(authSrc), "openAuth sets pg connectionTimeoutMillis");
ok(isUnavailableText("disconnected: Connection refused"), "isUnavailableText: Hyperdrive disconnected + refused");
ok(isUnavailableText("disconnected"), "isUnavailableText: disconnected alone");
ok(isUnavailableText("connect ECONNREFUSED 127.0.0.1:5432"), "isUnavailableText: ECONNREFUSED");
ok(isUnavailableText("write CONNECT_TIMEOUT"), "isUnavailableText: postgres.js CONNECT_TIMEOUT");
ok(isUnavailableText("Connection terminated due to connection timeout"), "isUnavailableText: pg connection timeout");
ok(isUnavailableText("timeout expired"), "isUnavailableText: pg timeout expired");
ok(!isUnavailableText("internal error"), "isUnavailableText: generic 500 text is not unavailable");
ok(!isUnavailableText("Failed to create verification"), "isUnavailableText: Better Auth 500 text is not unavailable");
ok(!isUnavailableText("connection attempt failed"), "isUnavailableText: BA throw text is not classified (probe instead)");
ok(/await next\(\)/.test(indexSrc) && /await closing/.test(indexSrc), "index.ts awaits next() then the close");
ok(!/c\.res\.headers\.set/.test(indexSrc), "index.ts does not mutate immutable response headers");
ok(!/withIo\(c,/.test(indexSrc), "index.ts does not close IO inside requireStore");

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
  BETTER_AUTH_SECRET: "request-reuse-secret-32-bytes-long!",
  BETTER_AUTH_URL: "http://localhost:8787",
};

let opens = 0;
let closes = 0;
const restore = installRequestIoForTests(() => {
  opens++;
  const auth = createAuth(env, { db: kysely, type: "postgres" });
  return {
    sql,
    auth,
    close: async () => {
      closes++;
    },
  };
});

const origin = "http://localhost:8787";
const email = "reuse@example.test";
const seedEmail = "seed-reuse@example.test";
const SEED = "44444444-4444-4444-4444-444444444444";
const SEED_DOMAIN = "44444444-0000-4000-8000-000000000001";
await db.exec(`
  INSERT INTO users (id, email) VALUES ('${SEED}', '${seedEmail}');
  INSERT INTO domains (id, user_id, name, color) VALUES
    ('${SEED_DOMAIN}', '${SEED}', 'Seed Work', '#2563EB');
`);

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

function cookieHeader(res: Response): string {
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const parts = typeof getSetCookie === "function" ? getSetCookie.call(res.headers) : [];
  if (parts.length) {
    return parts.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  }
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function readOtp(forEmail: string): Promise<string> {
  const rows = await db.query<{ value: string }>(
    `SELECT value FROM verification WHERE identifier = $1 ORDER BY "expiresAt" DESC LIMIT 1`,
    [`sign-in-otp-${forEmail}`],
  );
  return (rows.rows[0]?.value ?? "").split(":")[0];
}

async function signInOtp(forEmail: string): Promise<{ token: string; id: string; cookie: string }> {
  const send = await withTimeout(
    request("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: forEmail, type: "sign-in" }),
    }),
    8000,
    `OTP send ${forEmail}`,
  );
  ok(send.status === 200, `OTP send ${forEmail}: HTTP ${send.status} ${await send.clone().text().then((t) => t.slice(0, 160))}`);
  const otp = await readOtp(forEmail);
  ok(/^\d{6}$/.test(otp), `OTP send ${forEmail}: captured a 6-digit code`);
  const res = await withTimeout(
    request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: forEmail, otp }),
    }),
    8000,
    `OTP sign-in ${forEmail}`,
  );
  const text = await res.text();
  ok(res.status === 200, `OTP sign-in ${forEmail}: HTTP ${res.status} ${text.slice(0, 160)}`);
  const body = JSON.parse(text || "{}") as { token?: string; user?: { id?: string } };
  ok(typeof body.token === "string" && body.token.includes("."), `OTP sign-in ${forEmail}: signed token`);
  return { token: body.token ?? "", id: body.user?.id ?? "", cookie: cookieHeader(res) };
}

const otpRes = await withTimeout(
  request("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, type: "sign-in" }),
  }),
  8000,
  "OTP send",
);
ok(otpRes.status === 200, `OTP send: HTTP ${otpRes.status} ${await otpRes.clone().text().then((t) => t.slice(0, 160))}`);
ok(opens === 1 && closes === 1, `OTP send: opened and closed once (opens=${opens} closes=${closes})`);

const takeoverSignUp = await withTimeout(
  request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: seedEmail, password: "password12", name: "Takeover" }),
  }),
  8000,
  "unverified sign-up",
);
const takeoverText = await takeoverSignUp.text();
ok(takeoverSignUp.status === 200, `unverified sign-up: HTTP ${takeoverSignUp.status} ${takeoverText.slice(0, 160)}`);
const takeover = JSON.parse(takeoverText || "{}") as { token?: string | null; user?: { id?: string } };
ok(takeover.token == null, "unverified sign-up: no session token (cannot adopt)");
ok((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE id = $1 AND email = $2", [SEED, seedEmail])).rows[0]?.n === 1, "unverified sign-up: seed users row untouched");
ok((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM domains WHERE user_id = $1 AND name = $2", [SEED, "Seed Work"])).rows[0]?.n === 1, "unverified sign-up: seed domain still private");

const signed = await signInOtp(email);

const writeRes = await withTimeout(
  request("/api/data/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signed.token}`,
    },
    body: JSON.stringify({ title: "sequential write" }),
  }),
  8000,
  "authed write",
);
const writeText = await writeRes.text();
ok(writeRes.status === 200, `authed write: HTTP ${writeRes.status} ${writeText.slice(0, 160)}`);
const written = JSON.parse(writeText || "{}") as { data?: { title?: string; user_id?: string } };
ok(written.data?.title === "sequential write", "authed write: task title stored");
ok(written.data?.user_id === signed.id, "authed write: task belongs to the signed-in user");

const rawRows = await db.query<{ token: string }>(
  'SELECT token FROM session WHERE "userId" = $1',
  [signed.id],
);
const rawDbToken = rawRows.rows[0]?.token ?? "";
ok(rawDbToken.length > 8, "session table has a raw token");
ok(rawDbToken !== signed.token, "JSON token is not the raw DB session token");
ok(!rawDbToken.includes("."), "raw DB token is unsigned");

const rawBearer = await withTimeout(
  request("/api/data/tasks", {
    headers: { Authorization: `Bearer ${rawDbToken}` },
  }),
  8000,
  "raw DB bearer",
);
ok(rawBearer.status === 401, `raw DB token as Bearer: HTTP ${rawBearer.status}`);
const rawBody = await rawBearer.json() as { error?: string };
ok(rawBody.error === "unauthorized", "raw DB token: generic unauthorized");

const unauthRes = await withTimeout(
  request("/api/data/tasks", {
    headers: { Authorization: "Bearer not-a-real-session" },
  }),
  8000,
  "invalid bearer",
);
ok(unauthRes.status === 401, `invalid bearer: HTTP ${unauthRes.status}`);
const unauthBody = await unauthRes.json() as { error?: string };
ok(unauthBody.error === "unauthorized", "invalid bearer: generic unauthorized");

ok(opens >= 4, `one instance opened a client per request (opens=${opens})`);
ok(closes === opens, `every request closed its client (opens=${opens} closes=${closes})`);

const adopted = await signInOtp(seedEmail);
ok(adopted.id.length > 0, "verified OTP: Better Auth user id");
const adoptedDomains = await withTimeout(
  request("/api/data/domains", {
    headers: { Authorization: `Bearer ${adopted.token}` },
  }),
  8000,
  "OTP adopt list",
);
ok(adoptedDomains.status === 200, `OTP adopt list: HTTP ${adoptedDomains.status}`);
const adoptedBody = await adoptedDomains.json() as { data?: { id?: string; name?: string }[] };
ok(
  Array.isArray(adoptedBody.data) && adoptedBody.data.some((row) => row.id === SEED_DOMAIN && row.name === "Seed Work"),
  "verified OTP user adopts the seeded planner row",
);
const seedAuth = await db.query<{ auth_id: string }>("SELECT auth_id::text AS auth_id FROM users WHERE id = $1", [SEED]);
ok(seedAuth.rows[0]?.auth_id === adopted.id, "verified OTP: users.auth_id stores the BA user id");

await db.query('UPDATE "user" SET email = $1 WHERE id = $2', ["renamed-seed-reuse@example.test", adopted.id]);
const afterRename = await withTimeout(
  request("/api/data/domains", {
    headers: { Authorization: `Bearer ${adopted.token}` },
  }),
  8000,
  "email-change list",
);
const afterRenameBody = await afterRename.json() as { data?: { id?: string }[] };
ok(afterRename.status === 200, `email-change list: HTTP ${afterRename.status}`);
ok(
  Array.isArray(afterRenameBody.data) && afterRenameBody.data.some((row) => row.id === SEED_DOMAIN),
  "auth_id link survives an email change",
);
ok(
  (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE id = $1", [adopted.id])).rows[0]?.n === 0,
  "email change does not insert a new empty users row for the BA id",
);

ok(signed.cookie.length > 0, "OTP sign-in set a session cookie");
const cookieSession = await withTimeout(
  request("/api/auth/get-session", {
    headers: { Cookie: signed.cookie },
  }),
  8000,
  "cookie-only get-session",
);
const cookieText = await cookieSession.text();
ok(cookieSession.status === 200, `cookie-only get-session: HTTP ${cookieSession.status} ${cookieText.slice(0, 160)}`);
const cookieBody = JSON.parse(cookieText || "null") as { session?: { token?: string }; user?: { id?: string } } | null;
ok(typeof cookieBody?.session?.token === "string", "cookie-only get-session: has session.token");
ok(cookieBody?.session?.token?.includes(".") === true, "cookie-only get-session: token is signed, not the raw DB value");
ok(cookieBody.session?.token !== rawDbToken, "cookie-only get-session: token is not the raw DB session token");
const cookieBearer = await withTimeout(
  request("/api/data/tasks", {
    headers: { Authorization: `Bearer ${cookieBody.session?.token}` },
  }),
  8000,
  "get-session signed bearer",
);
ok(cookieBearer.status === 200, `cookie-only get-session token as Bearer: HTTP ${cookieBearer.status}`);

const badJson = await withTimeout(
  request("/api/data/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signed.token}`,
    },
    body: "{",
  }),
  8000,
  "bad JSON",
);
ok(badJson.status === 400, `bad JSON: HTTP ${badJson.status}`);
ok((badJson.headers.get("content-type") ?? "").includes("application/json"), "bad JSON: JSON body");

const nulJson = await withTimeout(
  request("/api/data/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signed.token}`,
    },
    body: JSON.stringify({ title: "nul\u0000title" }),
  }),
  8000,
  "NUL body",
);
ok(nulJson.status === 400, `NUL body: HTTP ${nulJson.status}`);

const tasksBeforeBad = (
  await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE user_id = $1", [signed.id])
).rows[0]?.n ?? 0;
const untitledBefore = (
  await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE user_id = $1 AND title = $2", [signed.id, "Untitled"])
).rows[0]?.n ?? 0;

for (const [label, body] of [
  ["JSON string", '"just a string"'],
  ["null body", "null"],
  ["array body", "[]"],
] as const) {
  const res = await withTimeout(
    request("/api/data/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signed.token}`,
      },
      body,
    }),
    8000,
    label,
  );
  ok(res.status === 400, `${label}: HTTP ${res.status} (not 500, no write)`);
  ok((res.headers.get("content-type") ?? "").includes("application/json"), `${label}: JSON`);
  const text = await res.text();
  ok(!text.includes("Untitled"), `${label}: no Untitled leak`);
}

const tasksAfterBad = (
  await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE user_id = $1", [signed.id])
).rows[0]?.n ?? 0;
const untitledAfter = (
  await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE user_id = $1 AND title = $2", [signed.id, "Untitled"])
).rows[0]?.n ?? 0;
ok(tasksAfterBad === tasksBeforeBad, "non-object POST: no task row written");
ok(untitledAfter === untitledBefore, "non-object POST: no Untitled task created");

const badId = await withTimeout(
  request("/api/data/tasks/not-a-uuid", {
    headers: { Authorization: `Bearer ${signed.token}` },
  }),
  8000,
  "malformed id",
);
ok(badId.status === 400, `malformed id: HTTP ${badId.status}`);

const foreignId = "bbbbbbbb-2222-4000-8000-000000000001";
const steal = await withTimeout(
  request("/api/data/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signed.token}`,
    },
    body: JSON.stringify({ id: foreignId, title: "steal" }),
  }),
  8000,
  "foreign id insert",
);
const stealText = await steal.clone().text();
const stealBody = JSON.parse(stealText || "{}") as { data?: { id?: string; title?: string } };
ok(steal.status === 200, `POST other owner's id: HTTP ${steal.status} (new owned row, not 500)`);
ok((steal.headers.get("content-type") ?? "").includes("application/json"), "foreign id insert: JSON");
ok(stealText.includes("hyperdrive.local") === false, "foreign id insert: no internal host");
ok(stealBody.data?.id !== foreignId, "foreign id insert: did not take B's id");
ok(
  (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE id = $1 AND title = $2", [foreignId, "steal"])).rows[0]?.n === 0,
  "foreign id insert: B's task title unchanged",
);

restore();

const restoreFail = installRequestIoForTests(() => {
  opens++;
  return {
    sql,
    auth: {
      api: {
        getSession: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
      handler: async () => new Response("no", { status: 500 }),
    } as unknown as ReturnType<typeof createAuth>,
    close: async () => {
      closes++;
    },
  };
});
const lookupFail = await withTimeout(
  request("/api/data/tasks", {
    headers: { Authorization: `Bearer ${signed.token}` },
  }),
  8000,
  "session lookup error",
);
ok(lookupFail.status === 503, `session lookup DB error: HTTP ${lookupFail.status} (not 401)`);
const lookupBody = await lookupFail.json() as { error?: string };
ok(lookupBody.error === "service unavailable", "session lookup DB error: service unavailable");
ok(JSON.stringify(lookupBody).includes("hyperdrive") === false, "session lookup error: no internal host");
restoreFail();

const restoreOtpDown = installRequestIoForTests(() => {
  opens++;
  return {
    sql,
    auth: {
      api: { getSession: async () => null },
      handler: async () => {
        const err = new Error("connect ECONNREFUSED 127.0.0.1:1 abcd1234.hyperdrive.local");
        (err as { code?: string }).code = "ECONNREFUSED";
        throw err;
      },
    } as unknown as ReturnType<typeof createAuth>,
    close: async () => {
      closes++;
    },
  };
});
const otpDown = await withTimeout(
  request("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "down@example.test", type: "sign-in" }),
  }),
  8000,
  "OTP send DB down",
);
const otpDownText = await otpDown.text();
ok(otpDown.status === 503, `OTP send DB down: HTTP ${otpDown.status} (not 500)`);
ok(otpDownText.includes("service unavailable"), "OTP send DB down: generic unavailable");
ok(!otpDownText.includes("hyperdrive"), "OTP send DB down: no hyperdrive host");
ok(!otpDownText.includes("ECONNREFUSED"), "OTP send DB down: no driver error");
ok((otpDown.headers.get("content-type") ?? "").includes("application/json"), "OTP send DB down: JSON");
restoreOtpDown();

const restoreOtpBody = installRequestIoForTests(() => {
  opens++;
  return {
    sql,
    auth: {
      api: { getSession: async () => null },
      handler: async () =>
        new Response(
          JSON.stringify({ message: "connect ECONNREFUSED abcd1234.hyperdrive.local:5432" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
    } as unknown as ReturnType<typeof createAuth>,
    close: async () => {
      closes++;
    },
  };
});
const otpBody = await withTimeout(
  request("/api/auth/sign-in/email-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "down@example.test", otp: "000000" }),
  }),
  8000,
  "OTP 5xx body",
);
const otpBodyText = await otpBody.text();
ok(otpBody.status === 503, `OTP 5xx body: HTTP ${otpBody.status} (not 500)`);
ok(otpBodyText.includes("service unavailable"), "OTP 5xx body: generic unavailable");
ok(!otpBodyText.includes("hyperdrive"), "OTP 5xx body: no hyperdrive host");
ok(!otpBodyText.includes("ECONNREFUSED"), "OTP 5xx body: no driver error");
restoreOtpBody();

const restoreOtpGeneric = installRequestIoForTests(() => {
  opens++;
  return {
    sql,
    auth: {
      api: { getSession: async () => null },
      handler: async () =>
        new Response(JSON.stringify({ message: "Failed to create verification" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    } as unknown as ReturnType<typeof createAuth>,
    close: async () => {
      closes++;
    },
  };
});
const otpGeneric = await withTimeout(
  request("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "down@example.test", type: "sign-in" }),
  }),
  8000,
  "OTP generic 500 healthy DB",
);
ok(otpGeneric.status === 500, `OTP generic 500 with healthy DB: HTTP ${otpGeneric.status} (not remapped to 503)`);
ok((await otpGeneric.text()).includes("internal error"), "OTP generic 500 healthy DB: generic internal error");
restoreOtpGeneric();

async function downSql() {
  throw new Error("disconnected: Connection refused");
}
const restoreOtpSwallowed = installRequestIoForTests(() => {
  opens++;
  return {
    sql: downSql as unknown as typeof sql,
    auth: {
      api: { getSession: async () => null },
      handler: async () =>
        new Response(JSON.stringify({ message: "Failed to create verification" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    } as unknown as ReturnType<typeof createAuth>,
    close: async () => {
      closes++;
    },
  };
});
const otpSwallowed = await withTimeout(
  request("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "down@example.test", type: "sign-in" }),
  }),
  8000,
  "OTP swallowed DB down",
);
const otpSwallowedText = await otpSwallowed.text();
ok(otpSwallowed.status === 503, `OTP swallowed DB down: HTTP ${otpSwallowed.status} (not Better Auth 500)`);
ok(otpSwallowedText.includes("service unavailable"), "OTP swallowed DB down: generic unavailable");
ok(!otpSwallowedText.includes("disconnected"), "OTP swallowed DB down: no driver text");
ok(!otpSwallowedText.includes("hyperdrive"), "OTP swallowed DB down: no internal host");
restoreOtpSwallowed();

const restoreThrown = installRequestIoForTests(() => {
  opens++;
  return {
    sql: (async () => {
      throw new Error("connection attempt failed");
    }) as unknown as typeof sql,
    auth: {
      api: { getSession: async () => null },
      handler: async () => {
        throw new Error("connection attempt failed");
      },
    } as unknown as ReturnType<typeof createAuth>,
    close: async () => {
      closes++;
    },
  };
});
const thrown = await withTimeout(
  request("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "down@example.test", type: "sign-in" }),
  }),
  8000,
  "OTP throw connection attempt failed",
);
const thrownText = await thrown.text();
ok(thrown.status === 503, `OTP throw connection attempt failed: HTTP ${thrown.status} (outer catch probed)`);
ok(thrownText.includes("service unavailable"), "OTP throw: generic unavailable");
ok(!thrownText.includes("connection attempt failed"), "OTP throw: no driver text");
restoreThrown();

const restoreThrowHealthy = installRequestIoForTests(() => {
  opens++;
  return {
    sql,
    auth: {
      api: { getSession: async () => null },
      handler: async () => {
        throw new Error("connection attempt failed");
      },
    } as unknown as ReturnType<typeof createAuth>,
    close: async () => {
      closes++;
    },
  };
});
const throwHealthy = await withTimeout(
  request("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "down@example.test", type: "sign-in" }),
  }),
  8000,
  "OTP throw healthy DB",
);
ok(throwHealthy.status === 500, `OTP throw with healthy DB: HTTP ${throwHealthy.status} (probe keeps 500)`);
ok((await throwHealthy.text()).includes("internal error"), "OTP throw healthy DB: generic internal error");
restoreThrowHealthy();

const deadEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/nuvo",
  BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
};
const codeSendRoutes: { label: string; path: string; body: Record<string, unknown> }[] = [
  { label: "send-verification-otp sign-in", path: "/api/auth/email-otp/send-verification-otp", body: { email: "down@example.test", type: "sign-in" } },
  { label: "send-verification-otp email-verification", path: "/api/auth/email-otp/send-verification-otp", body: { email: "down@example.test", type: "email-verification" } },
  { label: "send-verification-otp forget-password", path: "/api/auth/email-otp/send-verification-otp", body: { email: "down@example.test", type: "forget-password" } },
  { label: "forget-password/email-otp", path: "/api/auth/forget-password/email-otp", body: { email: "down@example.test" } },
  { label: "email-otp/request-password-reset", path: "/api/auth/email-otp/request-password-reset", body: { email: "down@example.test" } },
];
for (const route of codeSendRoutes) {
  const res = await withTimeout(
    app.request(
      `http://localhost:8787${route.path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(route.body),
      },
      deadEnv,
    ),
    8000,
    `${route.label} DB down`,
  );
  const text = await res.text();
  ok(res.status === 503, `${route.label} DB down: HTTP ${res.status} (not 500)`);
  ok(text.includes("service unavailable"), `${route.label} DB down: generic unavailable`);
  ok(!text.includes("ECONNREFUSED"), `${route.label} DB down: no driver error`);
  ok(!text.includes("127.0.0.1"), `${route.label} DB down: no host`);
  ok(!text.includes("connection attempt failed"), `${route.label} DB down: no connection text`);
  ok((res.headers.get("content-type") ?? "").includes("application/json"), `${route.label} DB down: JSON`);
}

const hangSql = (() => new Promise(() => {})) as unknown as typeof sql;
const restoreHangProbe = installRequestIoForTests(() => {
  opens++;
  return {
    sql: hangSql,
    auth: {
      api: { getSession: async () => null },
      handler: async () => {
        throw new Error("connection attempt failed");
      },
    } as unknown as ReturnType<typeof createAuth>,
    close: async () => {
      closes++;
    },
  };
});
const hangProbeStarted = Date.now();
const hangProbe = await withTimeout(
  request("/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "hang@example.test", type: "sign-in" }),
  }),
  CONNECT_TIMEOUT_MS + 2000,
  "OTP send hanging probe",
);
const hangProbeMs = Date.now() - hangProbeStarted;
const hangProbeText = await hangProbe.text();
ok(hangProbe.status === 503, `OTP send hanging probe: HTTP ${hangProbe.status} (not hung)`);
ok(hangProbeText.includes("service unavailable"), "OTP send hanging probe: generic unavailable");
ok(hangProbeMs < CONNECT_TIMEOUT_MS + 1500, `OTP send hanging probe: 503 in ${hangProbeMs}ms (limit ${CONNECT_TIMEOUT_MS}ms)`);
restoreHangProbe();

async function hangingPostgres(): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("hanging server: no port");
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${addr.port}/nuvo`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

const hang = await hangingPostgres();
try {
  const hangLimit = CONNECT_TIMEOUT_MS * 2 + 6000;
  const hangStarted = Date.now();
  const hangRes = await withTimeout(
    app.request(
      "http://localhost:8787/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ email: "hang@example.test", type: "sign-in" }),
      },
      {
        DATABASE_URL: hang.url,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      },
    ),
    hangLimit + 2000,
    "OTP send hanging DB",
  );
  const hangMs = Date.now() - hangStarted;
  const hangText = await hangRes.text();
  ok(hangRes.status === 503, `OTP send hanging DB: HTTP ${hangRes.status} (not hung)`);
  ok(hangText.includes("service unavailable"), "OTP send hanging DB: generic unavailable");
  ok(!hangText.includes("127.0.0.1"), "OTP send hanging DB: no host");
  ok(!hangText.includes("connect timeout") && !hangText.includes("timeout expired"), "OTP send hanging DB: no driver leak");
  ok((hangRes.headers.get("content-type") ?? "").includes("application/json"), "OTP send hanging DB: JSON");
  ok(hangMs < hangLimit, `OTP send hanging DB: 503 in ${hangMs}ms (limit ${hangLimit}ms)`);
} finally {
  await hang.close();
}

await kysely.destroy();
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("request reuse: ok");
