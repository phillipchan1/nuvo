/** Shared referral economics — browser + edge (copy via parallel Deno module).
 *
 *  Friend: 50% off first invoice (Stripe Coupon, duration once).
 *  Referrer: one free month ($29) Customer Balance credit on friend's first
 *  *paid* invoice, capped at 6 months of outstanding credit.
 */

export const REFERRAL_MONTHLY_CREDIT_CENTS = 2_900; // $29 — one Nuvo month
export const REFERRAL_MAX_OUTSTANDING_MONTHS = 6;
export const REFERRAL_MAX_OUTSTANDING_CENTS =
  REFERRAL_MONTHLY_CREDIT_CENTS * REFERRAL_MAX_OUTSTANDING_MONTHS;

/** Friend-facing offer — must match the live Stripe Coupon. */
export const FRIEND_OFFER_SHORT = "50% off their first month";

export function friendShareSentence(code: string): string {
  return `Your friends' code is ${code}. They get 50% off their first month when they subscribe — and you get a free month when they pay (up to 6). Share https://nuvo.day/?code=${code} or have them type ${code} at checkout.`;
}

export function shareBlurb(): string {
  return "Friends get 50% off their first month. When they subscribe, you get a free month (up to six).";
}

/**
 * Stripe customer.balance: negative = credit owed to the customer.
 * Outstanding credit in cents (always ≥ 0).
 */
export function outstandingCreditCents(stripeCustomerBalance: number): number {
  if (!Number.isFinite(stripeCustomerBalance)) return 0;
  return Math.max(0, -stripeCustomerBalance);
}

/** How many more free months we may grant before hitting the cap. */
export function monthsCreditRemaining(stripeCustomerBalance: number): number {
  const used = outstandingCreditCents(stripeCustomerBalance);
  const room = REFERRAL_MAX_OUTSTANDING_CENTS - used;
  if (room < REFERRAL_MONTHLY_CREDIT_CENTS) return 0;
  return Math.floor(room / REFERRAL_MONTHLY_CREDIT_CENTS);
}
