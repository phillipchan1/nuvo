// One subscription, two payment rails — the rules both runtimes import.
//
// Stripe Checkout (web) and StoreKit (iOS App Store binary) both write the
// same `subscriptions` row: `plan` (trialing | active | cancelled | past_due)
// + `plan_source` (stripe | apple). Entitlement is one function. A second
// `isEntitled` anywhere is a bug — `tests/plan-rules.test.ts` fails on it.
//
// Constraints (same as planningRules.ts):
//   1 · ZERO imports.
//   2 · Pure. No Deno, no window, no I/O.
//   3 · Lives under `_shared/` so the edge bundler and Vite both import it.

export type PlanState = "trialing" | "active" | "cancelled" | "past_due";
export type PlanSource = "stripe" | "apple";

/** What `isEntitled` needs. `status` is the physical column; `plan` is the
 *  public name (computed alias of `status`). Either is enough. */
export interface EntitlementRow {
  plan?: PlanState | null;
  status?: PlanState | null;
  trialEndsAt?: string | null;
  trial_ends_at?: string | null;
}

/**
 * THE entitlement function. Source does not matter: an Apple-active row and
 * a Stripe-active row are the same yes. `past_due` is not entitled — the
 * paywall's recovery UI (portal on web, StoreKit manage on iOS) is the path
 * back. Matches `public.entitled(subscriptions)` / `public.is_entitled`.
 */
export function isEntitled(row: EntitlementRow | null | undefined, now: Date = new Date()): boolean {
  if (!row) return false;
  const plan = row.plan ?? row.status ?? null;
  if (plan === "active") return true;
  if (plan === "trialing") {
    const ends = row.trialEndsAt ?? row.trial_ends_at;
    return Boolean(ends && new Date(ends).getTime() > now.getTime());
  }
  return false;
}

export function planOf(row: { plan?: PlanState | null; status?: PlanState | null } | null | undefined): PlanState | null {
  if (!row) return null;
  return row.plan ?? row.status ?? null;
}

/** Stripe subscription.status → our plan. Trials are granted app-side, so
 *  Stripe's own "trialing" is treated conservatively (not entitled). */
export function stripeStatusToPlan(status: string): PlanState {
  switch (status) {
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
      return "past_due";
  }
}

/**
 * App Store Server Notification V2 `notificationType` (+ optional subtype)
 * → plan. Unknown types return null so the webhook can ack without writing.
 *
 * Grace period still has access (Apple's rule) → `active`. Billing retry
 * without grace → `past_due`. Expired / refund / revoke → `cancelled`.
 */
export function appleNotificationToPlan(
  notificationType: string,
  subtype?: string | null,
): { plan: PlanState; cancelAtPeriodEnd: boolean } | null {
  const type = notificationType.toUpperCase();
  const sub = (subtype ?? "").toUpperCase();
  switch (type) {
    case "SUBSCRIBED":
    case "DID_RENEW":
    case "OFFER_REDEEMED":
    case "DID_CHANGE_RENEWAL_PREF":
    case "RENEWAL_EXTENDED":
    case "REFUND_REVERSED":
      return { plan: "active", cancelAtPeriodEnd: false };
    case "DID_CHANGE_RENEWAL_STATUS":
      return { plan: "active", cancelAtPeriodEnd: sub === "AUTO_RENEW_DISABLED" };
    case "DID_FAIL_TO_RENEW":
      if (sub === "GRACE_PERIOD") return { plan: "active", cancelAtPeriodEnd: false };
      return { plan: "past_due", cancelAtPeriodEnd: false };
    case "EXPIRED":
    case "GRACE_PERIOD_EXPIRED":
    case "REFUND":
    case "REVOKE":
      return { plan: "cancelled", cancelAtPeriodEnd: false };
    default:
      return null;
  }
}

export interface PlanWrite {
  plan: PlanState;
  planSource: PlanSource;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  priceId?: string | null;
  appleOriginalTransactionId?: string | null;
  appleProductId?: string | null;
}

