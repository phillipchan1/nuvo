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

/**
 * Non-Google calendar OAuth / sync / mirrors. Google routes are on this
 * Worker. These still need provider APIs (PR C) and stay 501.
 */
export const CALENDAR_FUNCTIONS = new Set([
  "icloud-connect",
  "icloud-contacts",
  "icloud-events",
  "icloud-sync",
  "ics-subscribe",
  "ics-sync",
  "m365-oauth",
  "m365-sync",
]);

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
