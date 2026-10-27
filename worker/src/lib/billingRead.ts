/**
 * Delete-account Stripe gate. Billing I/O is `readEntitlement` — never a
 * Stripe secret, never the Stripe API, never a second PostgREST reader.
 *
 * Block only when plan_source = stripe AND status is active / past_due
 * AND a Stripe customer / period is visible on the readable columns.
 * Unknown stripe status fails closed. `unpaid` is not in the status CHECK
 * (trialing | active | past_due | cancelled) — if it appears it is unknown.
 */
import {
  APPLE_DELETE_NOTICE,
  STRIPE_DELETE_BLOCK_MESSAGE,
} from "../../../supabase/functions/_shared/accountDeletion.ts";
import {
  EntitlementUnavailableError,
  readEntitlement,
  type Entitlement,
} from "../entitlement.ts";
import type { Env } from "../env.ts";

export { APPLE_DELETE_NOTICE };

export type DeleteGateRow = {
  status?: string | null;
  plan?: string | null;
  plan_source?: string | null;
  planSource?: string | null;
  trial_ends_at?: string | null;
  entitled?: boolean;
  present?: boolean;
  stripe_customer_id?: string | null;
  stripeCustomerId?: string | null;
  hasStripeCustomer?: boolean;
  current_period_end?: string | null;
  currentPeriodEnd?: string | null;
  cancel_at_period_end?: boolean;
  cancelAtPeriodEnd?: boolean;
};

export const ACTIVE_STRIPE_DELETE_MESSAGE = STRIPE_DELETE_BLOCK_MESSAGE;

/** Physical CHECK on public.subscriptions.status (00000000000041_billing.sql). */
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled"] as const;

const STRIPE_ENDED = new Set(["cancelled", "canceled", "incomplete_expired"]);
const STRIPE_CHARGING = new Set(["active", "past_due"]);

export function billingPlanSource(
  row: DeleteGateRow | Entitlement | null | undefined,
): string {
  if (!row) return "";
  const asGate = row as DeleteGateRow & Partial<Entitlement>;
  return (asGate.plan_source ?? asGate.planSource ?? "").toString().trim().toLowerCase();
}

/** Stripe customer / period as far as the readable columns show. */
export function stripePaymentOnFile(
  row: DeleteGateRow | Entitlement | null | undefined,
): boolean {
  if (!row) return false;
  const asGate = row as DeleteGateRow & Partial<Entitlement>;
  if (asGate.hasStripeCustomer === true) return true;
  if (asGate.hasStripeCustomer === false) return false;
  const customer = (asGate.stripe_customer_id ?? asGate.stripeCustomerId ?? "").toString().trim();
  if (customer) return true;
  const period = (asGate.current_period_end ?? asGate.currentPeriodEnd ?? "").toString().trim();
  if (period) return true;
  if (asGate.cancel_at_period_end === true || asGate.cancelAtPeriodEnd === true) return true;
  if (
    "stripe_customer_id" in asGate ||
    "stripeCustomerId" in asGate ||
    "hasStripeCustomer" in asGate ||
    "current_period_end" in asGate ||
    "currentPeriodEnd" in asGate
  ) {
    return false;
  }
  // plan_source=stripe is set only with a Stripe customer or subscription
  // id (00000000000075). That is the remaining readable signal.
  return billingPlanSource(asGate) === "stripe";
}

/** Refuse wipe only for Stripe + charging status + customer/period on file.
 *  Unknown stripe status fails closed even without a visible customer. */
export function stripeSubscriptionBlocksDelete(
  row: DeleteGateRow | Entitlement | null | undefined,
): boolean {
  if (!row) return false;
  if ("present" in row && row.present === false) return false;
  if (billingPlanSource(row) !== "stripe") return false;
  const status = (row.status ?? row.plan ?? "").toString().trim().toLowerCase();
  if (!status) return true;
  if (STRIPE_ENDED.has(status)) return false;
  if (status === "trialing") return false;
  if (STRIPE_CHARGING.has(status)) return stripePaymentOnFile(row);
  return true;
}

export class BillingLookupError extends Error {
  override name = "BillingLookupError";
  constructor() {
    super("billing lookup failed");
  }
}

export async function readBillingSubscription(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
  userId: string,
): Promise<DeleteGateRow | null> {
  try {
    const entitlement = await readEntitlement(env, userId);
    if (!entitlement.present) return null;
    return {
      status: entitlement.status,
      plan: entitlement.plan,
      plan_source: entitlement.planSource,
      trial_ends_at: entitlement.trialEndsAt,
      entitled: entitlement.entitled,
      present: entitlement.present,
      current_period_end: entitlement.currentPeriodEnd,
      cancel_at_period_end: entitlement.cancelAtPeriodEnd,
    };
  } catch (err) {
    if (err instanceof EntitlementUnavailableError) throw new BillingLookupError();
    throw err;
  }
}
