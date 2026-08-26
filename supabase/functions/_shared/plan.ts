// The one writer both billing rails call. Stripe's webhook and Apple's
// (StoreKit verify + App Store Server Notifications) must not update
// `subscriptions` ad hoc — they build a PlanWrite and hand it here.
import { admin } from "./admin.ts";
import {
  planOf,
  planRowPatch,
  type PlanSource,
  type PlanState,
  type PlanWrite,
} from "./planRules.ts";

export type { PlanSource, PlanState, PlanWrite };

type SubLookup = {
  user_id: string;
  status: PlanState;
  plan_source: PlanSource | null;
};

async function findRow(incoming: PlanWrite & { userId?: string }): Promise<SubLookup | null> {
  if (incoming.userId) {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id, status, plan_source")
      .eq("user_id", incoming.userId)
      .maybeSingle();
    if (data) return data as SubLookup;
  }
  if (incoming.appleOriginalTransactionId) {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id, status, plan_source")
      .eq("apple_original_transaction_id", incoming.appleOriginalTransactionId)
      .maybeSingle();
    if (data) return data as SubLookup;
  }
  if (incoming.stripeCustomerId) {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id, status, plan_source")
      .eq("stripe_customer_id", incoming.stripeCustomerId)
      .maybeSingle();
    if (data) return data as SubLookup;
  }
  if (incoming.stripeSubscriptionId) {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id, status, plan_source")
      .eq("stripe_subscription_id", incoming.stripeSubscriptionId)
      .maybeSingle();
    if (data) return data as SubLookup;
  }
  return null;
}

/** Apply a rail's verdict to the one entitlement row. Returns whether a row
 *  was found and updated. Caller logs; this does not invent a row — trials
 *  are created by `handle_new_user`, never by a webhook. */
export async function applyPlanUpdate(
  incoming: PlanWrite & { userId?: string },
): Promise<{ applied: boolean; userId?: string }> {
  const existing = await findRow(incoming);
  if (!existing) return { applied: false };

  const patch = planRowPatch(
    { plan: planOf(existing) ?? existing.status, planSource: existing.plan_source },
    incoming,
  );
  if (Object.keys(patch).length === 0) return { applied: true, userId: existing.user_id };

  const { error } = await admin.from("subscriptions").update(patch).eq("user_id", existing.user_id);
  if (error) throw error;
  return { applied: true, userId: existing.user_id };
}
