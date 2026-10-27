/**
 * Delete-account Stripe gate. Billing I/O is `readEntitlement` — never a
 * Stripe secret, never the Stripe API, never a second PostgREST reader.
 */
import {
  isEntitled,
  stripeStatusToPlan,
  type EntitlementRow,
} from "../../../supabase/functions/_shared/planRules.ts";
import {
  EntitlementUnavailableError,
  readEntitlement,
  type Entitlement,
} from "../entitlement.ts";
import type { Env } from "../env.ts";

export type DeleteGateRow = {
  status?: string | null;
  plan?: string | null;
  plan_source?: string | null;
  trial_ends_at?: string | null;
  entitled?: boolean;
  present?: boolean;
};

export const ACTIVE_STRIPE_DELETE_MESSAGE =
  "Cancel your Stripe subscription in Settings → Billing first, then delete your account.";

const STRIPE_ENDED = new Set(["cancelled", "canceled", "incomplete_expired"]);
const STRIPE_STILL_BILLS = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

function asEntitlementRow(row: DeleteGateRow): EntitlementRow {
  return {
    status: (row.status ?? row.plan ?? null) as EntitlementRow["status"],
    trial_ends_at: row.trial_ends_at ?? null,
  };
}

function statusKeepsBilling(row: DeleteGateRow): boolean {
  if (isEntitled(asEntitlementRow(row))) return true;
  const raw = (row.status ?? row.plan ?? "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (STRIPE_ENDED.has(lower)) return false;
  if (STRIPE_STILL_BILLS.has(lower)) return true;
  return stripeStatusToPlan(raw) !== "cancelled";
}

/** Refuse wipe while a subscription would still bill. */
export function stripeSubscriptionBlocksDelete(
  row: DeleteGateRow | Entitlement | null | undefined,
): boolean {
  if (!row) return false;
  if ("present" in row && row.present === false) return false;
  return statusKeepsBilling(row);
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
    };
  } catch (err) {
    if (err instanceof EntitlementUnavailableError) throw new BillingLookupError();
    throw err;
  }
}
