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

import { fold, spanOf, stampFields, type DeadSpan, type NewOp, type Op } from "./ops";
import { idbAllOps, idbAppendOp, idbDeleteOps, idbPutOp, isDurable } from "./idb";

/** Attempts before an op is parked for the user to deal with. */
export const MAX_ATTEMPTS = 8;

/**
 * A *retriable* failure (offline, a 5xx, a write freeze, an expired bearer, no
 * session yet) is the environment, not the write — so it only parks an op once
 * it has been failing for this long as well as `MAX_ATTEMPTS` times. Counting
 * them alone parked a perfectly good capture after eight blips of a flaky
 * network (about four minutes of backoff), and a parked op never went out again
 * on its own. The floor still exists so one op the server keeps 500ing on
 * cannot hold the queue behind it forever.
 */
export const PARK_FLOOR_MS = 24 * 60 * 60 * 1000;

/**
 * Whose queue this is. `undefined` until the app says (tests, and the moment
 * before auth answers) — then nothing is filtered, the pre-stamping behaviour.
 * `null` is "signed out": stamped ops belong to nobody and the drain sends
 * nothing.
 */
let owner: string | null | undefined;

export function setOutboxOwner(uid: string | null | undefined): void {
  owner = uid;
}

export function outboxOwner(): string | null | undefined {
  return owner;
}

/** An unstamped op (queued before stamping) belongs to whoever drains it. */
function belongs(op: Op): boolean {
  return owner === undefined || op.ownerId == null || op.ownerId === owner;
}

/** Stored ops the current drain pass has taken — they may be on the wire. */
let inFlight: Op[] = [];

/** The engine marks a pass's snapshot before sending any of it, and clears it
 *  once the pass has acked or recorded every result. */
export function markInFlight(ops: Op[]): void {
  inFlight = ops;
}

function mayHaveLanded(o: Op): boolean {
  if (o.attempts > 0 || o.lastError != null) return true;
  return inFlight.some((f) => {
    if (f.table !== o.table || f.rowId !== o.rowId) return false;
    const { from, through } = spanOf(f);
    return o.seq >= from && o.seq <= through;
  });
}

/**
 * Split the store into what may be sent, what is parked, and what is *held*.
 *
 * Held: a later op for a row whose earlier *insert or delete* is parked. Sent
 * alone it is wrong either way — an edit to a row whose insert was refused
 * matches nothing and is acked as a success, then the insert's retry
 * resurrects the old title; a delete behind it is acked the same way and the
 * retry brings the row back; a recreate behind a parked delete is ignored as a
 * duplicate and the delete's retry then removes it. So it waits with the
 * parked op, and an unpark lets it fold back in.
 *
 * A parked *update* holds nothing back: later patches are independent field
 * writes on a row that exists, and field-LWW keeps a retried older patch from
 * overwriting them — holding them would freeze every later edit of the row
 * behind one refused field.
 *
 * Ops queued by another account on this device are left out entirely.
 */
function partition(all: Op[]): { live: Op[]; parked: Op[]; held: Op[] } {
  const mine = all.filter(belongs);
  const parked = mine.filter(isParked);
  const floor = new Map<string, number>();
  for (const p of parked) {
    if (p.kind === "update") continue;
    const key = `${p.table}:${p.rowId}`;
    floor.set(key, Math.min(floor.get(key) ?? Infinity, p.seq));
  }
  const live: Op[] = [];
  const held: Op[] = [];
  for (const o of mine) {
    if (isParked(o)) continue;
    const f = floor.get(`${o.table}:${o.rowId}`);
    (f != null && o.seq > f ? held : live).push(o);
  }
  return { live, parked, held };
}

