/**
 * The outbox — the durable list of writes this device owes the server.
 *
 * The contract the rest of the app relies on: **`enqueue` resolving means the
 * user's change is safe.** Not sent, not acknowledged — safe. It is in
 * IndexedDB, it will survive a force-quit, and the engine will deliver it
 * whenever the network returns. Everything optimistic in the UI is painted
 * *after* that promise resolves, which is the whole difference between "your
 * edit is queued" and the old behaviour of rolling it back once the retries ran
 * out.
 *
 * Failed ops are never dropped. An op that Postgres genuinely rejects (an RLS
 * denial, a constraint violation) is *parked*, not deleted: it stays in the
 * store with its error attached and is surfaced to the user, because a write
 * that silently disappears is exactly the failure mode this layer exists to
 * remove.
 */

import { fold, stampFields, type DeadSpan, type NewOp, type Op } from "./ops";
import { idbAllOps, idbAppendOp, idbDeleteOps, idbPutOp, isDurable } from "./idb";

/** Attempts before an op is parked for the user to deal with. */
export const MAX_ATTEMPTS = 8;

export interface OutboxStatus {
  /** Ops still owed to the server, after coalescing. */
  pending: number;
  /** Ops that failed permanently and need a human decision. */
  parked: number;
  /** True when the queue is being drained right now. */
  syncing: boolean;
  /** False when IndexedDB is unavailable and the queue lives in memory only. */
  durable: boolean;
  /** Set while the last drain attempt is failing, for the UI's offline strip. */
  lastError?: string;
}

type Listener = (s: OutboxStatus) => void;

const listeners = new Set<Listener>();
let status: OutboxStatus = { pending: 0, parked: 0, syncing: false, durable: true };

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function outboxStatus(): OutboxStatus {
  return status;
}

export function setOutboxStatus(patch: Partial<OutboxStatus>) {
  status = { ...status, ...patch, durable: isDurable() };
  for (const fn of listeners) fn(status);
}

/** Recount from the store and notify. Cheap enough to call after every drain. */
export async function refreshOutboxStatus(): Promise<OutboxStatus> {
  const all = await idbAllOps<Op>();
  const live = all.filter((o) => !isParked(o));
  setOutboxStatus({
    pending: fold(live).send.length,
    parked: all.length - live.length,
  });
  return status;
}

/** A parked op has exhausted its attempts and carries the rejection. */
export function isParked(op: Op): boolean {
  return op.attempts >= MAX_ATTEMPTS;
}

/**
 * Durably record one write. Resolves with the stored op — including the `seq`
 * IndexedDB assigned, which is the op's place in the replay order.
 */
export async function enqueue(op: NewOp): Promise<Op> {
  const ts = op.ts;
  const record: Omit<Op, "seq"> = {
    opId: crypto.randomUUID(),
    table: op.table,
    kind: op.kind,
    rowId: op.rowId,
    payload: op.payload,
    fieldTs: op.fieldTs ?? stampFields(op.payload, ts),
    ts,
    attempts: 0,
  };
  const seq = await idbAppendOp(record);
  const stored: Op = { ...record, seq };
  void refreshOutboxStatus();
  return stored;
}

/**
 * Everything still owed, coalesced and in replay order. Parked ops excluded.
 *
 * Sweeping happens here rather than on a timer: any fold that annihilated a
 * create/delete pair leaves stored ops nothing will ever ack, and this is the
 * one place that already knows which they are.
 */
export async function pendingOps(): Promise<Op[]> {
  const all = await idbAllOps<Op>();
  const { send, dead } = fold(all.filter((o) => !isParked(o)));
  if (dead.length) void sweep(all, dead);
  return send;
}

async function sweep(all: Op[], dead: DeadSpan[]): Promise<void> {
  const doomed = all
    .filter((o) =>
      dead.some((d) => d.table === o.table && d.rowId === o.rowId && o.seq <= d.throughSeq),
    )
    .map((o) => o.seq);
  if (doomed.length) await idbDeleteOps(doomed);
}

/** Ops the server rejected outright, for the recovery UI. */
export async function parkedOps(): Promise<Op[]> {
  const all = await idbAllOps<Op>();
  return all.filter(isParked).sort((a, b) => a.seq - b.seq);
}

/**
 * Retire delivered work.
 *
 * Coalescing means one sent op can stand for several stored ones, so an ack
 * clears every stored op that folded into it: all ops for the same row whose
 * `seq` is at or below the sent op's. Anything the user queued for that row
 * *after* the drain snapshot has a higher seq and deliberately survives.
 */
export async function ack(sent: Op[]): Promise<void> {
  if (!sent.length) return;
  const all = await idbAllOps<Op>();
  const ceiling = new Map<string, number>();
  for (const op of sent) {
    const key = `${op.table}:${op.rowId}`;
    // `throughSeq`, not `seq` — a coalesced op sits at the seq of its *earliest*
    // member, so acking by `seq` would strand every later edit that folded in.
    const reach = op.throughSeq ?? op.seq;
    ceiling.set(key, Math.max(ceiling.get(key) ?? 0, reach));
  }
  const doomed = all
    .filter((o) => {
      const limit = ceiling.get(`${o.table}:${o.rowId}`);
      return limit != null && o.seq <= limit;
    })
    .map((o) => o.seq);
  await idbDeleteOps(doomed);
  await refreshOutboxStatus();
}

/**
 * Record a failed attempt against every stored op that fed the coalesced one,
 * so the attempt budget follows the *work*, not the transient merge.
 */
export async function recordFailure(sent: Op, error: string, fatal: boolean): Promise<void> {
  const all = await idbAllOps<Op>();
  const reach = sent.throughSeq ?? sent.seq;
  const affected = all.filter(
    (o) => o.table === sent.table && o.rowId === sent.rowId && o.seq <= reach,
  );
  for (const op of affected) {
    await idbPutOp({
      ...op,
      attempts: fatal ? MAX_ATTEMPTS : op.attempts + 1,
      lastError: error,
    });
  }
  await refreshOutboxStatus();
}

/** Give a parked op another chance (the user fixed whatever Postgres objected to). */
export async function unpark(seqs: number[]): Promise<void> {
  const all = await idbAllOps<Op>();
  for (const op of all.filter((o) => seqs.includes(o.seq))) {
    await idbPutOp({ ...op, attempts: 0, lastError: undefined });
  }
  await refreshOutboxStatus();
}

/** Abandon parked ops — the only path that intentionally discards user intent,
 *  so it is reachable only from an explicit "discard" in the recovery UI. */
export async function discard(seqs: number[]): Promise<void> {
  await idbDeleteOps(seqs);
  await refreshOutboxStatus();
}
