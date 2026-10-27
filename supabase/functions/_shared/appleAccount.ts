/**
 * StoreKit `appAccountToken` is the Nuvo user id (UUID). Apple echoes it
 * on the signed transaction so apple-webhook can attach a first purchase
 * when confirmApplePurchase never ran (Better Auth session, no GoTrue JWT).
 *
 * applyPlanUpdate upserts the default trial row when none exists
 * (post-flip signup, or confirm never ran).
 */
import { isUuid, UUID_RE } from "./actingUser.ts";

/** Compact 32-hex → hyphenated UUID. Rejects anything else. */
export function parseAppAccountToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  const compact = raw.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) return null;
  const hyphenated = [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
  return isUuid(hyphenated) ? hyphenated.toLowerCase() : null;
}

/**
 * Use the token as userId only when no row is already linked to this
 * originalTransactionId. A linked row must not be remapped.
 */
export function appleWebhookUserId(args: {
  existingUserIdByOriginalTransaction: string | null | undefined;
  appAccountToken: unknown;
}): string | undefined {
  const existing = (args.existingUserIdByOriginalTransaction ?? "").trim();
  if (existing) return undefined;
  return parseAppAccountToken(args.appAccountToken) ?? undefined;
}
