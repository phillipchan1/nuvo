import { isEntitled, planOf, type PlanState, type PlanSource } from "../../supabase/functions/_shared/planRules.ts";

export type { PlanSource, PlanState };
export { isEntitled, planOf };

export type SubscriptionStatus = PlanState;

export interface Subscription {
  user_id: string;
  /** Physical column — same value as `plan`. */
  status: SubscriptionStatus;
  /** Public name for `status`. Computed by `public.plan(subscriptions)`. */
  plan?: PlanState;
  /** stripe | apple. Null while trialing (neither rail has been charged). */
  plan_source?: PlanSource | null;
  trial_ends_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  apple_original_transaction_id?: string | null;
  apple_product_id?: string | null;
  /** Personal share code (Stripe Promotion Code). Null until Billing asks
   *  `referral-code` to mint or attach one. */
  referral_code?: string | null;
  /** Friends who used this code at Checkout. */
  referral_uses?: number;
  referral_last_use_at?: string | null;
  /** Free months granted via friend-codes (stripe-webhook). */
  referral_credits_earned?: number;
  referral_last_credit_at?: string | null;
  /** Computed by `public.entitled` / `public.is_entitled` — the SQL twin of
   *  `isEntitled`. Prefer `isEntitled(row)` in app code so both rails share
   *  one function. */
  entitled: boolean;
}

export function trialDaysRemaining(sub: Subscription | null | undefined): number {
  if (!sub?.trial_ends_at) return 0;
  return Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86_400_000));
}

const WAS_ENTITLED_KEY = "nuvo-was-entitled";

/** A device-local hint only — never a source of truth. `subscription` is
 *  deliberately excluded from the offline query cache (NEVER_PERSIST in
 *  lib/sync/persist.ts), so every launch re-checks entitlement over the
 *  network with nothing to show meanwhile. This flag lets the UI render
 *  optimistically on that first paint instead of blocking on it; real access
 *  stays enforced server-side via RLS no matter what this says, and the live
 *  check that follows corrects the UI within moments if it's stale. Cleared
 *  on sign-out so the next account on this device never inherits it. */
export function readWasEntitled(): boolean {
  try {
    return localStorage.getItem(WAS_ENTITLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWasEntitled(entitled: boolean): void {
  try {
    if (entitled) localStorage.setItem(WAS_ENTITLED_KEY, "1");
    else localStorage.removeItem(WAS_ENTITLED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * A subscriptions SELECT that returns zero rows is not "this account isn't
 * entitled." RLS answers empty for an expired/missing JWT the same way it
 * answers empty for a missing row, and PostgREST reports that as `null`, not
 * an error. Trusting that null as cancelled is how a paying customer lands
 * on the paywall (or has the was-entitled hint cleared) after a blip.
 *
 * `retry` = refresh the JWT and read again. `fail` = throw, so the shell
 * can keep the app up on last launch's hint instead of locking them out.
 */
export function interpretSubscriptionRead(
  row: Subscription | null,
  opts: { hasSession: boolean; alreadyRetried: boolean },
): { action: "return"; row: Subscription | null } | { action: "retry" } | { action: "fail" } {
  if (row !== null) return { action: "return", row };
  if (!opts.hasSession) return { action: "return", row: null };
  if (!opts.alreadyRetried) return { action: "retry" };
  return { action: "fail" };
}

export type EntitlementView = "loading" | "verify-error" | "locked" | "open";

/**
 * What the signed-in shell should render. A failed or empty subscription
 * check is never "not entitled" — only an actual row that `isEntitled`
 * rejects is. Last launch's hint lets a paying account keep working through
 * a blip instead of unmounting the planner (and the capture they just typed).
 */
export function resolveEntitlementView(args: {
  subPending: boolean;
  subError: boolean;
  subscription: Subscription | null | undefined;
  checkoutPending: boolean;
  wasEntitled: boolean;
}): EntitlementView {
  const entitled = isEntitled(args.subscription);
  const trust = entitled || args.wasEntitled;
  const waiting = args.subPending || (args.checkoutPending && !entitled);

  if (waiting && !trust) return "loading";
  if (args.subError && !trust) return "verify-error";
  if (!entitled && !trust) return "locked";
  return "open";
}

/** @deprecated Use CheckoutPlan from stripeBilling — monthly/annual is a
 *  Stripe Checkout interval, not the entitlement plan. */
export type Plan = "monthly" | "annual";
