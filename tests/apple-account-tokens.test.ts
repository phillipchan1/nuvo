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
import { describe, expect, it, vi } from "vitest";
import { decryptOAuthToken, setTokenUtil } from "better-auth/oauth2";
import { ACCOUNT_DELETE_CONFIRM } from "../supabase/functions/_shared/accountDeletion.ts";
import { revokeAppleToken } from "../supabase/functions/_shared/appleIdentity.ts";
import { appleSocialProvider, createAuth } from "../worker/src/auth.ts";
import { APPLE_TOKEN_UNOPENABLE, deleteOwnedAccount } from "../worker/src/deleteAccount.ts";
import type { Env } from "../worker/src/env.ts";
import type { Sql } from "../worker/src/db.ts";
import {
  formatNuvoSealedToken,
  isLikelyEncrypted,
  isNuvoSealedToken,
  openAccountRefreshToken,
  sealAccountTokenFields,
  tryDecryptBaToken,
} from "../worker/src/lib/accountTokens.ts";
import { parseTokenKeyring, sealToken, sealedColumnValues, TokenCryptoError } from "../worker/src/secrets.ts";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { ownedAppleRefreshToken, upsertOwnedAppleIdentity, type Store } from "../worker/src/store.ts";

vi.mock("../supabase/functions/_shared/appleIdentity.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../supabase/functions/_shared/appleIdentity.ts")>();
  return {
    ...actual,
    revokeAppleToken: vi.fn(async () => true),
  };
});

const SCHEMA = readFileSync("worker/schema/better-auth.sql", "utf8");
const ACCESS = "at_apple_web_do_not_store";
const REFRESH = "rt_apple_web_do_not_store";
const ID_TOKEN = "id_apple_web_do_not_store";
const ACCESS_LINK = "at_apple_link_do_not_store";
const REFRESH_LINK = "rt_apple_link_do_not_store";
const ID_TOKEN_LINK = "id_apple_link_do_not_store";
const NATIVE_REFRESH = "rt_apple_native_do_not_store";
const APPLE_SUB = "001234.apple-sub.oauth";

