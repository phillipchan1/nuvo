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
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appleSocialProvider, createAuth, primeAppleClientSecret } from "../worker/src/auth.ts";
import type { Env } from "../worker/src/env.ts";
import app from "../worker/src/index.ts";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { installRequestIoForTests } from "../worker/src/requestIo.ts";
import { trustedReturnOrigin } from "../worker/src/signinDoor.ts";

// Blockers 2 / 2b (docs/cloudflare-cutover.md): Google and Apple sign-in on
// Better Auth, through the top-level door in worker/src/signinDoor.ts. Drives
// the real Hono app + real Better Auth over PGlite; only Google's token
// endpoint is faked.

class PGliteConnection implements DatabaseConnection {
  constructor(private client: PGlite) {}
  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const res = await this.client.query<R>(compiled.sql, compiled.parameters as unknown[]);
    return { rows: res.rows, numAffectedRows: BigInt(res.affectedRows ?? 0) };
  }
  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("not supported");
  }
}
class PGliteDriver implements Driver {
  constructor(private client: PGlite) {}
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
function pgliteKysely(db: PGlite) {
  return new Kysely<Record<string, unknown>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PGliteDriver(db),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

const BASE = "https://api.nuvo.day";
const encKey = btoa(String.fromCharCode(...Uint8Array.from({ length: 32 }, (_, i) => i + 7)));
const ENV: Env = {
  BETTER_AUTH_SECRET: "door-test-secret-0123456789abcdef0123456789",
  BETTER_AUTH_URL: BASE,
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-secret",
  TOKEN_ENC_KEY_V1: encKey,
};

// Copied account: the copy maps auth.users → "user" (same id) and
// auth.identities → account (provider subject), so Google finds it by sub.
const COPIED = "11111111-1111-4111-8111-111111111111";
const COPIED_SUB = "google-sub-copied";
// Email-only account (signed up with OTP on Supabase), no Google identity.
const EMAIL_ONLY = "22222222-2222-4222-8222-222222222222";

let db: PGlite;
let restoreIo: (() => void) | undefined;
let googleClaims: Record<string, unknown> = {};

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const idToken = `${b64url(JSON.stringify({ alg: "RS256", kid: "k" }))}.${b64url(JSON.stringify({
      iss: "https://accounts.google.com",
      aud: ENV.GOOGLE_CLIENT_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...googleClaims,
    }))}.sig`;
    return new Response(JSON.stringify({
      access_token: "ya29.access",
      id_token: idToken,
      expires_in: 3599,
      token_type: "Bearer",
      scope: "openid email profile",
    }), { headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
});
afterAll(() => {
  vi.unstubAllGlobals();
  restoreIo?.();
});

beforeEach(async () => {
  db = new PGlite();
  await db.exec(readFileSync("worker/schema/better-auth.sql", "utf8"));
  await db.query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, 'Ada', 'ada@example.test', true), ($2, 'Bo', 'bo@example.test', true)`, [COPIED, EMAIL_ONLY]);
  await db.query(`INSERT INTO account (id, "accountId", "providerId", "userId") VALUES ('acc-copied', $1, 'google', $2)`, [COPIED_SUB, COPIED]);
  const sql = makePgliteSql(db);
  restoreIo?.();
  restoreIo = installRequestIoForTests((env) => ({
    sql,
    auth: createAuth(env, { db: pgliteKysely(db), type: "postgres" }),
    close: async () => undefined,
  }));
});

/** A minimal cookie jar: what a first-party browser would send back. */
class Jar {
  private cookies = new Map<string, string>();
  take(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (/max-age=0/i.test(line) || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function get(path: string, jar?: Jar, env: Env = ENV): Promise<Response> {
  const res = await app.request(path.startsWith("http") ? path : `${BASE}${path}`, {
    headers: jar ? { Cookie: jar.header() } : {},
  }, env);
  jar?.take(res);
  return res;
}

function fragment(res: Response): URLSearchParams {
  const loc = res.headers.get("location") ?? "";
  return new URLSearchParams(loc.slice(loc.indexOf("#") + 1));
}

/** Door → Google → callback → return, as one top-level browser walk. */
async function walkGoogle(shell: string, extra = ""): Promise<{ final: Response; start: Response }> {
  const jar = new Jar();
  const start = await get(`/api/signin/google?return=${encodeURIComponent(shell)}${extra}`, jar);
  expect(start.status).toBe(302);
  const google = new URL(start.headers.get("location")!);
  const cb = await get(`/api/auth/callback/google?code=auth-code&state=${google.searchParams.get("state")}`, jar);
  expect(cb.status).toBe(302);
  const final = await get(cb.headers.get("location")!, jar);
  return { final, start };
}

async function redeem(shell: string, ott: string) {
  const res = await app.request(`${BASE}/api/auth/one-time-token/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: shell },
    body: JSON.stringify({ token: ott }),
  }, ENV);
  return res;
}

