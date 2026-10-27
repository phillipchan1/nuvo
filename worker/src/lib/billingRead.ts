/**
 * Delete-account Stripe gate. Billing I/O is `readEntitlement` — never a
 * Stripe secret, never the Stripe API, never a second PostgREST reader.
 *
 * Block only a Stripe row that would keep charging: `plan_source = stripe`
 * and status `active` / `past_due` / unrecognized (fail closed).
 * `subscriptions.status` CHECK allows trialing | active | past_due | cancelled.
 */
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

/** Physical CHECK on public.subscriptions.status (00000000000041_billing.sql). */
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled"] as const;

const STRIPE_ENDED = new Set(["cancelled", "canceled", "incomplete_expired"]);
const STRIPE_BLOCKS = new Set(["active", "past_due"]);

/** Refuse wipe only for a Stripe sub that is active, past_due, or unknown. */
export function stripeSubscriptionBlocksDelete(
  row: DeleteGateRow | Entitlement | null | undefined,
): boolean {
  if (!row) return false;
  if ("present" in row && row.present === false) return false;
  const asGate = row as DeleteGateRow & Partial<Entitlement>;
  const source = (asGate.plan_source ?? asGate.planSource ?? "")
    .toString()
    .trim()
    .toLowerCase();
  if (source !== "stripe") return false;
  const status = (row.status ?? row.plan ?? "").toString().trim().toLowerCase();
  if (!status) return true;
  if (STRIPE_ENDED.has(status)) return false;
  if (STRIPE_BLOCKS.has(status)) return true;
  if (status === "trialing") return false;
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
    };
  } catch (err) {
    if (err instanceof EntitlementUnavailableError) throw new BillingLookupError();
    throw err;
  }
}
