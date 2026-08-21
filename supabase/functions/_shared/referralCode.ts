/** Deno twin of src/lib/referral.ts mint helpers — keep in lockstep. */

const MAX_CODE_LEN = 20;
export const REFERRAL_SUFFIX_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const REFERRAL_SUFFIX_LEN = 4;

export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_CODE_LEN);
}

export function slugFromUser(user: {
  user_metadata?: Record<string, unknown>;
  email?: string | null;
}): string {
  const meta = user.user_metadata ?? {};
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (user.email ? user.email.split("@")[0] : "") ||
    "FRIEND";
  const first = name.trim().split(/\s+/)[0] ?? "FRIEND";
  return normalizeCode(first) || "FRIEND";
}

export function randomReferralSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(REFERRAL_SUFFIX_LEN));
  let out = "";
  for (let i = 0; i < REFERRAL_SUFFIX_LEN; i++) {
    out += REFERRAL_SUFFIX_ALPHABET[bytes[i]! % REFERRAL_SUFFIX_ALPHABET.length];
  }
  return out;
}

/** `PHIL-K7RM` — never bare first name. */
export function personalReferralCode(base: string, suffix: string): string {
  const slug = normalizeCode(base) || "FRIEND";
  const tail = suffix
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, REFERRAL_SUFFIX_LEN);
  if (tail.length !== REFERRAL_SUFFIX_LEN) {
    throw new Error("referral suffix must be 4 characters");
  }
  return `${slug}-${tail}`.slice(0, MAX_CODE_LEN);
}
