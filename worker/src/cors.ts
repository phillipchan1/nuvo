import { isLocalAuthHost, resolveAuthBaseURL } from "./authUrl.ts";
import type { Env } from "./env.ts";

export const API_SECURITY = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
};

export const OPEN_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cookie",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  ...API_SECURITY,
};

const AUTH_CORS_ALLOW = {
  "Access-Control-Allow-Headers":
    "authorization, content-type, cookie, x-nuvo-token, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Expose-Headers": "set-auth-token",
  Vary: "Origin",
} as const;

const LOCAL_CLIENT_ORIGINS = [
  "http://localhost:5717",
  "http://localhost:8787",
  "http://127.0.0.1:5717",
  "http://127.0.0.1:8787",
  "http://[::1]:5717",
  "http://[::1]:8787",
];

/** Browser + Tauri shells that call the Worker with credentials. */
export const CLIENT_ORIGINS = [
  "https://app.nuvo.day",
  "https://nuvo.day",
  "https://www.nuvo.day",
  "tauri://localhost",
  "https://tauri.localhost",
] as const;

export function trustedAuthOrigins(env: Env): string[] {
  const base = resolveAuthBaseURL(env);
  const app = env.APP_URL?.trim().replace(/\/+$/, "") ?? "";
  const extras = [...CLIENT_ORIGINS, ...(app ? [app] : [])];
  if (!isLocalAuthHost(base)) return [...new Set([base, ...extras])];
  return [...new Set([base, ...LOCAL_CLIENT_ORIGINS, ...extras])];
}

/** Credentialed CORS for /api/data, /api/rpc, and calendar/OAuth browser routes. */
export function apiCors(origin: string | null | undefined, env: Env): Record<string, string> {
  return authCors(origin, env);
}

const CREDENTIALED_CORS_PREFIXES = [
  "/api/data",
  "/api/rpc",
  "/api/google-oauth",
  "/api/google-events",
  "/api/calendar-refresh",
  "/api/m365-oauth",
  "/api/icloud-connect",
  "/api/icloud-events",
  "/api/ics-subscribe",
  "/api/auth",
  "/api/agent",
  "/api/mcp",
  "/api/capture",
  "/api/delete-account",
  "/api/apple-identity",
  "/api/task-mirror",
  "/api/slot-mirror",
  "/api/github-activity",
  "/api/route-events",
  "/api/rollover",
  "/api/day",
  "/functions/v1/google-oauth",
  "/functions/v1/google-events",
  "/functions/v1/calendar-refresh",
  "/functions/v1/m365-oauth",
  "/functions/v1/icloud-connect",
  "/functions/v1/icloud-events",
  "/functions/v1/ics-subscribe",
  "/functions/v1/agent",
  "/functions/v1/mcp",
  "/functions/v1/capture",
  "/functions/v1/delete-account",
  "/functions/v1/apple-identity",
  "/functions/v1/task-mirror",
  "/functions/v1/slot-mirror",
  "/functions/v1/github-activity",
  "/functions/v1/route-events",
  "/functions/v1/rollover",
  "/functions/v1/day",
  "/api/apple-iap",
  "/api/stripe-checkout",
  "/api/stripe-portal",
  "/api/referral-code",
  "/functions/v1/apple-iap",
  "/functions/v1/stripe-checkout",
  "/functions/v1/stripe-portal",
  "/functions/v1/referral-code",
];

/**
 * Billing (and other credentialed browser routes): reflect only when the
 * request Origin is on the allowlist. Unknown origins get no ACAO — Chrome
 * rejects `credentials: include` against `*` or a mismatched echo.
 */
export function reflectedCredentialedCors(
  origin: string | null | undefined,
  env: Env,
): Record<string, string> {
  const allowed = trustedAuthOrigins(env);
  if (origin && allowed.includes(origin)) return credentialedCors(origin);
  return { ...API_SECURITY, Vary: "Origin" };
}

export function needsCredentialedCors(path: string): boolean {
  return CREDENTIALED_CORS_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function credentialedCors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    ...AUTH_CORS_ALLOW,
    ...API_SECURITY,
  };
}

/** Credentialed auth: echo an allowlisted Origin. Never ACAO * + credentials. */
export function authCors(origin: string | null | undefined, env: Env): Record<string, string> {
  const allowed = trustedAuthOrigins(env);
  const echoed = origin && allowed.includes(origin) ? origin : allowed[0];
  return credentialedCors(echoed);
}

/**
 * Stamp the reflected origin LAST on a live Response.
 *
 * Hono 4.13 copies the previous `c.res` headers onto a newly assigned
 * Response (`headers.set` for every old key). A handler that sent
 * `Access-Control-Allow-Origin: *` therefore overwrites a reflected
 * origin unless this runs after that assignment. Always `Vary: Origin`.
 * Never leave `*` alongside `Access-Control-Allow-Credentials`.
 */
export function reflectAllowOrigin(res: Response, origin: string | null | undefined): void {
  res.headers.set("Vary", "Origin");
  if (origin && origin !== "*") {
    res.headers.set("Access-Control-Allow-Origin", origin);
  } else {
    res.headers.delete("Access-Control-Allow-Origin");
  }
  if (
    res.headers.get("Access-Control-Allow-Credentials") === "true" &&
    res.headers.get("Access-Control-Allow-Origin") === "*"
  ) {
    res.headers.delete("Access-Control-Allow-Origin");
  }
}

/** JSON 500 when auth config throws. Echo ACAO+credentials only for loopback Origins. */
export function authConfigErrorResponse(
  origin: string | null | undefined,
  err: unknown,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...API_SECURITY,
  };
  if (origin && isLocalAuthHost(origin)) {
    Object.assign(headers, credentialedCors(origin));
  }
  return new Response(JSON.stringify({ error: "internal error" }), { status: 500, headers });
}

export function beginAuthCors(
  origin: string | null | undefined,
  env: Env,
): { ok: true; cors: Record<string, string> } | { ok: false; response: Response } {
  try {
    return { ok: true, cors: authCors(origin, env) };
  } catch (err) {
    return { ok: false, response: authConfigErrorResponse(origin, err) };
  }
}

export function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...API_SECURITY, ...extra },
  });
}