function foldLive(live: Op[]) {
  return fold(live, mayHaveLanded);
}

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
  const { live, parked } = partition(all);
  setOutboxStatus({
    pending: foldLive(live).send.length,
    parked: parked.length,
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
    ...(owner ? { ownerId: owner } : {}),
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
  const { send, dead } = foldLive(partition(all).live);
  if (dead.length) void sweep(all, dead);
  return send;
}

async function sweep(all: Op[], dead: DeadSpan[]): Promise<void> {
  // Bounded below as well as above: delete → recreate → delete annihilates only
  // the second pair, and the first delete is still owed.
  const doomed = all
    .filter((o) =>
      dead.some(
        (d) =>
          d.table === o.table && d.rowId === o.rowId && o.seq >= d.fromSeq && o.seq <= d.throughSeq,
      ),
    )
    .map((o) => o.seq);
  if (!doomed.length) return;
  await idbDeleteOps(doomed);
  settleWaiters(doomed, false);
}

/** Ops the server rejected outright, for the recovery UI. */
export async function parkedOps(): Promise<Op[]> {
  const all = await idbAllOps<Op>();
  return partition(all).parked.sort((a, b) => a.seq - b.seq);
}

/**
 * Both halves of the queue from one read.
 *
 * The coordinator needs them together — pending decides whether a refetch may
 * run at all, parked decides which individual rows that refetch must not
 * delete — and reading the store twice per drain to answer one question was
 * pure cost.
 */
export async function outboxSnapshot(): Promise<{ pending: Op[]; parked: Op[] }> {
  const all = await idbAllOps<Op>();
  const { live, parked, held } = partition(all);
  const { send, dead } = foldLive(live);
  if (dead.length) void sweep(all, dead);
  // Held ops are protected like the parked op they wait behind: their row
  // exists only on this device, and the table must not read as owing forever.
  return { pending: send, parked: [...parked, ...held] };
}

/**
 * How long a delivered op still counts when a Realtime echo is merged.
 *
 * An ack means Postgres has the write, not that this device has heard every
 * echo that predates it. Drag a block to 9 then to 10: op1 lands, op2 lands,
 * and the echo of op1 can still be on the wire. Merging only what is still
 * *pending* painted that echo raw, and the block jumped back to 9 until op2's
 * echo followed it (or stayed there, if the socket dropped in between). Folding
 * the recently delivered ops through the same field-LWW rule keeps op2 on
 * screen and costs nothing when the echo is newer: its stamps win the merge.
 */
export const RECENT_ACK_MS = 10_000;

let recentAcks: { op: Op; at: number }[] = [];

function pruneRecentAcks(now: number) {
  if (recentAcks.length && recentAcks[0].at < now - RECENT_ACK_MS) {
    recentAcks = recentAcks.filter((r) => r.at >= now - RECENT_ACK_MS);
  }
}

/** Ops delivered within `RECENT_ACK_MS`, oldest first. In memory only: a
 *  relaunch has no echoes in flight from the previous life. */
export function recentlyAcked(now = Date.now()): Op[] {
  pruneRecentAcks(now);
  return recentAcks.map((r) => r.op);
}

/** Callers waiting on one stored op's fate, by `seq`. */
const deliveryWaiters = new Map<number, ((delivered: boolean) => void)[]>();

function settleWaiters(seqs: Iterable<number>, delivered: boolean) {
  for (const seq of seqs) {
    const waiting = deliveryWaiters.get(seq);
    if (!waiting) continue;
    deliveryWaiters.delete(seq);
    for (const resolve of waiting) resolve(delivered);
  }
}

/**
 * Resolves `true` once this op has reached Postgres, `false` if it never will
 * (parked, discarded, or annihilated by a later delete). It never times out:
 * offline, it waits for the drain like the op does.
 *
 * For work that has to *read the row back* on the server — the Google mirror
 * re-reads the task, so firing it at enqueue time mirrored the row as it was
 * before the edit.
 */
export function whenDelivered(op: Pick<Op, "seq">): Promise<boolean> {
  if (recentAcks.some((r) => r.op.seq === op.seq)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const waiting = deliveryWaiters.get(op.seq) ?? [];
    waiting.push(resolve);
    deliveryWaiters.set(op.seq, waiting);
  });
}

/** Test seam. */
export function resetDeliveryForTests() {
  recentAcks = [];
  deliveryWaiters.clear();
  inFlight = [];
  owner = undefined;
}

/**
 * Retire delivered work.
 *
 * Coalescing means one sent op can stand for several stored ones, so an ack
 * clears every stored op that folded into it: the ops for the same row inside
 * its span (`spanOf`). Anything the user queued for that row *after* the drain
 * snapshot has a higher seq and deliberately survives — and so does an
 * *earlier* op of the row that folded separately and was parked, which a
 * "everything at or below" ceiling used to retire the moment a later op landed.
 */
