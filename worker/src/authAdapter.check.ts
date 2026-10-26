// Standalone Better Auth adapter check against PGlite + worker/schema/better-auth.sql.
// Proves createAuth's snake_case field map can insert and select a real user
// and a verification row. Run: node --experimental-strip-types worker/src/authAdapter.check.ts

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
import { authAccount, authSession, authUser, authVerification } from "./authSchema.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "../schema/better-auth.sql"), "utf8");

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
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
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

const email = "adapter@example.test";
const signed = await auth.api.signUpEmail({
  body: { email, password: "password12", name: "Adapter" },
});
ok(Boolean(signed.user?.id), "signUpEmail: returns a user");
ok(signed.user?.email === email, "signUpEmail: email matches");

const userRows = await db.query<{
  email: string;
  email_verified: boolean;
  created_at: Date | string;
}>('SELECT email, email_verified, created_at FROM "user" WHERE email = $1', [email]);
ok(userRows.rows.length === 1, "insert: snake_case user row exists");
ok(userRows.rows[0]?.email === email, "select: email column readable");
ok(userRows.rows[0]?.created_at != null, "select: created_at (not createdAt) is set");

const accountRows = await db.query<{ user_id: string; provider_id: string }>(
  "SELECT user_id, provider_id FROM account WHERE user_id = $1",
  [signed.user.id],
);
ok(accountRows.rows.length >= 1, "insert: account row uses user_id");
ok(accountRows.rows[0]?.provider_id === "credential", "select: provider_id is credential");

const otp = await auth.api.sendVerificationOTP({
  body: { email, type: "sign-in" },
});
ok(otp.success === true, "sendVerificationOTP: success");
ok(sent.length === 1 && sent[0]?.email === email, "sendVerificationOTP: callback fired");

const verifyRows = await db.query<{ identifier: string; value: string; expires_at: Date | string }>(
  "SELECT identifier, value, expires_at FROM verification",
);
ok(verifyRows.rows.length >= 1, "insert: verification row exists");
ok(
  verifyRows.rows.some((r) => String(r.identifier).includes(email)),
  "select: verification identifier carries the email",
);
ok(verifyRows.rows.some((r) => r.expires_at != null), "select: expires_at (not expiresAt) is set");

const found = await auth.api.getSession({
  headers: new Headers(),
});
ok(found === null || found.user == null, "getSession: no cookie is null, not a schema error");

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("auth adapter: ok");
await kysely.destroy();
await db.close();
