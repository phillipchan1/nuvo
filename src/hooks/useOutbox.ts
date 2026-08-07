import { useSyncExternalStore } from "react";
import { outboxStatus, subscribeOutbox, type OutboxStatus } from "../lib/sync";

/**
 * Live view of what this device still owes the server.
 *
 * `useSyncExternalStore` rather than state + an effect: the outbox is written
 * from outside React (the drain loop, the `online` handler, a replay on
 * launch), and an effect-based subscription would miss changes that land
 * between render and commit — showing "all synced" over a queue that is not.
 */
export function useOutbox(): OutboxStatus {
  return useSyncExternalStore(subscribeOutbox, outboxStatus, outboxStatus);
}

/**
 * One line the shells can show without knowing anything about the queue.
 *
 * The offline copy is deliberately about *safety*, not about the network. A
 * planner that says "you're offline" invites the user to stop trusting it and
 * go write things down elsewhere; one that says their work is saved on the
 * device tells them the truth and lets them keep working.
 */
export function outboxSummary(s: OutboxStatus, online: boolean): string | null {
  if (s.parked > 0) {
    return `${s.parked} change${s.parked === 1 ? "" : "s"} couldn't be saved`;
  }
  if (s.pending === 0) {
    return online ? null : "Offline — showing your last synced data";
  }
  const n = `${s.pending} change${s.pending === 1 ? "" : "s"}`;
  if (!online) return `Offline — ${n} saved on this device`;
  if (s.syncing) return `Syncing ${n}…`;
  return `${n} waiting to sync`;
}
