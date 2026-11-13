import { betterAuth } from "better-auth";
import { bearer, emailOTP, oneTimeToken } from "better-auth/plugins";
import { Pool } from "pg";
import { authCookieSecure, resolveAuthBaseURL } from "./authUrl.ts";
import { trustedAuthOrigins } from "./cors.ts";
import { clientConnection, CONNECT_TIMEOUT_MS, raceTimeout } from "./db.ts";
import { databaseUrl, type Env } from "./env.ts";
import {
  appleClientSecret,
  appleIssuedClientId,
  readAppleAuthConfig,
} from "../../supabase/functions/_shared/appleIdentity.ts";
import { parseBetterAuthSecrets, sealAccountTokenFields } from "./lib/accountTokens.ts";
import { verifyPassword } from "./passwordHash.ts";
import { parseRawKey } from "./secrets.ts";

export type AuthDatabase = Pool | { db: object; type: "postgres" };
export type AuthInstance = ReturnType<typeof createAuth>;

/** Console OTP delivery: `ENVIRONMENT=local` or `ENVIRONMENT=preview` only. Never production. */
export function otpConsoleAllowed(env: Pick<Env, "ENVIRONMENT">): boolean {
  const mode = (env.ENVIRONMENT ?? "").trim().toLowerCase();
  return mode === "local" || mode === "preview";
}

