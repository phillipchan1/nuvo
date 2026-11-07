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
 *  • Billing too: `stripe-checkout`, `stripe-portal`, `apple-iap`,
 *    `referral-code` and `iap-catalog` have Worker twins (worker/src/billing),
 *    which answer 503 `stay_on_supabase` until the cutover flip.
 *  • Everything else (GoTrue, storage) is left alone — null.
 */

/**
 * Functions never rerouted to the Worker. Empty since billing was ported:
 * with the flag on the session is Better Auth's, which a Supabase function
 * cannot verify, so a billing call left here could only ever 401. The
 * webhooks (`stripe-webhook`, `apple-webhook`) are server-to-server and never
 * pass through this client at all.
 */
export const SUPABASE_ONLY_FUNCTIONS: ReadonlySet<string> = new Set<string>([]);

/** The billing functions the SPA invokes — each has a Worker twin. */
export const BILLING_CLIENT_FUNCTIONS: readonly string[] = [
  "apple-iap",
  "iap-catalog",
  "referral-code",
  "stripe-checkout",
  "stripe-portal",
];

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
