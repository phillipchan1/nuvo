/**
 * Minimal Stripe REST client for the Worker — exactly the calls the
 * Supabase billing functions make through `npm:stripe`, nothing more.
 *
 * No SDK: the Worker bundle stays small and every request is visible to the
 * check suite through an injected `fetch`. Same API version as
 * `supabase/functions/_shared/stripe.ts` so the two runtimes send Stripe
 * byte-for-byte the same parameters.
 *
 * Never log the secret key or a webhook secret.
 */

export const STRIPE_API_VERSION = "2026-05-27.dahlia";
const STRIPE_API = "https://api.stripe.com";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class StripeApiError extends Error {
  override name = "StripeApiError";
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Stripe form encoding: nested objects → `a[b][c]=`, arrays → `a[0][b]=` (or `a[]=` for scalars). */
export function encodeStripeForm(params: Record<string, unknown>): string {
  const out: string[] = [];
  const add = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (value === null) {
      out.push(`${encodeURIComponent(key)}=`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") add(`${key}[${i}]`, item);
        else add(`${key}[]`, item);
      });
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) add(`${key}[${k}]`, v);
      return;
    }
    out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out.join("&");
}

export interface StripeClient {
  get<T = Record<string, unknown>>(path: string, params?: Record<string, unknown>): Promise<T>;
  post<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, unknown>,
    opts?: { idempotencyKey?: string },
  ): Promise<T>;
}

export function stripeClient(secretKey: string, fetchImpl: FetchLike = fetch): StripeClient {
  const key = secretKey.trim();
  if (!key) throw new StripeApiError("Stripe is not configured", 503);
  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${key}`,
    "Stripe-Version": STRIPE_API_VERSION,
    ...extra,
  });

  async function read<T>(res: Response): Promise<T> {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    if (!res.ok) {
      throw new StripeApiError(body?.error?.message ?? `stripe ${res.status}`, res.status, body?.error?.code);
    }
    return body as T;
  }

  return {
    async get<T>(path: string, params: Record<string, unknown> = {}) {
      const qs = encodeStripeForm(params);
      const res = await fetchImpl(`${STRIPE_API}${path}${qs ? `?${qs}` : ""}`, {
        method: "GET",
        headers: headers(),
      });
      return read<T>(res);
    },
    async post<T>(path: string, params: Record<string, unknown> = {}, opts: { idempotencyKey?: string } = {}) {
      const extra: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
      if (opts.idempotencyKey) extra["Idempotency-Key"] = opts.idempotencyKey;
      const res = await fetchImpl(`${STRIPE_API}${path}`, {
        method: "POST",
        headers: headers(extra),
        body: encodeStripeForm(params),
      });
      return read<T>(res);
    },
  };
}

// ── Webhook signature (Stripe-Signature: t=…,v1=…) ──────────────────────────

/** Stripe's own default. A replayed body with an old `t` is refused. */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export class StripeSignatureError extends Error {
  override name = "StripeSignatureError";
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function stripeSignatureFor(payload: string, secret: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
}

/**
 * Same contract as `stripe.webhooks.constructEventAsync`: the raw body, the
 * header, the endpoint secret. Throws on any mismatch; returns the parsed event.
 */
export async function verifyStripeEvent<T = Record<string, unknown>>(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): Promise<T> {
  const whsec = secret?.trim() ?? "";
  if (!whsec) throw new StripeSignatureError("webhook secret not configured");
  if (!header) throw new StripeSignatureError("missing signature");
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") timestamp = Number(v);
    else if (k === "v1") signatures.push(v);
  }
  if (!Number.isFinite(timestamp)) throw new StripeSignatureError("no timestamp");
  if (!signatures.length) throw new StripeSignatureError("no v1 signature");
  const expected = await stripeSignatureFor(rawBody, whsec, timestamp);
  if (!signatures.some((s) => timingSafeEqual(s, expected))) {
    throw new StripeSignatureError("signature mismatch");
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new StripeSignatureError("timestamp outside tolerance");
  }
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new StripeSignatureError("body is not JSON");
  }
  if (!event || typeof event !== "object") throw new StripeSignatureError("body is not an event");
  return event as T;
}
