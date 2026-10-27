import { OPEN_CORS, json } from "./cors.ts";

/** Billing / Stripe / StoreKit — do not port. */
export const BILLING_FUNCTIONS = new Set([
  "apple-iap",
  "apple-webhook",
  "iap-catalog",
  "referral-code",
  "stripe-checkout",
  "stripe-portal",
  "stripe-webhook",
]);

/** Calendar routes ported in PRs B/C. Empty — names stay 501 only if re-added. */
export const CALENDAR_FUNCTIONS = new Set<string>([]);

/** User-data jobs that need Vault / GoTrue — flagged, not ported. */
export const BLOCKED_USERDATA_FUNCTIONS = new Set([
  "apple-identity",
  "delete-account",
]);

export const BLOCKED_CRON_JOBS = new Set<string>([]);

export function stayOnSupabase(name: string, extra?: Record<string, unknown>): Response {
  return json(
    {
      error: `${name} is not ported to the Worker yet`,
      stay_on_supabase: true,
      ...extra,
    },
    501,
    OPEN_CORS,
  );
}

export function classifyBlocked(name: string): "billing" | "calendar" | "userdata" | "cron" | null {
  if (BILLING_FUNCTIONS.has(name)) return "billing";
  if (CALENDAR_FUNCTIONS.has(name)) return "calendar";
  if (BLOCKED_USERDATA_FUNCTIONS.has(name)) return "userdata";
  if (BLOCKED_CRON_JOBS.has(name)) return "cron";
  return null;
}
