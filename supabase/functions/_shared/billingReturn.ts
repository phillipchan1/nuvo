// Where Stripe sends someone back after Checkout / the Billing Portal.
// Pure, zero imports — the Supabase edge functions (via stripe.ts) and the
// Worker (worker/src/billing) both call this one definition.
//
// A single APP_URL can't serve both a dev machine and production, so the
// client sends its own origin and we validate it here. Validation matters:
// an unchecked origin would let a crafted request point our checkout's
// return URL at any site. We accept localhost (any port, for dev) or the
// APP_URL host, and fall back to APP_URL for anything else — including the
// Tauri app, which deliberately sends nothing because its internal origin
// isn't reachable from the system browser.
export function resolveReturnOriginFrom(requested: unknown, appUrl: string | undefined | null): string {
  const fallback = appUrl ?? "";
  if (typeof requested !== "string" || !requested) return fallback;
  try {
    const url = new URL(requested);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const appHost = fallback ? new URL(fallback).hostname : null;
    if (isLocal || (appHost && url.hostname === appHost)) return url.origin;
  } catch {
    /* not a URL — fall through */
  }
  return fallback;
}
