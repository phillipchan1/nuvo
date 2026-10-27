/**
 * Write freeze for the cutover window. The Worker env flag is the source
 * of truth; the app reads GET /api/maintenance and the mutating /api/data
 * + /api/rpc handlers refuse writes while it is on.
 */
export function writeFrozen(value: string | undefined | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Post-flip gate for Worker crons that must not run beside Supabase
 * (`github-poll`, `trim-sync-log`). Fail closed: unset / unknown = not
 * flipped. Same truthy set as `writeFrozen`; a different name so a freeze
 * off does not start those crons.
 */
export function cutoverFlipped(value: string | undefined | null): boolean {
  return writeFrozen(value);
}

export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";
