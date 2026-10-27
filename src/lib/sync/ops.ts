/**
 * The offline op model.
 *
 * Every write in Nuvo becomes one of these before it becomes a network request.
 * The op is the durable unit: it is written to IndexedDB *first*, applied to the
 * query cache second, and sent to Postgres whenever the network allows — which
 * may be days later, on a different app launch.
 *
 * Three properties the rest of the sync layer depends on:
 *
 *  • **The row id is always client-generated**, inserts included. A server-side
 *    `gen_random_uuid()` cannot be replayed safely: if the insert reaches
 *    Postgres and the response is lost, a retry creates a *second* row. Naming
 *    the id on the client makes the insert idempotent (`on conflict (id) do
 *    nothing`), which is the whole reason a create can survive a force-quit.
 *
 *  • **Every field carries its own timestamp** (`fieldTs`). Row-level
 *    last-write-wins loses data whenever two devices touch different fields of
 *    the same row — the later writer's full patch clobbers the earlier one's
 *    untouched fields. Per-field LWW converges regardless of arrival order,
 *    which is what makes out-of-order delivery safe rather than merely
 *    survivable.
 *
 *  • **Ops are ordered by `seq`, monotonic per device.** Replay follows it so a
 *    child insert never overtakes its parent's.
 */

/** Tables the offline queue is allowed to write. Anything absent goes straight
 *  to the network (and is therefore online-only) — keeping this explicit stops a
 *  new table from silently acquiring half-working offline semantics. */
export const SYNC_TABLES = [
  "tasks",
  "task_labels",
  "projects",
  "initiatives",
  "domains",
  "key_results",
  "slots",
  "labels",
  "user_settings",
  "record_comments",
  "week_reviews",
  "sprints",
  "recurrences",
  // Overrides only ("remind me 30 before this one", "never this one") — the
  // common reminder is derived from settings and is never a row. Writing one
  // needs no server read, which is the test N-15 set for joining this list.
  "reminders",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

export type OpKind = "insert" | "update" | "delete";

export interface Op {
  /** Monotonic within a device. Replay order, and the tiebreak for coalescing. */
  seq: number;
  /** Idempotency key for this op itself, so a redelivered op is a no-op. */
  opId: string;
  table: SyncTable;
  kind: OpKind;
  /** Client-generated primary key. Present for inserts too — see the header. */
  rowId: string;
  /** insert: the full row. update: the patch. delete: `{}`. */
  payload: Record<string, unknown>;
  /**
   * Per-field client wall-clock (ISO), the input to field-level LWW. Set for
   * every key in `payload`. A merge of two updates keeps the *later* stamp per
   * field, which is what lets a coalesced patch still resolve correctly against
   * a concurrent writer.
   */
  fieldTs: Record<string, string>;
  /** When the user acted. Used for tombstone ordering and for diagnostics. */
  ts: string;
  attempts: number;
  lastError?: string;
  /**
   * Set only on a *folded* op: the lowest and highest stored `seq` of this row
   * that it stands for. Stored ops never carry them.
   *
   * A merge deliberately keeps the earliest `seq` so the op holds its place in
   * the replay order (a project insert must not slide behind the task that
   * references it). That makes `seq` useless for retiring the stored ops the
   * send stood for — acking "everything at or below seq 1" leaves the seq-2
   * update that merged into it sitting in the queue forever, so the outbox
   * never empties and re-sends the same patch on every drain. `throughSeq` is
   * the other end of that span.
   *
   * `fromSeq` is the near end, and it is not always `seq`: a delete that
   * replaced earlier patches replays at its own seq but retires them too. One
   * row can fold into several ops (a recreate, a refused fold), so a span
   * without a floor reached into the row's *earlier* op — sweeping a delete
   * that had not been sent, or retiring a parked op because a later one landed.
   */
  fromSeq?: number;
  throughSeq?: number;
}

/** The stored seqs of one row that an op accounts for. A stored op is its own
 *  span. */
export function spanOf(op: Op): { from: number; through: number } {
  return { from: op.fromSeq ?? op.seq, through: op.throughSeq ?? op.seq };
}

/** An op before the outbox assigns it durable identity. */
export type NewOp = Omit<Op, "seq" | "opId" | "attempts" | "fieldTs"> & {
  fieldTs?: Record<string, string>;
};

/** Stamp every key of a payload with one timestamp. */
export function stampFields(
  payload: Record<string, unknown>,
  ts: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(payload)) out[k] = ts;
  return out;
}