export async function ack(sent: Op[]): Promise<void> {
  if (!sent.length) return;
  const all = await idbAllOps<Op>();
  const spans = new Map<string, { from: number; through: number }[]>();
  for (const op of sent) {
    const key = `${op.table}:${op.rowId}`;
    // `throughSeq`, not `seq` — a coalesced op sits at the seq of its *earliest*
    // member, so acking by `seq` would strand every later edit that folded in.
    spans.set(key, [...(spans.get(key) ?? []), spanOf(op)]);
  }
  const retired = all.filter((o) =>
    spans.get(`${o.table}:${o.rowId}`)?.some((s) => o.seq >= s.from && o.seq <= s.through),
  );
  const doomed = retired.map((o) => o.seq);
  await idbDeleteOps(doomed);
  const now = Date.now();
  pruneRecentAcks(now);
  for (const op of retired.sort((a, b) => a.seq - b.seq)) recentAcks.push({ op, at: now });
  settleWaiters(doomed, true);
  await refreshOutboxStatus();
}

/**
 * Record a failed attempt against every stored op that fed the coalesced one,
 * so the attempt budget follows the *work*, not the transient merge.
 */
export async function recordFailure(sent: Op, error: string, fatal: boolean): Promise<void> {
  const all = await idbAllOps<Op>();
  // Only this op's span: the row's earlier op may have landed earlier in this
  // same drain, and marking it failed would tell its waiters it never will.
  const { from, through } = spanOf(sent);
  const affected = all.filter(
    (o) => o.table === sent.table && o.rowId === sent.rowId && o.seq >= from && o.seq <= through,
  );
  const now = Date.now();
  for (const op of affected) {
    const firstFailedAt = op.firstFailedAt ?? now;
    let attempts = fatal ? MAX_ATTEMPTS : op.attempts + 1;
    // Retriable: the count alone never parks it — see `PARK_FLOOR_MS`.
    if (!fatal && attempts >= MAX_ATTEMPTS && now - firstFailedAt < PARK_FLOOR_MS) {
      attempts = MAX_ATTEMPTS - 1;
    }
    await idbPutOp({ ...op, attempts, lastError: error, firstFailedAt });
  }
  if (fatal) settleWaiters(affected.map((o) => o.seq), false);
  await refreshOutboxStatus();
}

/** Give a parked op another chance (the user fixed whatever Postgres objected to). */
export async function unpark(seqs: number[]): Promise<void> {
  const all = await idbAllOps<Op>();
  for (const op of all.filter((o) => seqs.includes(o.seq))) {
    // `lastError` stays: it is also the mark that this op was sent before, so
    // an insert the user retries is never annihilated by a later delete.
    await idbPutOp({ ...op, attempts: 0, firstFailedAt: undefined });
  }
  await refreshOutboxStatus();
}

/**
 * One more try for every parked op, without anyone finding a Retry button.
 *
 * "Couldn't be saved" is often fixed on the server side — a column the client
 * started writing before the migration reached production — and a parked op
 * used to stay parked until a human went to Settings. Run on launch and when
 * the network comes back. It is a single try: the op re-enters the queue one
 * failure short of the budget, so if the server still refuses it, it parks
 * again at once instead of wedging the queue behind it.
 */
export async function retryParked(): Promise<number> {
  const all = await idbAllOps<Op>();
  const { parked } = partition(all);
  for (const op of parked) {
    await idbPutOp({ ...op, attempts: MAX_ATTEMPTS - 1 });
  }
  if (parked.length) await refreshOutboxStatus();
  return parked.length;
}

/** Abandon parked ops — the only path that intentionally discards user intent,
 *  so it is reachable only from an explicit "discard" in the recovery UI. */
export async function discard(seqs: number[]): Promise<void> {
  await idbDeleteOps(seqs);
  settleWaiters(seqs, false);
  await refreshOutboxStatus();
}

/** Drop every queued write. Account deletion is the only caller — sign-out
 *  keeps the outbox so a later sign-in on the same device can still drain. */
export async function clearOutbox(): Promise<void> {
  // Only this account's: another account's queued work on the device is not
  // the deleted account's to throw away.
  const all = (await idbAllOps<Op>()).filter(belongs);
  await idbDeleteOps(all.map((o) => o.seq));
  settleWaiters(all.map((o) => o.seq), false);
  await refreshOutboxStatus();
}
