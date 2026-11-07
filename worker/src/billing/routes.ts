/**
 * Billing routes on the Worker. Each name is served at both
 * `/functions/v1/<name>` (where the SPA's supabase-js `functions.invoke`
 * lands via `src/lib/workerRoute.ts`) and `/api/<name>` (the URL the Stripe
 * and App Store dashboards point at after the flip).
 *
 * Inert until `CUTOVER_FLIPPED`: before the flip Supabase owns every billing
 * write, and the Worker answers 503 — never 200 — so a webhook that reaches
 * it early is retried by Stripe / Apple instead of being acknowledged and
 * lost. That is what keeps both runtimes from processing the same event.
 * `iap-catalog` is static product ids (no secrets, no writes) and is served
 * on both sides of the flip.
 */
import type { Context, Hono } from "hono";
import { OPEN_CORS, json, trustedAuthOrigins } from "../cors.ts";
import { cutoverFlipped, CUTOVER_NOT_FLIPPED } from "../cutoverFlip.ts";
import { SessionLookupError, sessionUser } from "../auth.ts";
import type { AppEnv } from "../session.ts";
import { requestIo } from "../session.ts";
import type { RequestIo } from "../requestIo.ts";
import type { AppleJwsOptions } from "./appleJws.ts";
import {
  handleAppleIap,
  handleAppleWebhook,
  handleCheckout,
  handleIapCatalog,
  handlePortal,
  handleReferralCode,
  handleStripeWebhook,
  type BillingDeps,
  type BillingUser,
} from "./handlers.ts";
import { StripeApiError, type FetchLike } from "./stripeApi.ts";

export const BILLING_USER_ROUTES = ["stripe-checkout", "stripe-portal", "apple-iap", "referral-code"] as const;
export const BILLING_WEBHOOK_ROUTES = ["stripe-webhook", "apple-webhook"] as const;
export const BILLING_ROUTE_NAMES = [...BILLING_USER_ROUTES, ...BILLING_WEBHOOK_ROUTES, "iap-catalog"] as const;

let testFetch: FetchLike | undefined;
let testJws: AppleJwsOptions | undefined;
let testNow: number | undefined;

/** Test-only: mock Stripe / Resend / push, pin a generated Apple root, fix the clock. */
export function installBillingForTests(opts: { fetch?: FetchLike; appleJws?: AppleJwsOptions; nowSeconds?: number }): () => void {
  testFetch = opts.fetch;
  testJws = opts.appleJws;
  testNow = opts.nowSeconds;
  return () => {
    testFetch = undefined;
    testJws = undefined;
    testNow = undefined;
  };
}

export function billingNotFlipped(name: string, webhook: boolean): Response {
  const body = {
    error: `${name} runs on Supabase until the cutover flip`,
    reason: CUTOVER_NOT_FLIPPED,
    stay_on_supabase: true,
  };
  // 503 + Retry-After: the provider retries; nothing is acknowledged here.
  return webhook
    ? new Response(JSON.stringify(body), {
        status: 503,
        headers: { "Content-Type": "application/json", "Retry-After": "300" },
      })
    : json(body, 503, { ...OPEN_CORS, "Retry-After": "300" });
}

function deps(c: Context<AppEnv>, io: RequestIo): BillingDeps {
  return { sql: io.sql, env: c.env, fetchImpl: testFetch, appleJws: testJws, nowSeconds: testNow };
}

async function sessionFor(c: Context<AppEnv>): Promise<{ user: BillingUser; io: RequestIo } | { error: Response }> {
  const io = await requestIo(c);
  try {
    const user = await sessionUser(io.auth, c.req.raw);
    if (!user) return { error: json({ error: "unauthorized" }, 401, OPEN_CORS) };
    return { user: { id: user.id, email: user.email ?? null }, io };
  } catch (err) {
    if (err instanceof SessionLookupError) return { error: json({ error: "service unavailable" }, 503, OPEN_CORS) };
    throw err;
  }
}

/**
 * Bearer callers (today's supabase-js path, Tauri) work with `*`. A browser
 * call with `credentials: "include"` (PR #120's `invokeBilling`) needs its
 * allowlisted Origin echoed instead — `*` + credentials is rejected. When
 * #120 lands, swap this for its `reflectedCredentialedCors`.
 */
export function billingCors(origin: string | null | undefined, env: AppEnv["Bindings"]): Record<string, string> {
  const allowed = new Set<string>();
  try {
    for (const o of trustedAuthOrigins(env)) allowed.add(o);
  } catch {
    /* auth URL unset — fall back to APP_URL only */
  }
  try {
    if (env.APP_URL) allowed.add(new URL(env.APP_URL).origin);
  } catch {
    /* not a URL */
  }
  if (origin && allowed.has(origin)) {
    return {
      ...OPEN_CORS,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    };
  }
  return { ...OPEN_CORS, Vary: "Origin" };
}

function withCors(res: Response, cors: Record<string, string> = OPEN_CORS): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

async function userRoute(
  c: Context<AppEnv>,
  name: (typeof BILLING_USER_ROUTES)[number],
): Promise<Response> {
  const cors = billingCors(c.req.header("Origin"), c.env);
  if (!cutoverFlipped(c.env?.CUTOVER_FLIPPED)) return withCors(billingNotFlipped(name, false), cors);
  if (c.req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);
  const got = await sessionFor(c);
  if ("error" in got) return withCors(got.error, cors);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const d = deps(c, got.io);
  try {
    const res = name === "stripe-checkout"
      ? await handleCheckout(d, got.user, body)
      : name === "stripe-portal"
        ? await handlePortal(d, got.user, body)
        : name === "apple-iap"
          ? await handleAppleIap(d, got.user, body)
          : await handleReferralCode(d, got.user);
    return withCors(res, cors);
  } catch (e) {
    if (e instanceof StripeApiError) {
      // Same as Supabase: the Stripe message reaches the caller; never a key.
      return json({ error: e.message }, e.status === 503 ? 503 : 500, cors);
    }
    throw e;
  }
}

async function webhookRoute(c: Context<AppEnv>, name: (typeof BILLING_WEBHOOK_ROUTES)[number]): Promise<Response> {
  if (!cutoverFlipped(c.env?.CUTOVER_FLIPPED)) return billingNotFlipped(name, true);
  if (c.req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const io = await requestIo(c);
  const d = deps(c, io);
  return name === "stripe-webhook" ? handleStripeWebhook(d, c.req.raw) : handleAppleWebhook(d, c.req.raw);
}

export function registerBillingRoutes(app: Hono<AppEnv>): void {
  for (const prefix of ["/api", "/functions/v1"] as const) {
    for (const name of BILLING_USER_ROUTES) {
      app.options(`${prefix}/${name}`, (c) => new Response("ok", { headers: billingCors(c.req.header("Origin"), c.env) }));
      app.all(`${prefix}/${name}`, (c) => userRoute(c, name));
    }
    for (const name of BILLING_WEBHOOK_ROUTES) {
      app.all(`${prefix}/${name}`, (c) => webhookRoute(c, name));
    }
    app.options(`${prefix}/iap-catalog`, () => new Response("ok", { headers: OPEN_CORS }));
    app.all(`${prefix}/iap-catalog`, (c) => withCors(handleIapCatalog(c.env)));
  }
}