/**
 * Fold a device's pending ops into the smallest equivalent set.
 *
 * This is the part that has to be exactly right. It runs against a queue that
 * may hold a week of offline edits, and a wrong fold either loses a user's work
 * or resurrects a row they deleted. The rules, per row:
 *
 *   insert → update    = one insert with the update merged in (server never saw
 *                        the intermediate state, so there is nothing to preserve)
 *   insert → delete    = **annihilate**. The row never reached Postgres; sending
 *                        an insert followed by a delete would be two pointless
 *                        round-trips and a Realtime flicker on other devices.
 *   update → update    = one patch, later value wins per field
 *   update → delete    = just the delete; the patches are moot
 *   delete → insert    = cannot fold (a genuine recreate of the same id) — both
 *                        are emitted, in order
 *   … → update naming  = cannot fold (see below) — both are emitted, in order
 *   a row inserted since
 *
 * Ops for *different* rows never merge, and the emitted list stays in `seq`
 * order so foreign-key dependencies (project before its tasks) still hold.
 *
 * **A merge never moves a reference ahead of the insert it points at.** A
 * merged op replays at its *earlier* member's seq, so the later member's fields
 * travel back in time with it. That is harmless for a title and fatal for a
 * reference: rename a task, then drop it with another onto open time, and the
 * assign (`slot_id` → the new block) folds into the rename and reaches Postgres
 * ahead of the block's insert — `23503 tasks_slot_id_fkey`, parked. So an update
 * that names any row inserted after the op it would join is not folded; it is
 * emitted on its own at its own seq.
 *
 * Why refuse rather than slide the merge to the later seq: sliding drags the
 * *earlier* member's fields forward, past whatever happened in between. Assign
 * a task to a block, delete the block (its children are re-homed by `on delete
 * set null`), rename the task — a slid merge re-asserts `slot_id` after the
 * block is gone, the same 23503 from the other side. And an update folding into
 * an insert cannot slide at all, or the insert falls behind the rows that
 * reference it. Refusing reorders nothing, so it is right by construction; the
 * whole cost is one extra request, and only when the user re-pointed a row at
 * something they had just made.
 *
 * "Names" is deliberately schema-blind: any string anywhere in the patch equal
 * to the id of a row inserted since. The fold has no foreign-key map to keep in
 * step with the migrations, and the only way it can be wrong is by sending one
 * request more than it had to.
 */
export function coalesce(ops: Op[]): Op[] {
  return fold(ops).send;
}

/** A stretch of stored ops that a fold accounted for, so the outbox can retire
 *  them even when nothing is sent on their behalf. */
export interface DeadSpan {
  table: SyncTable;
  rowId: string;
  fromSeq: number;
  throughSeq: number;
}

/**
 * The full fold: what to send, and which stored spans are now moot.
 *
 * `dead` exists because an annihilated pair (a row created and deleted before
 * either reached the server) emits no op at all. Nothing would ever ack those
 * two stored rows, so they would sit in IndexedDB for the life of the install —
 * re-read and re-folded on every single drain. A planner that quietly grows its
 * local database forever is the storage-bloat bug this layer is supposed to
 * prevent, so the fold reports them and the outbox sweeps them.
 */
