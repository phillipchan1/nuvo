/**
 * Write freeze for the cutover window. The Worker env flag is the source
 * of truth; the app reads GET /api/maintenance and the mutating /api/data
 * + /api/rpc handlers refuse writes while it is on.
 *
 * Fail-closed: unset/empty is off; only an explicit 0/false/no/off stays
 * open. Any other non-empty value (including a typo) freezes. Same rule
 * as `writeFreezeOn` so the Worker and the edge functions agree.
 */
import { writeFreezeOn } from "../../supabase/functions/_shared/writeFreeze.ts";

export function writeFrozen(value: string | undefined | null): boolean {
  return writeFreezeOn(value);
}

/**
 * Post-flip gate for Worker crons that must not run beside Supabase
 * `pg_cron`. Fail closed: unset / unknown = not flipped. Allowlist only
 * (`1` / `true` / `yes` / `on`) — not `writeFrozen`, which is fail-closed
 * the other way so a typo freezes writes.
 */
export function cutoverFlipped(value: string | undefined | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";