const APPLE_IDENTITIES_DDL = `
CREATE TABLE IF NOT EXISTS apple_identities (
  user_id UUID PRIMARY KEY,
  apple_user_id TEXT,
  email TEXT,
  given_name TEXT,
  family_name TEXT,
  is_private_relay BOOLEAN NOT NULL DEFAULT FALSE,
  refresh_token_enc BYTEA,
  refresh_token_iv BYTEA,
  key_version SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

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
    APPLE_SIWA_CLIENT_ID: "com.nuvo.app",
    APPLE_BUNDLE_ID: "com.nuvo.bundle",
    APPLE_SIWA_TEAM_ID: "TEAMID",
    APPLE_SIWA_KEY_ID: "KEYID",
    APPLE_SIWA_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMFECAQEEFA==\n-----END PRIVATE KEY-----",
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

async function assertNoPlaintext(row: AccountRow, tokens: string[], secret: string): Promise<void> {
  const blob = JSON.stringify(row);
  for (const token of tokens) {
    expect(blob).not.toContain(token);
  }
  for (const value of [row.accessToken, row.refreshToken, row.idToken]) {
    expect(value).toBeTruthy();
    const ba = await tryDecryptBaToken(secret, value as string);
    expect(ba !== null || isNuvoSealedToken(value as string)).toBe(true);
  }
}

function otherEncKey(): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => i + 91);
  return btoa(String.fromCharCode(...bytes));
}

async function seedNativeAppleRefresh(store: Store, env: Env, token = NATIVE_REFRESH): Promise<void> {
  const keyring = await parseTokenKeyring(env);
  const sealed = await sealToken(token, { table: "apple_identities", rowId: store.userId, userId: store.userId }, keyring);
  const cols = sealedColumnValues(sealed);
  await upsertOwnedAppleIdentity(
    store,
    {
      apple_user_id: APPLE_SUB,
      email: null,
      given_name: null,
      family_name: null,
      is_private_relay: false,
    },
    { enc: cols.refresh_token_enc, iv: cols.refresh_token_iv, keyVersion: cols.key_version },
  );
}

function storeWithFakeWipe(db: PGlite, userId: string): Store {
  const base = makePgliteSql(db);
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => base(strings, ...values),
    {
      json: (value: unknown) => base.json(value),
      begin: async <T>(fn: (tx: Sql) => Promise<T>): Promise<T> => {
        const tx = Object.assign(
          (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (strings.join("?").includes("DELETE FROM")) return Promise.resolve([{ id: userId }]);
            return base(strings, ...values);
          },
          { json: (value: unknown) => base.json(value) },
        ) as Sql;
        return fn(tx);
      },
    },
  ) as Sql;
  return { sql, userId };
}

describe.sequential("Better Auth Apple tokens never land in plaintext", { timeout: 60_000 }, () => {
  it("wires encryptOAuthTokens and the account seal hook", () => {
    const src = readFileSync("worker/src/auth.ts", "utf8");
    expect(src).toContain("encryptOAuthTokens: true");
    expect(src).toContain("sealAccountTokenFields");
    expect(src).toContain("databaseHooks");
    expect(src).toMatch(/TOKEN_ENC_KEY_V1/);
  });

  it("classifies BA ciphertext as $ba$ or lowercase even-length hex of 82+ chars", async () => {
    const secret = tokenEnv().BETTER_AUTH_SECRET as string;
    expect(isNuvoSealedToken("nv1.1.iv.ct")).toBe(true);
    expect(isLikelyEncrypted("$ba$not-real")).toBe(true);
    expect(isLikelyEncrypted("aa".repeat(32))).toBe(false);
    expect(isLikelyEncrypted("aa".repeat(40))).toBe(false);
    expect(isLikelyEncrypted("aa".repeat(41))).toBe(true);
    expect(isLikelyEncrypted("AA".repeat(41))).toBe(false);
    expect(isLikelyEncrypted(REFRESH)).toBe(false);
    expect(await tryDecryptBaToken(secret, "$ba$not-real")).toBeNull();
    expect(await tryDecryptBaToken(secret, "aa".repeat(32))).toBeNull();
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const hex = await symmetricEncrypt({ key: secret, data: REFRESH });
    expect(hex.startsWith("$ba$")).toBe(false);
    expect(hex).toMatch(/^[0-9a-f]+$/);
    expect(hex.length).toBeGreaterThanOrEqual(82);
    expect(isLikelyEncrypted(hex)).toBe(true);
    expect(await tryDecryptBaToken(secret, hex)).toBe(REFRESH);
  });

  it("invalid or missing TOKEN_ENC_KEY_V1 disables the Apple provider", () => {
    const base = { APPLE_CLIENT_ID: "id.apple", APPLE_CLIENT_SECRET: "jwt" } as Env;
    expect(appleSocialProvider(base)).toBeUndefined();
    expect(appleSocialProvider({ ...base, TOKEN_ENC_KEY_V1: "" })).toBeUndefined();
    expect(appleSocialProvider({ ...base, TOKEN_ENC_KEY_V1: "not-a-32-byte-key" })).toBeUndefined();
    expect(appleSocialProvider({ ...base, TOKEN_ENC_KEY_V1: encKey() })).toMatchObject({
      clientId: "id.apple",
      clientSecret: "jwt",
    });
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
    await assertNoPlaintext(row!, [ACCESS, REFRESH, ID_TOKEN], env.BETTER_AUTH_SECRET as string);
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
    await assertNoPlaintext(
      row!,
      [ACCESS, REFRESH, ID_TOKEN, ACCESS_LINK, REFRESH_LINK, ID_TOKEN_LINK],
      env.BETTER_AUTH_SECRET as string,
    );
    const sql = makePgliteSql(db);
    await expect(ownedAppleRefreshToken(sql, env, user.id, APPLE_SUB)).resolves.toBe(REFRESH_LINK);
    await kysely.destroy();
    await db.close();
  });

  it("BA's real token write + hooks return plaintext to ownedAppleRefreshToken, BA reads, and revoke", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    const kysely = pgliteKysely(db);
    const env = tokenEnv();
    const auth = createAuth(env, { db: kysely, type: "postgres" });
    const ctx = await auth.$context;
    const baCtx = ctx as Parameters<typeof setTokenUtil>[1];
    const user = await ctx.internalAdapter.createUser({
      name: "Ada",
      email: "ada-ba-real@example.test",
      emailVerified: true,
    });
    const created = await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "apple",
      accountId: APPLE_SUB,
      accessToken: await setTokenUtil(ACCESS, baCtx),
      refreshToken: await setTokenUtil(REFRESH, baCtx),
      idToken: await setTokenUtil(ID_TOKEN, baCtx),
    });
    expect(created?.id).toBeTruthy();

    const createdRow = (
      await db.query<AccountRow>(
        `SELECT id, "userId", "accessToken", "refreshToken", "idToken" FROM account WHERE id = $1`,
        [created!.id],
      )
    ).rows[0];
    expect(createdRow).toBeTruthy();
    await assertNoPlaintext(createdRow!, [ACCESS, REFRESH, ID_TOKEN], env.BETTER_AUTH_SECRET as string);
    expect(isNuvoSealedToken(createdRow!.refreshToken as string)).toBe(false);
    expect(await decryptOAuthToken(createdRow!.refreshToken as string, baCtx)).toBe(REFRESH);
    await expect(ownedAppleRefreshToken(makePgliteSql(db), env, user.id, APPLE_SUB)).resolves.toBe(REFRESH);

    await ctx.internalAdapter.updateAccount(created!.id, {
      accessToken: await setTokenUtil(ACCESS_LINK, baCtx),
      refreshToken: await setTokenUtil(REFRESH_LINK, baCtx),
      idToken: await setTokenUtil(ID_TOKEN_LINK, baCtx),
    });
    const updatedRow = (
      await db.query<AccountRow>(
        `SELECT id, "userId", "accessToken", "refreshToken", "idToken" FROM account WHERE id = $1`,
        [created!.id],
      )
    ).rows[0];
    expect(isNuvoSealedToken(updatedRow!.refreshToken as string)).toBe(false);
    expect(await decryptOAuthToken(updatedRow!.refreshToken as string, baCtx)).toBe(REFRESH_LINK);
    await expect(ownedAppleRefreshToken(makePgliteSql(db), env, user.id, APPLE_SUB)).resolves.toBe(
      REFRESH_LINK,
    );

    vi.mocked(revokeAppleToken).mockClear();
    const res = await deleteOwnedAccount(
      storeWithFakeWipe(db, user.id),
      { id: user.id },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      {
        ...env,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "k",
      },
      async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(200);
    expect(revokeAppleToken).toHaveBeenCalled();
    expect(vi.mocked(revokeAppleToken).mock.calls[0]?.[1]).toBe(REFRESH_LINK);
    expect(vi.mocked(revokeAppleToken).mock.calls[0]?.[0]?.clientId).toBe("com.nuvo.web");

    await kysely.destroy();
    await db.close();
  });

  it("opens a legacy nv1-wrapped BA hex row to the original plaintext", async () => {
    const env = tokenEnv();
    const secret = env.BETTER_AUTH_SECRET as string;
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const hex = await symmetricEncrypt({ key: secret, data: REFRESH });
    const userId = "11111111-1111-1111-1111-111111111111";
    const keyring = await parseTokenKeyring(env);
    const wrapped = formatNuvoSealedToken(
      await sealToken(hex, { table: "account", rowId: userId, userId }, keyring),
    );
    expect(isNuvoSealedToken(wrapped)).toBe(true);
    await expect(
      openAccountRefreshToken(env, wrapped, { id: userId, userId }),
    ).resolves.toBe(REFRESH);
  });

  it("rotation: old secret writes, new+old keyring reads, wrong-only key fails closed", async () => {
    const oldSecret = "old-better-auth-secret-32-bytes!!";
    const newSecret = "new-better-auth-secret-32-bytes!!";
    const v1 = encKey();
    const userId = "11111111-1111-1111-1111-111111111111";
    const written = await sealAccountTokenFields(
      { TOKEN_ENC_KEY_V1: v1, BETTER_AUTH_SECRET: oldSecret },
      { userId, refreshToken: REFRESH },
    );
    const stored = written.refreshToken as string;
    expect(stored).not.toBe(REFRESH);
    expect(isLikelyEncrypted(stored)).toBe(true);

    const keyring = {
      keys: new Map([
        [2, newSecret],
        [1, oldSecret],
      ]),
      currentVersion: 2,
      legacySecret: oldSecret,
    };
    await expect(
      openAccountRefreshToken({ TOKEN_ENC_KEY_V1: v1, secretConfig: keyring }, stored, { userId }),
    ).resolves.toBe(REFRESH);

    const wrongOnly = { keys: new Map([[2, newSecret]]), currentVersion: 2 };
    await expect(
      openAccountRefreshToken({ TOKEN_ENC_KEY_V1: v1, secretConfig: wrongOnly }, stored, { userId }),
    ).resolves.toBeNull();
    await expect(
      openAccountRefreshToken({ TOKEN_ENC_KEY_V1: v1, BETTER_AUTH_SECRET: newSecret }, stored, { userId }),
    ).resolves.toBeNull();

    const resealed = await sealAccountTokenFields(
      { TOKEN_ENC_KEY_V1: v1, secretConfig: wrongOnly, BETTER_AUTH_SECRET: newSecret },
      { userId, refreshToken: stored },
    );
    expect(resealed.refreshToken).toBe(stored);

    const db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(APPLE_IDENTITIES_DDL);
    const kysely = pgliteKysely(db);
    const writeEnv = { ...tokenEnv(), BETTER_AUTH_SECRET: oldSecret };
    const writeAuth = createAuth(writeEnv, { db: kysely, type: "postgres" });
    const writeCtx = await writeAuth.$context;
    const user = await writeCtx.internalAdapter.createUser({
      name: "Ada",
      email: "ada-rotate@example.test",
      emailVerified: true,
    });
    await writeCtx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "apple",
      accountId: APPLE_SUB,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      idToken: ID_TOKEN,
    });
    const row = (
      await db.query<AccountRow>(
        `SELECT id, "userId", "accessToken", "refreshToken", "idToken" FROM account WHERE "userId" = $1`,
        [user.id],
      )
    ).rows[0];
    expect(row?.refreshToken).toBeTruthy();
    expect(isLikelyEncrypted(row!.refreshToken as string)).toBe(true);

    vi.mocked(revokeAppleToken).mockClear();
    const rotatedEnv = {
      ...tokenEnv(),
      BETTER_AUTH_SECRET: newSecret,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "k",
    };
    const res = await deleteOwnedAccount(
      storeWithFakeWipe(db, user.id),
      { id: user.id },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      rotatedEnv,
      async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, appleRevoked: false });
    const revokeArgs = vi.mocked(revokeAppleToken).mock.calls.map((c) => c[1]);
    expect(revokeArgs).not.toContain(row!.refreshToken);
    for (const arg of revokeArgs) {
      expect(isLikelyEncrypted(arg as string)).toBe(false);
    }

    await kysely.destroy();
    await db.close();
  });

  it("unopenable Apple token reports appleRevoked=false and logs a token-free reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(APPLE_IDENTITIES_DDL);
    const kysely = pgliteKysely(db);
    const writeEnv = tokenEnv();
    const auth = createAuth(writeEnv, { db: kysely, type: "postgres" });
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      name: "Ada",
      email: "ada-unopenable@example.test",
      emailVerified: true,
    });
    await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "apple",
      accountId: APPLE_SUB,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      idToken: ID_TOKEN,
    });
    const stored = (
      await db.query<AccountRow>(
        `SELECT "refreshToken" FROM account WHERE "userId" = $1`,
        [user.id],
      )
    ).rows[0]?.refreshToken as string;
    expect(isLikelyEncrypted(stored)).toBe(true);

    vi.mocked(revokeAppleToken).mockClear();
    const res = await deleteOwnedAccount(
      storeWithFakeWipe(db, user.id),
      { id: user.id },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      {
        ...writeEnv,
        BETTER_AUTH_SECRET: "wrong-only-better-auth-secret-32b!",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "k",
      },
      async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, appleRevoked: false });
    expect(revokeAppleToken).not.toHaveBeenCalled();

    const logged = warn.mock.calls.map((c) => JSON.stringify(c));
    expect(logged.some((line) => line.includes(APPLE_TOKEN_UNOPENABLE))).toBe(true);
    for (const line of logged) {
      expect(line).not.toContain(REFRESH);
      expect(line).not.toContain(ACCESS);
      expect(line).not.toContain(stored);
      expect(line).not.toContain(user.id);
    }
    warn.mockRestore();
    await kysely.destroy();
    await db.close();
  });

  it("web-unopenable plus native token revokes with the native token and its client_id", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(APPLE_IDENTITIES_DDL);
    const kysely = pgliteKysely(db);
    const env = tokenEnv();
    const auth = createAuth(env, { db: kysely, type: "postgres" });
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      name: "Ada",
      email: "ada-web-miss-native@example.test",
      emailVerified: true,
    });
    await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "apple",
      accountId: APPLE_SUB,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      idToken: ID_TOKEN,
    });
    const store = storeWithFakeWipe(db, user.id);
    await seedNativeAppleRefresh(store, env);
    vi.mocked(revokeAppleToken).mockClear();
    const res = await deleteOwnedAccount(
      store,
      { id: user.id },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      {
        ...env,
        BETTER_AUTH_SECRET: "wrong-only-better-auth-secret-32b!",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "k",
      },
      async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, appleRevoked: true });
    expect(revokeAppleToken).toHaveBeenCalledTimes(1);
    const [config, token] = vi.mocked(revokeAppleToken).mock.calls[0] ?? [];
    expect(token).toBe(NATIVE_REFRESH);
    expect(token).not.toBe(REFRESH);
    expect(config?.clientId).toBe(env.APPLE_SIWA_CLIENT_ID);
    expect(config?.clientId).not.toBe(env.APPLE_CLIENT_ID);
    await kysely.destroy();
    await db.close();
  });

  it("web and native both unopenable: appleRevoked=false and one token-free log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(APPLE_IDENTITIES_DDL);
    const kysely = pgliteKysely(db);
    const env = tokenEnv();
    const auth = createAuth(env, { db: kysely, type: "postgres" });
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      name: "Ada",
      email: "ada-both-unopenable@example.test",
      emailVerified: true,
    });
    await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "apple",
      accountId: APPLE_SUB,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      idToken: ID_TOKEN,
    });
    const store = storeWithFakeWipe(db, user.id);
    await seedNativeAppleRefresh(store, env);
    vi.mocked(revokeAppleToken).mockClear();
    const wrongSecret = "wrong-only-better-auth-secret-32b!";
    const res = await deleteOwnedAccount(
      store,
      { id: user.id },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      {
        ...env,
        BETTER_AUTH_SECRET: wrongSecret,
        TOKEN_ENC_KEY_V1: otherEncKey(),
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "k",
      },
      async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, appleRevoked: false });
    expect(revokeAppleToken).not.toHaveBeenCalled();
    const logged = warn.mock.calls.map((c) => JSON.stringify(c));
    expect(logged.filter((line) => line.includes(APPLE_TOKEN_UNOPENABLE))).toHaveLength(1);
    for (const line of logged) {
      expect(line).not.toContain(REFRESH);
      expect(line).not.toContain(NATIVE_REFRESH);
      expect(line).not.toContain(user.id);
      expect(line).not.toContain(wrongSecret);
      expect(line).not.toContain(env.BETTER_AUTH_SECRET);
      expect(line).not.toContain(env.TOKEN_ENC_KEY_V1);
    }
    warn.mockRestore();
    await kysely.destroy();
    await db.close();
  });

  it("web-issued tokens revoke with APPLE_CLIENT_ID, not APPLE_SIWA_CLIENT_ID", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    const kysely = pgliteKysely(db);
    const env = tokenEnv();
    expect(env.APPLE_CLIENT_ID).not.toBe(env.APPLE_SIWA_CLIENT_ID);
    const auth = createAuth(env, { db: kysely, type: "postgres" });
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      name: "Ada",
      email: "ada-issuer@example.test",
      emailVerified: true,
    });
    await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "apple",
      accountId: APPLE_SUB,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      idToken: ID_TOKEN,
    });
    vi.mocked(revokeAppleToken).mockClear();
    const res = await deleteOwnedAccount(
      storeWithFakeWipe(db, user.id),
      { id: user.id },
      { confirm: ACCOUNT_DELETE_CONFIRM },
      {
        ...env,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "k",
      },
      async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(200);
    expect(revokeAppleToken).toHaveBeenCalled();
    const config = vi.mocked(revokeAppleToken).mock.calls[0]?.[0];
    expect(config?.clientId).toBe(env.APPLE_CLIENT_ID);
    expect(config?.clientId).not.toBe(env.APPLE_SIWA_CLIENT_ID);
    expect(vi.mocked(revokeAppleToken).mock.calls[0]?.[1]).toBe(REFRESH);
    await kysely.destroy();
    await db.close();
  });
});
