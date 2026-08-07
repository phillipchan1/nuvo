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
   * Set only on a *coalesced* op: the highest stored `seq` folded into it.
   *
   * A merge deliberately keeps the earliest `seq` so the op holds its place in
   * the replay order (a project insert must not slide behind the task that
   * references it). That makes `seq` useless for retiring the stored ops the
   * send stood for — acking "everything at or below seq 1" leaves the seq-2
   * update that merged into it sitting in the queue forever, so the outbox
   * never empties and re-sends the same patch on every drain. `throughSeq` is
   * the other end of that span.
   */
  throughSeq?: number;
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
 *
 * Ops for *different* rows never merge, and the emitted list stays in `seq`
 * order so foreign-key dependencies (project before its tasks) still hold.
 */
export function coalesce(ops: Op[]): Op[] {
  return fold(ops).send;
}

/** A stretch of stored ops that a fold accounted for, so the outbox can retire
 *  them even when nothing is sent on their behalf. */
export interface DeadSpan {
  table: SyncTable;
  rowId: string;
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

  for (const op of sorted) {
    const key = `${op.table}:${op.rowId}`;
    const prev = pending.get(key);

    if (!prev) {
      pending.set(key, { ...op, throughSeq: op.seq });
      continue;
    }

    // A recreate of a deleted id is a genuinely new row: the delete must reach
    // the server before the insert, so seal it rather than merging.
    if (prev.kind === "delete" && op.kind !== "delete") {
      sealed.push(prev);
      pending.set(key, { ...op, throughSeq: op.seq });
      continue;
    }

    if (op.kind === "delete") {
      if (prev.kind === "insert") {
        // Never existed server-side. Drop both — but the *stored* ops still
        // have to be retired, so hand the annihilation to a tombstone the ack
        // can act on rather than forgetting the span outright.
        pending.delete(key);
        dead.push({ table: op.table, rowId: op.rowId, throughSeq: op.seq });
      } else {
        pending.set(key, { ...op, throughSeq: op.seq });
      }
      continue;
    }

    if (op.kind === "insert") {
      // insert-after-insert for one id shouldn't happen, but if it does the
      // later one is the user's intent.
      pending.set(key, { ...op, throughSeq: op.seq });
      continue;
    }

    // op.kind === "update", folding into an insert or an earlier update.
    pending.set(key, {
      ...prev,
      // Keep the earlier op's slot in the replay order: its dependencies (the
      // parent row it references) were satisfied at that point.
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
