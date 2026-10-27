/** Account wipe — the confirm word and Stripe-cancel rules.
 *
 *  Zero imports so the cheap gate and the edge function share one copy.
 *  The UI types DELETE; the function refuses anything else. */
export const ACCOUNT_DELETE_CONFIRM = "DELETE";

export function isAccountDeleteConfirm(typed: unknown): boolean {
  return typeof typed === "string" && typed.trim() === ACCOUNT_DELETE_CONFIRM;
}

/** Worker 409 when a Stripe row would keep charging. */
export const STRIPE_DELETE_BLOCK_MESSAGE =
  "Cancel your Stripe subscription in Settings → Billing first, then delete your account.";

/** StoreKit can delete; we cannot cancel Apple. Same words in the panel and the 200. */
export const APPLE_DELETE_NOTICE =
  "Cancel your subscription in Apple Account settings (Settings → your name → Subscriptions). We cannot cancel an App Store subscription for you.";

/** A live Stripe subscription we can cancel. Apple / StoreKit ids never
 *  land here — we cannot cancel those, and we must not pretend we can. */
export function stripeSubscriptionIdToCancel(
  row: { stripe_subscription_id?: string | null } | null | undefined,
): string | null {
  const id = row?.stripe_subscription_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Stripe already cancelled the sub, or the id is gone. Safe to wipe. */
export function isIgnorableStripeCancelError(message: string): boolean {
  return /no such subscription|already (been )?cancel/i.test(message);
}
