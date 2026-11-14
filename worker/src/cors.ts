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
    "authorization, content-type, cookie, x-nuvo-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Expose-Headers": "set-auth-token",
  Vary: "Origin",
} as const;

/**
 * The shells that call /api/auth with credentials (blocker 9b). The auth
 * origin itself (BETTER_AUTH_URL) is only where the Worker lives; the SPA
 * runs elsewhere:
 *   - the PWA at app.nuvo.day (Worker `nuvo-app`, wrangler.app.jsonc)
 *   - the Mac and iOS apps at `tauri://localhost` (Tauri v2's WKWebView
 *     scheme on both; `http://tauri.localhost` is Windows/Android only,
 *     which Nuvo doesn't ship)
 *   - Phil's workers.dev previews: the SPA preview, the API preview (which
 *     also serves the SPA) and nuvo-app's per-version preview URLs. Every
 *     host under `nq-morning-briefing.workers.dev` belongs to this account,
 *     so trusting them is trusting our own deploys.
 * Patterns use Better Auth's `trustedOrigins` grammar (a `*` inside a
 * single host label) so one list feeds both CORS and Better Auth's own
 * origin check — they cannot disagree.
 */
export const APP_ORIGINS = [
  "https://app.nuvo.day",
  "tauri://localhost",
] as const;

const WORKERS_DEV = "nq-morning-briefing.workers.dev";
export const PREVIEW_ORIGINS = [
  `https://nuvo-app.${WORKERS_DEV}`,
  `https://nuvo-app-preview.${WORKERS_DEV}`,
  `https://nuvo-preview.${WORKERS_DEV}`,
  `https://*-nuvo-app.${WORKERS_DEV}`,
  `https://*-nuvo-app-preview.${WORKERS_DEV}`,
] as const;

// Local runtime only (the auth origin itself is loopback). Any port: a dev
// server that drifts off 5717 (vite's autoPort) must still sign in.
const LOOPBACK_ORIGINS = [
  "http://localhost:*",
  "http://127.0.0.1:*",
  "http://[::1]:*",
] as const;

function appUrlOrigin(env: Env): string | null {
  const raw = env.APP_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** First entry is the auth origin itself (the CORS fallback echo). */
export function trustedAuthOrigins(env: Env): string[] {
  const base = resolveAuthBaseURL(env);
  const app = appUrlOrigin(env);
  return [...new Set([
    base,
    ...(app ? [app] : []),
    ...APP_ORIGINS,
    ...PREVIEW_ORIGINS,
    ...(isLocalAuthHost(base) ? LOOPBACK_ORIGINS : []),
  ])];
}

/**
 * Exact match; a leading `*` inside the first host label
 * (`https://*-nuvo-app.<acct>.workers.dev`, `[a-z0-9-]+`, never a dot, so it
 * cannot climb to another host); or a `:*` port on a fixed host (loopback).
 */
export function originMatches(origin: string, pattern: string): boolean {
  if (!pattern.includes("*")) return origin === pattern;
  // `http://localhost:*` — any port, digits only.
  const port = /^(https?:\/\/[^*/]+):\*$/.exec(pattern);
  if (port) {
    const prefix = `${port[1]}:`;
    return origin.startsWith(prefix) && /^\d{1,5}$/.test(origin.slice(prefix.length));
  }
  const m = /^(https?:\/\/)\*([^*/]+)$/.exec(pattern);
  if (!m) return false;
  const [, scheme, rest] = m;
  if (!origin.startsWith(scheme!) || !origin.endsWith(rest!)) return false;
  const label = origin.slice(scheme!.length, origin.length - rest!.length);
  return /^[a-z0-9-]+$/.test(label);
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
  const echoed = origin && allowed.some((p) => originMatches(origin, p)) ? origin : allowed[0]!;
  return credentialedCors(echoed);
}

export const CREDENTIALED_API_ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, accept, cookie, x-region, x-nuvo-token";
export const CREDENTIALED_API_ALLOW_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

/** The auth routes' allowlist, but no fallback echo: an unknown Origin gets null. */
export function allowedApiOrigin(origin: string | null | undefined, env: Env): string | null {
  if (!origin) return null;
  return trustedAuthOrigins(env).some((p) => originMatches(origin, p)) ? origin : null;
}

/**
 * Credentialed API routes (entitlement, agent). ACAO + credentials only for an
 * allowlisted Origin; otherwise no ACAO at all. Never ACAO *.
 */
export function credentialedApiCors(origin: string | null | undefined, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Headers": CREDENTIALED_API_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": CREDENTIALED_API_ALLOW_METHODS,
    "Access-Control-Max-Age": "600",
    ...API_SECURITY,
  };
  const allowed = allowedApiOrigin(origin, env);
  if (allowed) {
    headers["Access-Control-Allow-Origin"] = allowed;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
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
