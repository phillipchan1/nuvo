/**
 * Where a Supabase-bound request goes when the Worker is the backend.
 *
 * Pure — no `import.meta.env` — so the Worker's own check suite can drive the
 * stock supabase-js builder through exactly this mapping (worker/src/rest.check.ts).
 *
 *  • `/rest/v1/*` (every `.from()` / `.rpc()`) → the Worker's PostgREST subset,
 *    which scopes each statement by the session (worker/src/rest.ts).
 *  • `/functions/v1/<name>` → the Worker's twin of that function. A name the
 *    Worker has not ported answers 501 `stay_on_supabase` there, rather than
 *    a Supabase 401 for a session GoTrue never issued.
 *  • Billing stays on Supabase: the Worker proxies it only once #120 lands.
 *  • Everything else (GoTrue, storage) is left alone — null.
 */

/** Billing / Stripe / StoreKit functions. Not rerouted here. */
export const SUPABASE_ONLY_FUNCTIONS: ReadonlySet<string> = new Set([
  "apple-iap",
  "apple-webhook",
  "iap-catalog",
  "referral-code",
  "stripe-checkout",
  "stripe-portal",
  "stripe-webhook",
]);

/**
 * @param url            the URL supabase-js is about to fetch
 * @param supabaseOrigin the client's configured Supabase URL
 * @param apiBase        the Worker's `/api` root (`authBaseUrl()`), e.g. `https://api.nuvo.day/api`
 */
export function workerRoute(url: string, supabaseOrigin: string, apiBase: string): string | null {
  if (!apiBase) return null;
  let target: URL;
  let origin: URL;
  try {
    target = new URL(url);
    origin = new URL(supabaseOrigin);
  } catch {
    return null;
  }
  if (target.origin !== origin.origin) return null;
  const api = apiBase.replace(/\/+$/, "");
  const path = target.pathname;
  if (path.startsWith("/rest/v1/")) {
    return `${api}/rest/v1/${path.slice("/rest/v1/".length)}${target.search}`;
  }
  const fn = /^\/functions\/v1\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  if (fn && !SUPABASE_ONLY_FUNCTIONS.has(fn[1])) {
    const workerOrigin = api.replace(/\/api$/, "");
    return `${workerOrigin}/functions/v1/${fn[1]}${target.search}`;
  }
  return null;
}