export interface ExistingPlan {
  plan: PlanState;
  planSource: PlanSource | null;
}

/**
 * Don't let the unused rail lock someone out. An active Stripe row stays
 * active if Apple later says expired; a new purchase on either rail can
 * take over a trial / cancelled / past_due row, or replace the other rail
 * when it is itself active.
 */
export function shouldWritePlan(existing: ExistingPlan | null, incoming: Pick<PlanWrite, "plan" | "planSource">): boolean {
  if (!existing) return true;
  if (!existing.planSource || existing.planSource === incoming.planSource) return true;
  if (incoming.plan === "active") return true;
  if (existing.plan !== "active") return true;
  return false;
}

/** Patch for the `subscriptions` row. Writers always persist the incoming
 *  rail's identifiers; `status` (the physical plan column) only changes when
 *  `shouldWritePlan` says so. Surfaces read `plan` (computed) + `plan_source`. */
export function planRowPatch(
  existing: ExistingPlan | null,
  incoming: PlanWrite,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (shouldWritePlan(existing, incoming)) {
    patch.status = incoming.plan;
    patch.plan_source = incoming.planSource;
    if (incoming.currentPeriodEnd !== undefined) patch.current_period_end = incoming.currentPeriodEnd;
    if (incoming.cancelAtPeriodEnd !== undefined) patch.cancel_at_period_end = incoming.cancelAtPeriodEnd;
  }
  if (incoming.stripeCustomerId !== undefined) patch.stripe_customer_id = incoming.stripeCustomerId;
  if (incoming.stripeSubscriptionId !== undefined) patch.stripe_subscription_id = incoming.stripeSubscriptionId;
  if (incoming.priceId !== undefined) patch.price_id = incoming.priceId;
  if (incoming.appleOriginalTransactionId !== undefined) {
    patch.apple_original_transaction_id = incoming.appleOriginalTransactionId;
  }
  if (incoming.appleProductId !== undefined) patch.apple_product_id = incoming.appleProductId;
  return patch;
}

/** StoreKit Product ID strings — confirmed in App Store Connect. The 6804…
 *  values are Apple internal IDs only; never pass those to product(). */
export const IAP_PRODUCT_MONTHLY = "NUVO_IAP_MONTHLY";
export const IAP_PRODUCT_ANNUAL = "NUVO_IAP_ANNUAL";

function storeKitProductId(raw: string | undefined, fallback: string): string {
  const v = raw?.trim();
  if (!v || /^\d+$/.test(v)) return fallback;
  return v;
}

export function configuredIapProductIds(env: {
  NUVO_IAP_MONTHLY?: string;
  NUVO_IAP_ANNUAL?: string;
}): { monthly: string; annual: string } {
  return {
    monthly: storeKitProductId(env.NUVO_IAP_MONTHLY, IAP_PRODUCT_MONTHLY),
    annual: storeKitProductId(env.NUVO_IAP_ANNUAL, IAP_PRODUCT_ANNUAL),
  };
}

/** IDs that may be handed to StoreKit product(). Drops empty and all-digit
 *  Apple internal IDs (6804…). */
export function storeKitProductIds(ids: readonly string[]): string[] {
  return ids.filter((id) => Boolean(id) && !/^\d+$/.test(id));
}

export function isOurIapProduct(
  productId: string | null | undefined,
  env: { NUVO_IAP_MONTHLY?: string; NUVO_IAP_ANNUAL?: string } = {},
): boolean {
  if (!productId) return false;
  const ids = configuredIapProductIds(env);
  return productId === ids.monthly || productId === ids.annual;
}

export function iapEnvFrom(get: (key: string) => string | undefined): {
  NUVO_IAP_MONTHLY?: string;
  NUVO_IAP_ANNUAL?: string;
} {
  return {
    NUVO_IAP_MONTHLY: get("NUVO_IAP_MONTHLY"),
    NUVO_IAP_ANNUAL: get("NUVO_IAP_ANNUAL"),
  };
}
