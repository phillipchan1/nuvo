/**
 * Write freeze for the cutover window. The Worker env flag is the source
 * of truth; the app reads GET /api/maintenance and the mutating /api/data
 * + /api/rpc handlers refuse writes while it is on.
 */
export function writeFrozen(value: string | undefined | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";
