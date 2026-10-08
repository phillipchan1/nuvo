/**
 * The offline write path, as the rest of the app sees it.
 *
 * A mutation hook does two things and no more: patch its query cache so the UI
 * moves now, and call `queueWrite` so the change is durable. It never awaits the
 * network and never rolls anything back — the outbox owns delivery from that
 * point, across reconnects, restarts and force-quits.
 */

import type { QueryClient } from "@tanstack/react-query";
import { enqueue } from "./outbox";
import { installOwingGuards, invalidateWhenSafe, markOwing, refreshOwing, startSync, syncNow } from "./coordinator";
import { announceQueuedWrite } from "./handoff";
import type { NewOp, Op, SyncTable } from "./ops";
import type { Transport } from "./engine";

export * from "./ops";
export {
  MAX_ATTEMPTS,
  discard,
  outboxStatus,
  parkedOps,
  pendingOps,
  subscribeOutbox,
  unpark,
  type OutboxStatus,
} from "./outbox";
export { invalidateWhenSafe, settleWrite, tablesOwing, queryKeyOwesServer, preserveOwingRows, runWithoutOwingPreserve, catchUpAfterOwingKnown, pullSyncTables, installOwingGuards, resetOwingForTests } from "./coordinator";
export { classifyError, type Transport, type SendResult } from "./engine";
export { createSupabaseTransport, conflictResolutionAvailable } from "./transport";
export { isDurable } from "./idb";
export { isTableLive, setTableLive, resetLiveHealthForTests } from "./liveHealth";
export { listenForQueuedWrites } from "./handoff";

let client: { qc: QueryClient; transport: Transport } | null = null;
let running: ReturnType<typeof startSync> | null = null;

/** Install the sync client for the session. Idempotent. */
export function configureSync(qc: QueryClient, transport: Transport) {
  if (client) running?.stop();
  client = { qc, transport };
  installOwingGuards(qc);
  running = startSync({ qc, transport });
}

export function teardownSync() {
  running?.stop();
  running = null;
  client = null;
}

/**
 * Durably record a write, then nudge the queue.
 *
 * Resolves as soon as the op is in IndexedDB — deliberately *not* when it
 * reaches Postgres. Callers await this only to know the change is safe.
 */
export async function queueWrite(op: NewOp): Promise<Op> {
  // Synchronous, before the first await: a caller that fires this with
  // `void` and immediately calls `invalidateWhenSafe` (the standard
  // optimistic-patch shape) must not see a stale "nothing owed" the
  // instant this function is entered — see markOwing's own comment.
  markOwing(op.table);
  const stored = await enqueue(op);
  await refreshOwing();
  // Fire and forget: a drain failure is the engine's business, not the caller's.
  if (client) void syncNow(client);
  // The ⌥Space panel is hidden moments after this; main must not depend on it.
  void announceQueuedWrite(op.table);
  return stored;
}

/**
 * Deliver and show writes another window queued (see `handoff.ts`).
 *
 * Push first: the refetch below must not overtake the write it is for. If the
 * panel already delivered, the drain finds nothing and the refetch simply reads
 * the row; if the network is down, `invalidateWhenSafe` defers behind the drain.
 */
export async function adoptForeignWrites(
  writes: readonly { table: SyncTable; keys: readonly (readonly string[])[] }[],
): Promise<void> {
  if (!client || !running) return;
  const { qc } = client;
  await running.kick();
  for (const { table, keys } of writes) {
    for (const key of keys) invalidateWhenSafe(qc, table, key);
  }
}

/** Force a sync pass — the pull-to-refresh / "retry now" path. */
export async function syncNowIfConfigured(): Promise<void> {
  if (client) await syncNow(client);
}

/**
 * The `rowId` for an owner-keyed singleton (`user_settings`). A sentinel rather
 * than the real uid: the transport resolves the account from the session when
 * the op is actually sent, which may be a different launch entirely.
 */
export const OWNER_ROW = "@me";

/** Build an op with the current wall clock. The one place `ts` is minted, so
 *  every field stamp in the system comes from the same call. */
export function makeOp(
  table: SyncTable,
  kind: Op["kind"],
  rowId: string,
  payload: Record<string, unknown> = {},
): NewOp {
  return { table, kind, rowId, payload, ts: new Date().toISOString() };
}
