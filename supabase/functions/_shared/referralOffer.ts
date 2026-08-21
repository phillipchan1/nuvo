/** Deno twin of src/lib/referralOffer.ts — keep economics in lockstep. */
export const REFERRAL_MONTHLY_CREDIT_CENTS = 2_900;
export const REFERRAL_MAX_OUTSTANDING_MONTHS = 6;
export const REFERRAL_MAX_OUTSTANDING_CENTS =
  REFERRAL_MONTHLY_CREDIT_CENTS * REFERRAL_MAX_OUTSTANDING_MONTHS;

export function outstandingCreditCents(stripeCustomerBalance: number): number {
  if (!Number.isFinite(stripeCustomerBalance)) return 0;
  return Math.max(0, -stripeCustomerBalance);
}

export function monthsCreditRemaining(stripeCustomerBalance: number): number {
  const used = outstandingCreditCents(stripeCustomerBalance);
  const room = REFERRAL_MAX_OUTSTANDING_CENTS - used;
  if (room < REFERRAL_MONTHLY_CREDIT_CENTS) return 0;
  return Math.floor(room / REFERRAL_MONTHLY_CREDIT_CENTS);
}
