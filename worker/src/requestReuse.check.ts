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
import { createAuth } from "./auth.ts";
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
ok(/openRequestIo/.test(indexSrc) && /scheduleClose/.test(indexSrc), "index.ts uses per-request IO + scheduleClose");

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

const signUpRes = await withTimeout(
  request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password12", name: "Reuse" }),
  }),
  8000,
  "sign-up",
);
const signUpText = await signUpRes.text();
ok(signUpRes.status === 200, `sign-up: HTTP ${signUpRes.status} ${signUpText.slice(0, 160)}`);
const signed = JSON.parse(signUpText || "{}") as { token?: string; user?: { id?: string } };
ok(typeof signed.token === "string" && signed.token.length > 8, "sign-up: session token");

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
ok(written.data?.user_id === signed.user?.id, "authed write: task belongs to the signed-up user");

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

restore();
await kysely.destroy();
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("request reuse: ok");
