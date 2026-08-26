/** Account wipe — the confirm word and Stripe-cancel rules.
 *
 *  Zero imports so the cheap gate and the edge function share one copy.
 *  The UI types DELETE; the function refuses anything else. */
export const ACCOUNT_DELETE_CONFIRM = "DELETE";

export function isAccountDeleteConfirm(typed: unknown): boolean {
  return typeof typed === "string" && typed.trim() === ACCOUNT_DELETE_CONFIRM;
}

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
