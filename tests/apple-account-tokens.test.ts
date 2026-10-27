import { readFileSync } from "node:fs";
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
import { describe, expect, it } from "vitest";
import { createAuth } from "../worker/src/auth.ts";
import type { Env } from "../worker/src/env.ts";
import {
  isProtectedAccountToken,
  sealAccountTokenFields,
} from "../worker/src/lib/accountTokens.ts";
import { TokenCryptoError } from "../worker/src/secrets.ts";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { ownedAppleRefreshToken } from "../worker/src/store.ts";

const SCHEMA = readFileSync("worker/schema/better-auth.sql", "utf8");
const ACCESS = "at_apple_web_do_not_store";
const REFRESH = "rt_apple_web_do_not_store";
const ID_TOKEN = "id_apple_web_do_not_store";
const ACCESS_LINK = "at_apple_link_do_not_store";
const REFRESH_LINK = "rt_apple_link_do_not_store";
const ID_TOKEN_LINK = "id_apple_link_do_not_store";
const APPLE_SUB = "001234.apple-sub.oauth";

function encKey(): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => i + 7);
  return btoa(String.fromCharCode(...bytes));
}

function tokenEnv(v1 = true): Env {
  return {
    BETTER_AUTH_SECRET: "apple-account-token-secret-32b!!",
    BETTER_AUTH_URL: "http://localhost:8787",
    APPLE_CLIENT_ID: "com.nuvo.web",
    APPLE_CLIENT_SECRET: "dummy-apple-client-secret",
    ...(v1 ? { TOKEN_ENC_KEY_V1: encKey() } : {}),
  };
}

class PGliteConnection implements DatabaseConnection {
  constructor(private client: PGlite) {}
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
  constructor(private client: PGlite) {}
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

type AccountRow = {
  id: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
};

function assertNoPlaintext(row: AccountRow, tokens: string[]): void {
  const blob = JSON.stringify(row);
  for (const token of tokens) {
    expect(blob).not.toContain(token);
  }
  for (const value of [row.accessToken, row.refreshToken, row.idToken]) {
    expect(value).toBeTruthy();
    expect(isProtectedAccountToken(value as string)).toBe(true);
  }
}

describe("Better Auth Apple tokens never land in plaintext", () => {
  it("wires encryptOAuthTokens and the account seal hook", () => {
    const src = readFileSync("worker/src/auth.ts", "utf8");
    expect(src).toContain("encryptOAuthTokens: true");
    expect(src).toContain("sealAccountTokenFields");
    expect(src).toContain("databaseHooks");
    expect(src).toMatch(/TOKEN_ENC_KEY_V1/);
  });

  it("fails closed when TOKEN_ENC_KEY_V1 is unset — no plaintext persist", async () => {
    await expect(
      sealAccountTokenFields({}, { userId: "11111111-1111-1111-1111-111111111111", refreshToken: REFRESH }),
    ).rejects.toBeInstanceOf(TokenCryptoError);

    const db = new PGlite();
    await db.exec(SCHEMA);
    const kysely = pgliteKysely(db);
    const auth = createAuth(tokenEnv(false), { db: kysely, type: "postgres" });
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      name: "Ada",
      email: "ada-ba-plain@example.test",
      emailVerified: true,
    });
    await expect(
      ctx.internalAdapter.createAccount({
        userId: user.id,
        providerId: "apple",
        accountId: APPLE_SUB,
        accessToken: ACCESS,
        refreshToken: REFRESH,
        idToken: ID_TOKEN,
      }),
    ).rejects.toBeInstanceOf(TokenCryptoError);
    const rows = await db.query<AccountRow>(
      `SELECT id, "userId", "accessToken", "refreshToken", "idToken" FROM account WHERE "userId" = $1`,
      [user.id],
    );
    expect(rows.rows).toHaveLength(0);
    const blob = JSON.stringify(rows.rows);
    expect(blob).not.toContain(ACCESS);
    expect(blob).not.toContain(REFRESH);
    expect(blob).not.toContain(ID_TOKEN);
    await kysely.destroy();
    await db.close();
  });

  it("web OAuth (account create) stores no plaintext on account.*", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    const kysely = pgliteKysely(db);
    const env = tokenEnv();
    const auth = createAuth(env, { db: kysely, type: "postgres" });
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      name: "Ada",
      email: "ada-oauth@example.test",
      emailVerified: true,
    });
    const created = await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "apple",
      accountId: APPLE_SUB,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      idToken: ID_TOKEN,
    });
    expect(created).toBeTruthy();
    const rows = await db.query<AccountRow>(
      `SELECT id, "userId", "accessToken", "refreshToken", "idToken" FROM account WHERE "userId" = $1 AND "providerId" = 'apple'`,
      [user.id],
    );
    const row = rows.rows[0];
    expect(row).toBeTruthy();
    assertNoPlaintext(row!, [ACCESS, REFRESH, ID_TOKEN]);
    const sql = makePgliteSql(db);
    await expect(ownedAppleRefreshToken(sql, env, user.id, APPLE_SUB)).resolves.toBe(REFRESH);
    await kysely.destroy();
    await db.close();
  });

  it("linkSocial (account update) stores no plaintext on account.*", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    const kysely = pgliteKysely(db);
    const env = tokenEnv();
    const auth = createAuth(env, { db: kysely, type: "postgres" });
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      name: "Ada",
      email: "ada-link@example.test",
      emailVerified: true,
    });
    const created = await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "apple",
      accountId: APPLE_SUB,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      idToken: ID_TOKEN,
    });
    expect(created?.id).toBeTruthy();
    await ctx.internalAdapter.updateAccount(created!.id, {
      accessToken: ACCESS_LINK,
      refreshToken: REFRESH_LINK,
      idToken: ID_TOKEN_LINK,
    });
    const rows = await db.query<AccountRow>(
      `SELECT id, "userId", "accessToken", "refreshToken", "idToken" FROM account WHERE id = $1`,
      [created!.id],
    );
    const row = rows.rows[0];
    expect(row).toBeTruthy();
    assertNoPlaintext(row!, [ACCESS, REFRESH, ID_TOKEN, ACCESS_LINK, REFRESH_LINK, ID_TOKEN_LINK]);
    const sql = makePgliteSql(db);
    await expect(ownedAppleRefreshToken(sql, env, user.id, APPLE_SUB)).resolves.toBe(REFRESH_LINK);
    await kysely.destroy();
    await db.close();
  });
});
