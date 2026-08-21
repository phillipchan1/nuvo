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
import { installOwingGuards, markDeleted, markOwing, refreshOwing, startSync, syncNow } from "./coordinator";
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
export { invalidateWhenSafe, tablesOwing, queryKeyOwesServer, preserveOwingRows, installOwingGuards, markDeleted, resetOwingForTests } from "./coordinator";
export { classifyError, type Transport, type SendResult } from "./engine";
export { createSupabaseTransport, conflictResolutionAvailable } from "./transport";
export { isDurable } from "./idb";

let client: { qc: QueryClient; transport: Transport } | null = null;
let stop: (() => void) | null = null;

/** Install the sync client for the session. Idempotent. */
export function configureSync(qc: QueryClient, transport: Transport) {
  if (client) stop?.();
  client = { qc, transport };
  installOwingGuards(qc);
  stop = startSync({ qc, transport });
}

export function teardownSync() {
  stop?.();
  stop = null;
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
  if (op.kind === "delete") markDeleted(op.table, op.rowId);
  else markOwing(op.table);
  const stored = await enqueue(op);
  await refreshOwing();
  // Fire and forget: a drain failure is the engine's business, not the caller's.
  if (client) void syncNow(client);
  return stored;
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
