// Real better-auth@1.7.13 against worker/schema/better-auth.sql on PGlite.
// The four HTTP routes that 500 on snake_case (OTP send, OTP sign-in,
// sign-up, get-session) must return 200 against this camelCase schema.
// Run: node --experimental-strip-types worker/src/authAdapter.check.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
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

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "../schema/better-auth.sql"), "utf8");
const authSrc = readFileSync(join(here, "auth.ts"), "utf8");
ok(/"emailVerified"/.test(schema), "schema: user.emailVerified is camelCase");
ok(/"userId"/.test(schema), "schema: session.userId is camelCase");
ok(/"expiresAt"/.test(schema), "schema: verification.expiresAt is camelCase");
ok(!/email_verified/.test(schema), "schema: no snake_case email_verified");
ok(!/authSchema/.test(authSrc), "createAuth: no snake_case field map");
ok(!/emailVerified:\s*"email_verified"/.test(authSrc), "createAuth: no emailVerified remap");
ok(/requireSignature:\s*true/.test(authSrc), "createAuth: bearer requires a signed token");
ok(/requireEmailVerification:\s*true/.test(authSrc), "createAuth: email+password requires verification");

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

function pgliteKysely(db: PGlite): Kysely<Record<string, unknown>> {
  return new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PGliteDriver(db),
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

const db = new PGlite();
await db.exec(schema);
const kysely = pgliteKysely(db);

const sent: { email: string; otp: string; type: string }[] = [];
const auth = betterAuth({
  secret: "adapter-check-secret-32-bytes-long!!",
  baseURL: "http://localhost:8787",
  basePath: "/api/auth",
  database: { db: kysely, type: "postgres" },
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  trustedOrigins: ["http://localhost:8787"],
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      sendVerificationOTP: async ({ email, otp, type }) => {
        sent.push({ email, otp, type });
      },
    }),
  ],
});

const origin = "http://localhost:8787";

async function post(path: string, body: Record<string, unknown>, cookie = ""): Promise<Response> {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: origin,
  });
  if (cookie) headers.set("Cookie", cookie);
  return auth.handler(new Request(`http://localhost:8787${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }));
}

async function get(path: string, cookie = ""): Promise<Response> {
  const headers = new Headers({ Origin: origin });
  if (cookie) headers.set("Cookie", cookie);
  return auth.handler(new Request(`http://localhost:8787${path}`, { headers }));
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

const email = "adapter@example.test";

const signUp = await post("/api/auth/sign-up/email", {
  email,
  password: "password12",
  name: "Adapter",
});
const signUpText = await signUp.text();
ok(signUp.status === 200, `sign-up: HTTP ${signUp.status} ${signUpText.slice(0, 200)}`);
const signed = JSON.parse(signUpText || "{}") as { user?: { id?: string; email?: string } };
ok(Boolean(signed.user?.id), "sign-up: returns a user");
ok(signed.user?.email === email, "sign-up: email matches");

const userRows = await db.query<{
  email: string;
  emailVerified: boolean;
  createdAt: Date | string;
}>('SELECT email, "emailVerified", "createdAt" FROM "user" WHERE email = $1', [email]);
ok(userRows.rows.length === 1, "insert: camelCase user row exists");
ok(userRows.rows[0]?.email === email, "select: email column readable");
ok(userRows.rows[0]?.createdAt != null, "select: createdAt (not created_at) is set");

const accountRows = await db.query<{ userId: string; providerId: string }>(
  'SELECT "userId", "providerId" FROM account WHERE "userId" = $1',
  [signed.user?.id],
);
ok(accountRows.rows.length >= 1, "insert: account row uses userId");
ok(accountRows.rows[0]?.providerId === "credential", "select: providerId is credential");

const sendOtp = await post("/api/auth/email-otp/send-verification-otp", {
  email,
  type: "sign-in",
});
const sendText = await sendOtp.text();
ok(sendOtp.status === 200, `OTP send: HTTP ${sendOtp.status} ${sendText.slice(0, 200)}`);
ok(JSON.parse(sendText || "{}").success === true, "OTP send: success");
ok(sent.length >= 1 && sent[0]?.email === email, "OTP send: callback fired");

const verifyRows = await db.query<{ identifier: string; value: string; expiresAt: Date | string }>(
  'SELECT identifier, value, "expiresAt" FROM verification',
);
ok(verifyRows.rows.length >= 1, "insert: verification row exists");
ok(
  verifyRows.rows.some((r) => String(r.identifier).includes(email)),
  "select: verification identifier carries the email",
);
ok(verifyRows.rows.some((r) => r.expiresAt != null), "select: expiresAt (not expires_at) is set");

const otp = sent[sent.length - 1]?.otp ?? "";
const signIn = await post("/api/auth/sign-in/email-otp", { email, otp });
const signInText = await signIn.text();
ok(signIn.status === 200, `OTP sign-in: HTTP ${signIn.status} ${signInText.slice(0, 200)}`);
const sessionBody = JSON.parse(signInText || "{}") as { user?: { email?: string }; token?: string };
ok(sessionBody.user?.email === email, "OTP sign-in: user email matches");
ok(typeof sessionBody.token === "string" && sessionBody.token.length > 8, "OTP sign-in: session token");

const cookie = cookieHeader(signIn);
ok(cookie.length > 0 || Boolean(sessionBody.token), "OTP sign-in: cookie or bearer token");

const session = await get("/api/auth/get-session", cookie);
const sessionText = await session.text();
ok(session.status === 200, `get-session: HTTP ${session.status} ${sessionText.slice(0, 200)}`);
const got = JSON.parse(sessionText || "null") as { user?: { email?: string } } | null;
ok(got?.user?.email === email, "get-session: returns the signed-in user");

const emptySession = await get("/api/auth/get-session");
ok(emptySession.status === 200, `get-session (anon): HTTP ${emptySession.status}, not a schema 500`);

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("auth adapter: ok");
await kysely.destroy();
await db.close();
