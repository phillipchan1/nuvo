/**
 * User-authenticated billing stays on the Supabase edge functions.
 * After the flip the SPA has a Better Auth session, not a GoTrue JWT, so
 * those functions 401. This proxy verifies the BA session, then calls the
 * existing function server-to-server with the service-role key and the
 * verified user id in `X-Nuvo-Acting-User`.
 *
 * The client never supplies the user id. Stripe / StoreKit pricing,
 * product ids, and webhook signatures are unchanged.
 *
 * Entitlement writes stay on Supabase (`subscriptions` is exempt from
 * the freeze). The Worker entitlement read already SELECTs that table.
 */
import type { Context } from "hono";
import {
  ACTING_EMAIL_HEADER,
  ACTING_USER_HEADER,
} from "../../supabase/functions/_shared/actingUser.ts";
import { json, reflectedCredentialedCors } from "./cors.ts";
import { isUuid } from "./http.ts";
import type { AppEnv } from "./session.ts";

export function billingCors(c: Context<AppEnv>): Record<string, string> {
  try {
    return reflectedCredentialedCors(c.req.header("Origin"), c.env);
  } catch {
    return { Vary: "Origin" };
  }
}

export function withBillingCors(res: Response, cors: Record<string, string>): Response {
  const headers = new Headers();
  res.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith("access-control-")) return;
    headers.set(key, value);
  });
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const BILLING_PROXY_FUNCTIONS = [
  "apple-iap",
  "stripe-checkout",
  "stripe-portal",
  "referral-code",
] as const;

export type BillingProxyName = (typeof BILLING_PROXY_FUNCTIONS)[number];

export function isBillingProxyName(name: string): name is BillingProxyName {
  return (BILLING_PROXY_FUNCTIONS as readonly string[]).includes(name);
}

export function billingEdgeUrl(supabaseUrl: string, name: BillingProxyName): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${name}`;
}

type FetchFn = typeof fetch;
let testFetch: FetchFn | null = null;

export function installBillingProxyFetchForTests(fn?: FetchFn): () => void {
  testFetch = fn ?? null;
  return () => {
    testFetch = null;
  };
}

function outboundFetch(): FetchFn {
  return testFetch ?? fetch;
}

export function actingHeadersFor(user: { id: string; email?: string | null }): Headers {
  const headers = new Headers();
  headers.set(ACTING_USER_HEADER, user.id);
  const email = user.email?.trim();
  if (email) headers.set(ACTING_EMAIL_HEADER, email);
  return headers;
}

export async function proxyBillingFunction(
  c: Context<AppEnv>,
  name: BillingProxyName,
  user: { id: string; email?: string | null },
): Promise<Response> {
  const cors = billingCors(c);
  if (!isUuid(user.id)) {
    return json({ error: "unauthorized" }, 401, cors);
  }
  const base = c.env.SUPABASE_URL?.trim() ?? "";
  const key = c.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!base || !key) {
    return json({ error: "service unavailable" }, 503, cors);
  }

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("apikey", key);
  headers.set("Content-Type", c.req.header("content-type") || "application/json");
  headers.set(ACTING_USER_HEADER, user.id);
  const email = user.email?.trim();
  if (email) headers.set(ACTING_EMAIL_HEADER, email);

  const raw = await c.req.arrayBuffer();
  let res: Response;
  try {
    res = await outboundFetch()(billingEdgeUrl(base, name), {
      method: c.req.method === "HEAD" ? "GET" : c.req.method,
      headers,
      body: raw.byteLength ? raw : undefined,
    });
  } catch {
    return json({ error: "service unavailable" }, 503, cors);
  }

  const text = await res.text();
  const out = new Headers();
  for (const [key, value] of Object.entries(cors)) out.set(key, value);
  const contentType = res.headers.get("content-type");
  if (contentType) out.set("Content-Type", contentType);
  return new Response(text, { status: res.status, headers: out });
}