async function sessionUserId(bearer: string): Promise<string | undefined> {
  const res = await app.request(`${BASE}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${bearer}`, Origin: "tauri://localhost" },
  }, ENV);
  const body = await res.json() as { user?: { id: string } } | null;
  return body?.user?.id;
}

describe("sign-in door (Google)", () => {
  it("sends Google prompt=select_account (D-126) and the api.nuvo.day callback", async () => {
    const res = await get(`/api/signin/google?return=${encodeURIComponent("https://app.nuvo.day")}`, new Jar());
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/google`);
    expect(url.searchParams.get("client_id")).toBe(ENV.GOOGLE_CLIENT_ID);
    // The state cookie is set on this top-level response: first-party.
    expect(res.headers.getSetCookie().some((c) => /state/.test(c))).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  for (const shell of ["tauri://localhost", "https://app.nuvo.day"]) {
    it(`a copied Google user lands in the SAME account from ${shell}`, async () => {
      googleClaims = { sub: COPIED_SUB, email: "ada@example.test", email_verified: true, name: "Ada" };
      const { final } = await walkGoogle(shell);
      expect(final.status).toBe(302);
      expect(final.headers.get("location")!.startsWith(`${shell}/#nuvo_ott=`)).toBe(true);
      const ott = fragment(final).get("nuvo_ott")!;

      const verified = await redeem(shell, ott);
      expect(verified.status).toBe(200);
      expect(verified.headers.get("access-control-allow-origin")).toBe(shell);
      const bearer = verified.headers.get("set-auth-token");
      expect(bearer).toMatch(/\./); // signed, what requireSignature accepts
      expect(await sessionUserId(bearer!)).toBe(COPIED);

      // Single use.
      expect((await redeem(shell, ott)).status).toBe(400);
      // No duplicate user row.
      const users = await db.query(`SELECT id FROM "user" WHERE email = 'ada@example.test'`);
      expect(users.rows).toHaveLength(1);
    });
  }

  it("an email-only account links Google by verified email — same id, no second user", async () => {
    googleClaims = { sub: "google-sub-bo", email: "bo@example.test", email_verified: true, name: "Bo" };
    const { final } = await walkGoogle("tauri://localhost");
    const bearer = (await redeem("tauri://localhost", fragment(final).get("nuvo_ott")!)).headers.get("set-auth-token")!;
    expect(await sessionUserId(bearer)).toBe(EMAIL_ONLY);
    const acc = await db.query<{ userId: string }>(`SELECT "userId" FROM account WHERE "providerId" = 'google' AND "accountId" = 'google-sub-bo'`);
    expect(acc.rows).toEqual([{ userId: EMAIL_ONLY }]);
  });

  it("an unverified Google email never adopts an existing account", async () => {
    googleClaims = { sub: "google-sub-evil", email: "bo@example.test", email_verified: false, name: "Mallory" };
    const { final } = await walkGoogle("https://app.nuvo.day");
    expect(fragment(final).get("nuvo_auth_error")).toBeTruthy();
    const acc = await db.query(`SELECT 1 FROM account WHERE "accountId" = 'google-sub-evil'`);
    expect(acc.rows).toHaveLength(0);
  });

  it("a brand-new Google user gets a new UUID account", async () => {
    googleClaims = { sub: "google-sub-new", email: "new@example.test", email_verified: true, name: "New" };
    const { final } = await walkGoogle("https://app.nuvo.day");
    const bearer = (await redeem("https://app.nuvo.day", fragment(final).get("nuvo_ott")!)).headers.get("set-auth-token")!;
    const id = await sessionUserId(bearer);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect([COPIED, EMAIL_ONLY]).not.toContain(id);
  });

  it("links Google onto the signed-in account through a one-time token, never a bearer in the URL", async () => {
    // Bo signs in by OTP-equivalent: mint a session directly.
    const ctx = await createAuth(ENV, { db: pgliteKysely(db), type: "postgres" }).$context;
    const session = await ctx.internalAdapter.createSession(EMAIL_ONLY);
    const { signBearerToken } = await import("../worker/src/auth.ts");
    const bearer = await signBearerToken(ENV.BETTER_AUTH_SECRET!, session.token);
    const gen = await app.request(`${BASE}/api/auth/one-time-token/generate`, {
      headers: { Authorization: `Bearer ${bearer}`, Origin: "tauri://localhost" },
    }, ENV);
    expect(gen.status).toBe(200);
    const { token } = await gen.json() as { token: string };
    expect(token).toBeTruthy();

    googleClaims = { sub: "google-sub-bo-2", email: "bo.other@gmail.example", email_verified: true, name: "Bo" };
    const { final, start } = await walkGoogle("tauri://localhost", `&link=${token}`);
    expect(start.headers.get("location"), start.headers.get("location") ?? "").toMatch(/^https:\/\/accounts\.google\.com/);
    expect(final.headers.get("location")).toBe("tauri://localhost/#nuvo_linked=google");
    const acc = await db.query<{ userId: string }>(`SELECT "userId" FROM account WHERE "accountId" = 'google-sub-bo-2'`);
    expect(acc.rows).toEqual([{ userId: EMAIL_ONLY }]);
  });

  it("refuses an untrusted return (never an open redirect)", async () => {
    for (const bad of ["https://evil.example", "https://app.nuvo.day/path", "https://app.nuvo.day?x=1", "javascript:alert(1)", ""]) {
      const res = await get(`/api/signin/google?return=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
      expect(res.headers.get("location"), bad).toBeNull();
    }
    const ret = await get(`/api/signin/return?to=${encodeURIComponent("https://evil.example")}`);
    expect(ret.status).toBe(400);
    expect(trustedReturnOrigin("tauri://localhost", ENV)).toBe("tauri://localhost");
    expect(trustedReturnOrigin("tauri://localhost/", ENV)).toBe("tauri://localhost");
  });

  it("an unconfigured provider sends the shell back with a readable error", async () => {
    const env = { ...ENV, GOOGLE_CLIENT_SECRET: "" };
    const res = await get(`/api/signin/google?return=${encodeURIComponent("https://app.nuvo.day")}`, new Jar(), env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.nuvo.day/#nuvo_auth_error=provider_not_configured");
  });

  it("a return without a session never mints a token", async () => {
    const res = await get(`/api/signin/return?to=${encodeURIComponent("https://app.nuvo.day")}&provider=google`);
    expect(res.headers.get("location")).toBe("https://app.nuvo.day/#nuvo_auth_error=session_missing");
  });
});

describe("Apple on Better Auth (2b)", () => {
  async function siwaEnv(): Promise<Env> {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`;
    return {
      ...ENV,
      APPLE_CLIENT_ID: "day.nuvo.web",
      APPLE_BUNDLE_ID: "day.nuvo.app",
      APPLE_SIWA_TEAM_ID: "TEAMID1234",
      APPLE_SIWA_KEY_ID: "KEYID12345",
      APPLE_SIWA_PRIVATE_KEY: pem,
    };
  }

  it("mints its client_secret from the SIWA key when APPLE_CLIENT_SECRET is absent", async () => {
    const env = await siwaEnv();
    await primeAppleClientSecret(env);
    const provider = appleSocialProvider(env)!;
    expect(provider).toBeDefined();
    const [h, p] = provider.clientSecret.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toMatchObject({ alg: "ES256", kid: "KEYID12345" });
    const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(claims).toMatchObject({ iss: "TEAMID1234", sub: "day.nuvo.web", aud: "https://appleid.apple.com" });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(15_777_000);
    // Native (bundle id) and web (Services ID) id tokens are both accepted.
    expect(provider.audience).toEqual(["day.nuvo.web", "day.nuvo.app"]);
  });

  it("an explicit APPLE_CLIENT_SECRET still wins", async () => {
    const env = { ...(await siwaEnv()), APPLE_CLIENT_SECRET: "explicit.jwt" };
    await primeAppleClientSecret(env);
    expect(appleSocialProvider(env)?.clientSecret).toBe("explicit.jwt");
  });

  it("the door starts Apple's web flow (form_post) once the secrets exist", async () => {
    const env = await siwaEnv();
    const res = await get(`/api/signin/apple?return=${encodeURIComponent("https://app.nuvo.day")}`, new Jar(), env);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://appleid.apple.com/auth/authorize");
    expect(url.searchParams.get("response_mode")).toBe("form_post");
    expect(url.searchParams.get("client_id")).toBe("day.nuvo.web");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/apple`);
  });

  it("without any Apple secret the door says so instead of failing at Apple", async () => {
    const res = await get(`/api/signin/apple?return=${encodeURIComponent("tauri://localhost")}`, new Jar());
    expect(res.headers.get("location")).toBe("tauri://localhost/#nuvo_auth_error=provider_not_configured");
  });
});