async function sendOtpEmail(env: Env, email: string, otp: string, type: string): Promise<void> {
  const subject = type === "forget-password"
    ? "Reset your Nuvo sign-in"
    : "Your Nuvo sign-in code";
  const text = `Your code is ${otp}. It expires in 5 minutes.\n\nIf you did not request this, ignore the email.`;
  if (!env.RESEND_API_KEY) {
    if (otpConsoleAllowed(env)) {
      console.log(`[auth] OTP for ${email} (${type}): ${otp}`);
    }
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || "Nuvo <noreply@localhost>",
      to: email,
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Social sign-in persists provider tokens; never wire one we cannot seal. */
function tokenSealingReady(env: Env): boolean {
  const v1 = (env.TOKEN_ENC_KEY_V1 ?? "").trim();
  if (!v1) return false;
  try {
    parseRawKey(v1);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apple's client_secret is an ES256 JWT (≤6 months). An explicit
 * APPLE_CLIENT_SECRET wins; otherwise one is minted from the SIWA key the
 * Worker already holds for revocation (APPLE_SIWA_TEAM_ID / _KEY_ID /
 * _PRIVATE_KEY), so there is no half-yearly secret to rotate by hand.
 * Minting is async and Better Auth's options are not, so callers that may
 * reach Apple's token endpoint `await primeAppleClientSecret(env)` first
 * (`/api/auth/*`, the sign-in door). One per isolate, re-minted a day out.
 */
const APPLE_SECRET_TTL_S = 7 * 24 * 60 * 60;
let mintedApple: { key: string; secret: string; expMs: number } | null = null;

function appleMintKey(env: Env): string | null {
  const cfg = readAppleAuthConfig(env as unknown as Record<string, string | undefined>, "web");
  return cfg ? `${cfg.teamId}:${cfg.keyId}:${cfg.clientId}` : null;
}

export async function primeAppleClientSecret(env: Env, nowMs = Date.now()): Promise<void> {
  if (env.APPLE_CLIENT_SECRET?.trim()) return;
  const cfg = readAppleAuthConfig(env as unknown as Record<string, string | undefined>, "web");
  if (!cfg) return;
  const key = `${cfg.teamId}:${cfg.keyId}:${cfg.clientId}`;
  if (mintedApple?.key === key && mintedApple.expMs - nowMs > 24 * 60 * 60 * 1000) return;
  try {
    const secret = await appleClientSecret(cfg, Math.floor(nowMs / 1000), APPLE_SECRET_TTL_S);
    mintedApple = { key, secret, expMs: nowMs + APPLE_SECRET_TTL_S * 1000 };
  } catch {
    // A malformed key leaves Apple unwired (fail closed), never the request broken.
  }
}

function appleClientSecretFor(env: Env): string | undefined {
  const explicit = env.APPLE_CLIENT_SECRET?.trim();
  if (explicit) return explicit;
  const key = appleMintKey(env);
  return key && mintedApple?.key === key ? mintedApple.secret : undefined;
}

export function appleSocialProvider(env: Env) {
  const clientId = appleIssuedClientId(env, "web");
  const clientSecret = appleClientSecretFor(env);
  // Fail closed: missing or invalid TOKEN_ENC_KEY_V1 would persist tokens
  // we cannot seal. Do not wire a sign-in that cannot persist.
  if (!clientId || !clientSecret || !tokenSealingReady(env)) return undefined;
  const bundle = env.APPLE_BUNDLE_ID?.trim();
  // Native iOS id tokens are issued to the bundle id, the web redirect to
  // the Services ID — accept both, never anything else.
  const audience = [...new Set([clientId, env.APPLE_SIWA_CLIENT_ID?.trim(), bundle].filter(Boolean) as string[])];
  return {
    clientId,
    clientSecret,
    audience,
    ...(bundle ? { appBundleIdentifier: bundle } : {}),
  };
}

/**
 * Google sign-in (blocker 2). The same OAuth client the calendar connect
 * uses; its redirect list needs `${BETTER_AUTH_URL}/api/auth/callback/google`.
 * `prompt: "select_account"` is D-126: without it Google silently re-uses
 * the last account in the webview's cookie jar, which outlives a Nuvo
 * sign-out on iOS. Profile scopes only — calendar access is its own grant.
 */
export function googleSocialProvider(env: Env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !tokenSealingReady(env)) return undefined;
  return {
    clientId,
    clientSecret,
    prompt: "select_account" as const,
  };
}

export function createAuth(env: Env, database: AuthDatabase) {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  const secrets = parseBetterAuthSecrets(env.BETTER_AUTH_SECRETS);
  const baseURL = resolveAuthBaseURL(env);
  const apple = appleSocialProvider(env);
  const google = googleSocialProvider(env);
  const socialProviders = {
    ...(apple ? { apple } : {}),
    ...(google ? { google } : {}),
  };
  return betterAuth({
    secret,
    ...(secrets ? { secrets } : {}),
    baseURL,
    basePath: "/api/auth",
    database,
    account: {
      // 1.7.13 stores OAuth tokens in plaintext unless this is set.
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        // Explicit linking only (Settings → Link Google / Apple, which needs
        // the signed-in session): a person's Google is often not the address
        // they signed up with, and Supabase's linkIdentity allowed it.
        // Implicit linking at sign-in still requires a provider-verified,
        // matching email — that rule is Better Auth's and is unchanged.
        allowDifferentEmails: true,
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account, ctx) => {
            const sealed = await sealAccountTokenFields(env, account, ctx?.context.secretConfig);
            return { data: { ...account, ...sealed } };
          },
        },
        update: {
          before: async (account, ctx) => {
            const sealed = await sealAccountTokenFields(env, account, ctx?.context.secretConfig);
            return { data: { ...account, ...sealed } };
          },
        },
      },
    },
    ...(apple || google ? { socialProviders } : {}),
    // Password stays for App Review / already-verified accounts. Sign-up
    // must not auto-sign-in: an unverified email+password account would
    // otherwise adopt the planner row for that email (account takeover).
    // Everyday sign-in is OTP, which marks emailVerified.
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      password: { verify: verifyPassword },
    },
    // Same list as the CORS echo (cors.ts), so the browser and Better Auth's
    // own origin check never disagree about a shell.
    trustedOrigins: trustedAuthOrigins(env),
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: authCookieSecure(baseURL),
        httpOnly: true,
        path: "/",
      },
    },
    plugins: [
      bearer({ requireSignature: true }),
      // The sign-in door's return leg (signinDoor.ts): a single-use, 3-minute
      // token handed to the shell in a URL fragment, because a cookie set on
      // the API origin is invisible to tauri://localhost. Stored hashed.
      oneTimeToken({ expiresIn: 3, storeToken: "hashed" }),
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        sendVerificationOTP: async ({ email, otp, type }) => {
          await sendOtpEmail(env, email, otp, type);
        },
      }),
    ],
  });
}

/**
 * Fresh Pool + Better Auth per request. Workers cannot reuse I/O across
 * requests. `max: 1` — the other of two sockets a data request opens
 * (see openSql). Production uses Hyperdrive so 150–200 parallel requests
 * do not exhaust Postgres `max_connections` (100).
 */
