/**
 * Read-only Stripe-status check for delete-account.
 *
 * Billing rows stay on Supabase. The Worker never holds a Stripe secret and
 * never calls the Stripe API — it SELECTs `subscriptions` (or a test double)
 * and refuses the wipe while a Stripe subscription would still bill.
 */
import {
  isEntitled,
  stripeStatusToPlan,
  type EntitlementRow,
} from "../../../supabase/functions/_shared/planRules.ts";
import type { Env } from "../env.ts";

export type SubscriptionRead = {
  status?: string | null;
  plan?: string | null;
  plan_source?: string | null;
  stripe_subscription_id?: string | null;
  trial_ends_at?: string | null;
};

export const ACTIVE_STRIPE_DELETE_MESSAGE =
  "Cancel your Stripe subscription in Settings → Billing first, then delete your account.";

const STRIPE_ENDED = new Set(["cancelled", "canceled", "incomplete_expired"]);
const STRIPE_STILL_BILLS = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

function stripePlanKeepsBilling(row: SubscriptionRead): boolean {
  if (isEntitled(row as EntitlementRow)) return true;
  const raw = (row.plan ?? row.status ?? "").trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  if (STRIPE_ENDED.has(lower)) return false;
  if (STRIPE_STILL_BILLS.has(lower)) return true;
  return stripeStatusToPlan(raw) !== "cancelled";
}

/** A Stripe subscription we must not orphan. Apple-only rows (no Stripe id) do not block. */
export function stripeSubscriptionBlocksDelete(
  row: SubscriptionRead | null | undefined,
): boolean {
  if (!row) return false;
  const stripeId = typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id.trim() : "";
  if (!stripeId) return false;
  return stripePlanKeepsBilling(row);
}

export type BillingReader = (
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
  userId: string,
) => Promise<SubscriptionRead | null>;

async function readSupabaseSubscription(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
  userId: string,
): Promise<SubscriptionRead | null> {
  const base = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  // Fail closed: an unset reader would let an active Stripe sub be wiped.
  if (!base || !key) throw new BillingLookupError();
  const url = new URL(`${base.replace(/\/+$/, "")}/rest/v1/subscriptions`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("select", "status,plan_source,stripe_subscription_id,trial_ends_at");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      Prefer: "count=none",
    },
  });
  if (!res.ok) {
    throw new BillingLookupError();
  }
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  if (!row || typeof row !== "object") return null;
  return row as SubscriptionRead;
}

export class BillingLookupError extends Error {
  override name = "BillingLookupError";
  constructor() {
    super("billing lookup failed");
  }
}

let reader: BillingReader = readSupabaseSubscription;

export function readBillingSubscription(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
  userId: string,
): Promise<SubscriptionRead | null> {
  return reader(env, userId);
}

/** Test-only. Not an I/O cache. */
export function installBillingReaderForTests(fn: BillingReader | null): () => void {
  reader = fn ?? readSupabaseSubscription;
  return () => {
    reader = readSupabaseSubscription;
  };
}