export function fold(ops: Op[]): { send: Op[]; dead: DeadSpan[] } {
  const sorted = [...ops].sort((a, b) => a.seq - b.seq);
  /** The still-mergeable op per row. */
  const pending = new Map<string, Op>();
  /** Ops that can no longer absorb anything (a recreate closed them off). */
  const sealed: Op[] = [];
  const dead: DeadSpan[] = [];
  /** The latest seq each id was inserted at, any table — a patch value names
   *  a row, not its table. */
  const insertedAt = new Map<string, number>();
  const alone = (op: Op): Op => ({ ...op, fromSeq: op.seq, throughSeq: op.seq });

  for (const op of sorted) {
    const key = `${op.table}:${op.rowId}`;
    const prev = pending.get(key);
    if (op.kind === "insert") insertedAt.set(op.rowId, op.seq);

    if (!prev) {
      pending.set(key, alone(op));
      continue;
    }

    // A recreate of a deleted id is a genuinely new row: the delete must reach
    // the server before the insert, so seal it rather than merging.
    if (prev.kind === "delete" && op.kind !== "delete") {
      sealed.push(prev);
      pending.set(key, alone(op));
      continue;
    }

    if (op.kind === "delete") {
      if (prev.kind === "insert") {
        // Never existed server-side. Drop both — but the *stored* ops still
        // have to be retired, so hand the annihilation to a tombstone the ack
        // can act on rather than forgetting the span outright.
        pending.delete(key);
        dead.push({ table: op.table, rowId: op.rowId, fromSeq: prev.fromSeq!, throughSeq: op.seq });
      } else {
        pending.set(key, { ...op, fromSeq: prev.fromSeq, throughSeq: op.seq });
      }
      continue;
    }

    if (op.kind === "insert") {
      // insert-after-insert for one id shouldn't happen, but if it does the
      // later one is the user's intent.
      pending.set(key, { ...op, fromSeq: prev.fromSeq, throughSeq: op.seq });
      continue;
    }

    // op.kind === "update". It points at a row created after `prev` — merged,
    // it would replay ahead of that row's insert (see the header).
    if (namesRowInsertedAfter(op.payload, prev.seq, insertedAt)) {
      sealed.push(prev);
      pending.set(key, alone(op));
      continue;
    }

    // Folding into an insert or an earlier update.
    pending.set(key, {
      ...prev,
      // Keep the earlier op's slot in the replay order: its dependencies (the
      // parent row it references) were satisfied at that point, and the check
      // above guarantees the later fields' are too.
      seq: prev.seq,
      // ...but remember how far the fold reached, so the ack retires the whole
      // span rather than just its head.
      throughSeq: op.seq,
      payload: { ...prev.payload, ...op.payload },
      fieldTs: { ...prev.fieldTs, ...op.fieldTs },
      ts: op.ts > prev.ts ? op.ts : prev.ts,
      // Attempts belong to the send, not the intent; a freshly merged op starts
      // clean so an unrelated earlier failure doesn't burn its retry budget.
      attempts: 0,
      lastError: undefined,
    });
  }

  return { send: [...sealed, ...pending.values()].sort((a, b) => a.seq - b.seq), dead };
}

/** Does any string in `value` (nested arrays and objects included) name a row
 *  whose latest insert came after `seq`? */
function namesRowInsertedAfter(
  value: unknown,
  seq: number,
  insertedAt: ReadonlyMap<string, number>,
): boolean {
  if (typeof value === "string") return (insertedAt.get(value) ?? -Infinity) > seq;
  if (Array.isArray(value)) return value.some((v) => namesRowInsertedAfter(v, seq, insertedAt));
  if (value && typeof value === "object") {
    return Object.values(value).some((v) => namesRowInsertedAfter(v, seq, insertedAt));
  }
  return false;
}

/**
 * Apply an op to an in-memory row set — the same fold the server will perform,
 * used to render the optimistic view and to prove in tests that local and
 * remote agree.
 */
export function applyOp<T extends { id: string }>(rows: T[], op: Op): T[] {
  switch (op.kind) {
    case "insert": {
      if (rows.some((r) => r.id === op.rowId)) {
        return rows.map((r) => (r.id === op.rowId ? { ...r, ...op.payload } : r));
      }
      return [...rows, { ...(op.payload as object), id: op.rowId } as T];
    }
    case "update":
      return rows.map((r) => (r.id === op.rowId ? { ...r, ...op.payload } : r));
    case "delete":
      return rows.filter((r) => r.id !== op.rowId);
  }
}

/**
 * Field-level last-write-wins merge — the client half of the conflict strategy,
 * and the exact rule the `apply_patch` RPC implements server-side.
 *
 * `remote` is the row as Postgres has it (with its own `field_ts` map, absent
 * for rows last written by a client that predates this layer). A field is
 * overwritten only when our stamp is strictly newer, so replaying a stale
 * offline edit over a fresher remote one is a no-op rather than data loss.
 *
 * Ties go to the remote. Two writes at the same millisecond are already
 * indistinguishable, and preferring the value that is *already durable* keeps
 * the outcome identical no matter which device asks the question.
 */
export function mergeFieldLww(
  remote: Record<string, unknown>,
  remoteFieldTs: Record<string, string> | null | undefined,
  patch: Record<string, unknown>,
  patchFieldTs: Record<string, string>,
): { merged: Record<string, unknown>; applied: string[]; rejected: string[] } {
  const merged = { ...remote };
  const applied: string[] = [];
  const rejected: string[] = [];

  for (const [field, value] of Object.entries(patch)) {
    const mine = patchFieldTs[field];
    const theirs = remoteFieldTs?.[field];
    // No recorded stamp on the remote side means the value predates field
    // tracking; our stamped write is the more informed one.
    if (theirs != null && mine != null && mine <= theirs) {
      rejected.push(field);
      continue;
    }
    merged[field] = value;
    applied.push(field);
  }

  return { merged, applied, rejected };
}
