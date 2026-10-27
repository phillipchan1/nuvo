// The one writer both billing rails call. Stripe's webhook and Apple's
// (StoreKit verify + App Store Server Notifications) must not update
// `subscriptions` ad hoc — they build a PlanWrite and hand it here.
import { isUuid } from "./actingUser.ts";
import { admin } from "./admin.ts";
import { defaultSubscriptionRow } from "./defaultSubscription.ts";
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

/** Default trial row. Idempotent — ON CONFLICT DO NOTHING. Used when a
 *  post-flip Better Auth user has no `handle_new_user` row yet. */
async function ensureDefaultRow(userId: string): Promise<void> {
  const { error } = await admin.from("subscriptions").upsert(defaultSubscriptionRow(userId), {
    onConflict: "user_id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

/** Apply a rail's verdict to the one entitlement row. Returns whether a row
 *  was found and updated. If we have a verified user id and no row (fresh
 *  post-flip signup), insert the default trial first, then patch. */
export async function applyPlanUpdate(
  incoming: PlanWrite & { userId?: string },
): Promise<{ applied: boolean; userId?: string }> {
  let existing = await findRow(incoming);
  if (!existing && incoming.userId && isUuid(incoming.userId)) {
    await ensureDefaultRow(incoming.userId);
    existing = await findRow(incoming);
  }
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
