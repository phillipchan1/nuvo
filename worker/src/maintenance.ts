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

export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";
