/**
 * Email on a Stripe customer / Checkout session / invoice. Neon-only
 * users are not in GoTrue, so stripe-webhook must not call getUserById.
 * The Stripe object is the source — no Worker lookup on this path.
 */
export function stripePayerEmail(
  source:
    | {
        customer_email?: unknown;
        customer_details?: { email?: unknown } | null;
        email?: unknown;
      }
    | null
    | undefined,
): string | undefined {
  if (!source) return undefined;
  const details = source.customer_details;
  const candidates = [
    details && typeof details === "object" ? details.email : undefined,
    source.customer_email,
    source.email,
  ];
  for (const raw of candidates) {
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return undefined;
}
