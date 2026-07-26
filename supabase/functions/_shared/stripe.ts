import Stripe from "npm:stripe@18";

export const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2026-05-27.dahlia",
});

/** Where Stripe should send someone back to after checkout / the portal.
 *
 *  A single APP_URL can't serve both a dev machine and production, so the
 *  client sends its own origin and we validate it here. Validation matters:
 *  an unchecked origin would let a crafted request point our checkout's
 *  return URL at any site. We accept localhost (any port, for dev) or the
 *  APP_URL host, and fall back to APP_URL for anything else — including the
 *  Tauri app, which deliberately sends nothing because its internal origin
 *  isn't reachable from the system browser. */
export function resolveReturnOrigin(requested?: unknown): string {
  const fallback = Deno.env.get("APP_URL") ?? "";
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

export type OurStatus = "trialing" | "active" | "past_due" | "cancelled";

// nuvo never sets `trial_period_days` on the Stripe subscription (trials are
// granted app-side, see handle_new_user), so Stripe's own "trialing" status
// should never occur for us — deliberately no case for it below.
export function stripeStatusToStatus(s: Stripe.Subscription.Status): OurStatus {
  switch (s) {
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return "past_due"; // conservative — never silently entitle
  }
}