export function openAuth(env: Env): { auth: AuthInstance; close: () => Promise<void> } {
  const url = databaseUrl(env);
  if (!url) throw new Error("database is not configured");
  const { connectionString, ssl } = clientConnection(env, url);
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    ssl: ssl === "require",
  });
  const auth = createAuth(env, pool);
  return {
    auth,
    close: async () => {
      await raceTimeout(pool.end(), CONNECT_TIMEOUT_MS).catch(() => undefined);
    },
  };
}

/**
 * Cookie signing (better-call `signCookieValue`): HMAC-SHA256 + standard
 * base64, then encodeURIComponent. That string is what the bearer plugin
 * copies onto `set-auth-token` after sign-in.
 */
export async function signBearerToken(secret: string, rawToken: string): Promise<string> {
  if (!rawToken || rawToken.includes(".")) return rawToken;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawToken));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return encodeURIComponent(`${rawToken}.${btoa(bin)}`);
}

/** Signed session cookie value (`token.signature`, possibly URI-encoded). */
export function sessionTokenFromCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === "better-auth.session_token" || name === "__Secure-better-auth.session_token") {
      const value = part.slice(eq + 1).trim();
      return value || null;
    }
  }
  return null;
}

/**
 * Only a body that describes a session carries a session token: sign-in
 * (`{ token, user }`) and get-session (`{ session, user }`). Any other
 * `token` — the one-time token from `/one-time-token/generate` — is not a
 * session token and must reach the client untouched.
 */
function isSessionBody(body: Record<string, unknown>): boolean {
  return Boolean(body.user && typeof body.user === "object");
}

function rewriteTokenFields(body: Record<string, unknown>, signed: string): void {
  if (typeof body.token === "string" && !body.token.includes(".")) body.token = signed;
  const session = body.session;
  if (session && typeof session === "object") {
    const row = session as Record<string, unknown>;
    if (typeof row.token === "string" && !row.token.includes(".")) row.token = signed;
  }
}

function rawTokenFromBody(body: Record<string, unknown>): string | null {
  if (typeof body.token === "string" && !body.token.includes(".")) return body.token;
  const session = body.session;
  if (session && typeof session === "object") {
    const row = session as Record<string, unknown>;
    if (typeof row.token === "string" && !row.token.includes(".")) return row.token;
  }
  return null;
}

/**
 * Cookie-only get-session has no `set-auth-token` header — Better Auth
 * returns the raw `session.token`. Sign it so a new tab that falls through
 * to the JSON body still gets a bearer the plugin will accept.
 */
export async function exposeSignedAuthToken(
  res: Response,
  secret: string,
  requestCookie?: string | null,
): Promise<Response> {
  const headerSigned = res.headers.get("set-auth-token");
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return res;
  const text = await res.text();
  try {
    const body = JSON.parse(text) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    if (!isSessionBody(body)) {
      return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    const raw = rawTokenFromBody(body);
    const cookieSigned = sessionTokenFromCookie(requestCookie);
    const signed = headerSigned && headerSigned.includes(".")
      ? headerSigned
      : cookieSigned && cookieSigned.includes(".")
        ? cookieSigned
        : raw && secret
          ? await signBearerToken(secret, raw)
          : headerSigned;
    if (!signed) {
      return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    rewriteTokenFields(body, signed);
    const headers = new Headers(res.headers);
    if (!headerSigned) headers.set("set-auth-token", signed);
    return new Response(JSON.stringify(body), {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch {
    return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
}

export class SessionLookupError extends Error {
  override name = "SessionLookupError";
  constructor(cause?: unknown) {
    super("session lookup failed");
    this.cause = cause;
  }
}

function errorStatus(err: unknown): number | string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const row = err as { status?: unknown; statusCode?: unknown };
  if (typeof row.statusCode === "number" || typeof row.statusCode === "string") return row.statusCode;
  if (typeof row.status === "number" || typeof row.status === "string") return row.status;
  return undefined;
}

export async function sessionUser(
  auth: AuthInstance,
  req: Request,
): Promise<{ id: string; email?: string | null; emailVerified: boolean } | null> {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified === true,
    };
  } catch (err) {
    const status = errorStatus(err);
    if (status === 401 || status === 403 || status === "UNAUTHORIZED" || status === "FORBIDDEN") {
      return null;
    }
    throw new SessionLookupError(err);
  }
}
