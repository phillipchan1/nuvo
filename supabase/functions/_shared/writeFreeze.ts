/**
 * Copy-window write freeze for non-billing edge functions.
 *
 * Set the Supabase secret `WRITE_FREEZE=1` (or `MAINTENANCE_WRITE_FREEZE=1`)
 * before the dump. Any non-empty value other than 0/false/no/off freezes
 * (fail-closed; unset/empty stays open). Every mutating request then 503s.
 * Billing webhooks
 * (stripe-webhook, apple-webhook, checkout, portal, IAP, referral-code)
 * do not import this — they keep writing subscriptions / sync_log /
 * push_subscriptions on Supabase.
 *
 * OPTIONS always passes. Capture GET is a poll — pass `{ allowReads: true }`.
 */
export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";

/** Explicit off. Unset/empty is also off; any other non-empty value freezes. */
const EXPLICIT_OFF = new Set(["0", "false", "no", "off"]);

const FREEZE_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function writeFreezeOn(raw: string | undefined | null): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return false;
  return !EXPLICIT_OFF.has(v);
}

export type EnvGet = (name: string) => string | undefined;

export function defaultWriteFreezeEnvGet(name: string): string | undefined {
  try {
    const deno = (globalThis as { Deno?: { env?: { get?: (n: string) => string | undefined } } }).Deno;
    const fromDeno = deno?.env?.get?.(name);
    if (fromDeno != null && fromDeno !== "") return fromDeno;
  } catch {
    /* vitest / Node */
  }
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return proc?.env?.[name];
  } catch {
    return undefined;
  }
}

/** True when WRITE_FREEZE or MAINTENANCE_WRITE_FREEZE is on. */
export function readWriteFreezeFlag(getEnv: EnvGet = defaultWriteFreezeEnvGet): boolean {
  return writeFreezeOn(getEnv("WRITE_FREEZE")) || writeFreezeOn(getEnv("MAINTENANCE_WRITE_FREEZE"));
}

export type FrozenWriteOptions = {
  /** GET/HEAD pass through (capture poll). Default freezes every non-OPTIONS. */
  allowReads?: boolean;
  getEnv?: EnvGet;
  headers?: Record<string, string>;
};

export function refuseFrozenWrite(
  req: { method: string },
  opts: FrozenWriteOptions = {},
): Response | null {
  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") return null;
  if (opts.allowReads && (method === "GET" || method === "HEAD")) return null;
  if (!readWriteFreezeFlag(opts.getEnv)) return null;
  return new Response(JSON.stringify({ error: WRITE_FROZEN_MESSAGE, write_freeze: true }), {
    status: 503,
    headers: { ...FREEZE_HEADERS, ...(opts.headers ?? {}) },
  });
}
