/** Personal friend-codes for checkout — not invites, not an affiliate program.
 *
 *  A code is a Stripe Promotion Code on a shared Coupon. Friends type it at
 *  Checkout (or land with `?code=`). We never say "invite" here — that word
 *  already means calendar guests.
 */

export const REFERRAL_CODE_STORAGE_KEY = "nuvo-referral-code";

/** In-memory mirror so a missing/blocked localStorage (private mode, some
 *  test runners) still carries a code through the session. */
let memoryCode: string | null = null;

/** Max length Stripe accepts for a promotion code `code` field in practice;
 *  we keep ours short so they're sayable out loud. */
const MAX_CODE_LEN = 20;

/** Strip to A–Z / 0–9 / hyphen, uppercase. Empty → null. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_CODE_LEN);
  return cleaned.length >= 2 ? cleaned : null;
}

/** First-name slug for a personal code. "David Chung" → "DAVID"; collisions
 *  are resolved by the issuer (suffix), not here. */
export function slugFromDisplayName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const slug = normalizeReferralCode(first);
  return slug ?? "FRIEND";
}

/** Persist a landing `?code=` so it survives signup → trial → checkout. */
export function writePendingReferralCode(code: string): void {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return;
  memoryCode = normalized;
  try {
    localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, normalized);
  } catch {
    /* private mode / quota — memory still holds it for this tab */
  }
}

export function readPendingReferralCode(): string | null {
  try {
    const fromStore = normalizeReferralCode(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY));
    if (fromStore) {
      memoryCode = fromStore;
      return fromStore;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryCode;
}

export function clearPendingReferralCode(): void {
  memoryCode = null;
  try {
    localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Capture `?code=` (or `?ref=`) from the current URL, stash it, and strip the
 * param so it doesn't linger in history or confuse other parsers. Call once
 * on boot, before React mounts when possible.
 */
export function captureReferralCodeFromLocation(
  search = typeof window !== "undefined" ? window.location.search : "",
  replaceState?: (url: string) => void,
): string | null {
  const params = new URLSearchParams(search);
  const raw = params.get("code") ?? params.get("ref");
  const code = normalizeReferralCode(raw);
  if (!code) return null;
  writePendingReferralCode(code);
  if (params.has("code") || params.has("ref")) {
    params.delete("code");
    params.delete("ref");
    const qs = params.toString();
    const next =
      typeof window !== "undefined"
        ? `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
        : qs
          ? `?${qs}`
          : "";
    if (replaceState) replaceState(next);
    else if (typeof window !== "undefined") window.history.replaceState({}, "", next);
  }
  return code;
}

export { friendShareSentence, shareBlurb, FRIEND_OFFER_SHORT } from "./referralOffer";
