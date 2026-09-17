/**
 * Which tables have a live Realtime channel right now.
 *
 * A delivered write comes back to this device as its own Realtime echo, and
 * `applyLiveChange` paints that echo — the server's actual row, field-LWW merge
 * and all — into the caches. While that channel is joined, a refetch after the
 * drain says nothing the echo doesn't, and it is not free: a single tick used
 * to refetch every task list (the whole account included) and rebuild the
 * vertical three times over. So the post-write refetch is skipped for a table
 * whose channel is up, and kept as the fallback for one whose channel is not.
 *
 * `useRealtime` is the only writer. Anything that reads it must treat `false`
 * as "refetch as before", never as an error.
 */

import type { SyncTable } from "./ops";

const live = new Set<string>();

export function setTableLive(table: string, isLive: boolean): void {
  if (isLive) live.add(table);
  else live.delete(table);
}

/** True when this table's writes come back as echoes we can trust to settle the cache. */
export function isTableLive(table: SyncTable | string): boolean {
  return live.has(table);
}

/** Test seam. */
export function resetLiveHealthForTests(): void {
  live.clear();
}
