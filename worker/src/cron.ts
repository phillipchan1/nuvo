/**
 * Fail-closed post-flip gate for every Worker cron (HTTP + Cron Trigger).
 * Unset / unknown = not flipped = no-op, so pg_cron on Supabase stays the
 * only runner. Shared with PRs B and E — import this; do not copy it.
 *
 * Truthy set matches writeFrozen (`1` / `true` / `yes` / `on`).
 */
export function cutoverFlipped(value: string | undefined | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Constant-time compare for the optional cron bearer.
 * Unset CRON_SECRET never authorizes (empty == empty is not a pass).
 */
export function timingSafeEqualString(left: string, right: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(left);
  const b = enc.encode(right);
  const len = Math.max(a.length, b.length, 1);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export function cronAuthorized(provided: string, secret: string | undefined): boolean {
  if (!secret) return false;
  return timingSafeEqualString(provided, secret);
}

export function bearerToken(header: string | undefined | null): string {
  if (!header) return "";
  return header.length > 7 && header.slice(0, 7).toLowerCase() === "bearer " ? header.slice(7) : header;
}
