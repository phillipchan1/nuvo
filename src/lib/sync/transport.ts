/**
 * The Supabase transport — the only place the outbox touches the network.
 *
 * Three things make a replayed op safe here:
 *
 *  • **Inserts are upserts that ignore duplicates.** A create whose response was
 *    lost (force-quit, dropped connection, tab suspended by iOS) is retried on
 *    the next launch. Because the id came from the client, the retry collides
 *    with the row it already created and is ignored, instead of producing the
 *    duplicate that a server-generated id guarantees.
 *
 *  • **Updates go through `apply_patch`**, an RPC that resolves per-field
 *    last-write-wins against the row's `field_ts` map. That is what makes a
 *    week-old offline edit merge with a colleague-device's fresher one rather
 *    than flattening it — and what makes out-of-order arrival converge.
 *
 *  • **Deletes are terminal.** A stale update that arrives after a delete finds
 *    no row and quietly does nothing, so the two orders converge on "deleted"
 *    without a tombstone table.
 *
 * If the `apply_patch` migration has not been pushed yet the RPC 404s. Rather
 * than parking every update on the device, the transport falls back to a plain
 * `UPDATE` (row-level LWW — the old behaviour) and remembers not to try again
 * this session. Offline queuing still works; only the conflict *resolution* is
 * degraded, and `conflictResolutionAvailable()` reports which mode is live.
 */

import { supabase } from "../supabase";
import { classifyError, type SendResult, type Transport } from "./engine";
import type { Op, SyncTable } from "./ops";

/**
 * How a row is identified, per table.
 *
 * Most tables are a single `id` and `rowId` is that uuid. Two are not:
 *
 *  • `task_labels` has a composite primary key, so its `rowId` is the two uuids
 *    joined by a pipe and split apart here.
 *  • `week_reviews` is addressed by its **natural** key. There is one row per
 *    week and the client has no way to learn the server's uuid while offline —
 *    minting one would risk a second row for the same week and a `23505` that
 *    parks the user's whole review. The week start *is* the identity.
 *
 * `mergeOnConflict` marks a table whose insert is a genuine upsert rather than
 * an ensure. `week_reviews` needs it because sealing a week folds (ensure row,
 * write report) into a single insert — with `ignoreDuplicates` that insert would
 * silently skip an existing placeholder row and the seal would vanish.
 */
interface Identity {
  /** Columns that address the row; `rowId` supplies their values, pipe-joined. */
  keys: string[];
  /**
   * The row is the signed-in user's own singleton (`user_settings`), so the
   * caller cannot name it — `user_id` is filled from the session at send time.
   * Enqueuing a client-known uid would be wrong anyway: the op may be replayed
   * on a launch where the session has since been refreshed.
   */
  ownerKeyed?: boolean;
  /**
   * The unique constraint an insert conflicts on. Declared, never derived from
   * `keys` — deriving it produced `user_id,task_id,label_id` for the join table,
   * which has no `user_id` column at all and would have failed every label write
   * on the server.
   */
  conflictTarget: string;
  mergeOnConflict?: boolean;
}

const IDENTITY: Partial<Record<SyncTable, Identity>> = {
  task_labels: { keys: ["task_id", "label_id"], conflictTarget: "task_id,label_id" },
  // One row per week, addressed by the week — an offline client cannot learn
  // the server's uuid, and inventing one risks a duplicate week.
  week_reviews: {
    keys: ["week_start"],
    conflictTarget: "user_id,week_start",
    mergeOnConflict: true,
  },
  sprints: {
    keys: ["week_start"],
    conflictTarget: "user_id,week_start",
    mergeOnConflict: true,
  },
  // One row per account, primary-keyed by user_id.
  user_settings: {
    keys: ["user_id"],
    conflictTarget: "user_id",
    mergeOnConflict: true,
    ownerKeyed: true,
  },
};

const DEFAULT_IDENTITY: Identity = { keys: ["id"], conflictTarget: "id" };

function identityOf(table: SyncTable): Identity {
  return IDENTITY[table] ?? DEFAULT_IDENTITY;
}

/** Tables whose rows are owned by a user and need the column stamped on insert. */
const NEEDS_USER_ID: SyncTable[] = [
  "tasks",
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
  "reminders",
];

let patchRpcAvailable: boolean | null = null;

/** null until the first update proves it either way. */
export function conflictResolutionAvailable(): boolean | null {
  return patchRpcAvailable;
}

export function resetTransportProbeForTests() {
  patchRpcAvailable = null;
}

function matchFor(op: Op, uid?: string | null): Record<string, string> {
  const identity = identityOf(op.table);
  if (identity.ownerKeyed) {
    if (!uid) throw new Error("owner-keyed row needs a session");
    return { [identity.keys[0]]: uid };
  }
  const values = op.rowId.split("|");
  return Object.fromEntries(identity.keys.map((k, i) => [k, values[i]]));
}

/** Owner-keyed tables cannot be addressed without a session. Null means "wait". */
async function resolveMatch(
  op: Op,
  getUserId: () => Promise<string | null>,
): Promise<Record<string, string> | null> {
  if (!identityOf(op.table).ownerKeyed) return matchFor(op);
  const uid = await getUserId();
  return uid ? matchFor(op, uid) : null;
}

export function createSupabaseTransport(
  getUserId: () => Promise<string | null>,
): Transport {
  return {
    async send(op: Op): Promise<SendResult> {
      try {
        switch (op.kind) {
          case "insert":
            return await sendInsert(op, getUserId);
          case "update":
            return await sendUpdate(op, getUserId);
          case "delete":
            return await sendDelete(op, getUserId);
        }
      } catch (e) {
        const { retriable, message } = classifyError(e);
        return { ok: false, retriable, error: message };
      }
    },
  };
}

async function sendInsert(op: Op, getUserId: () => Promise<string | null>): Promise<SendResult> {
  const identity = identityOf(op.table);
  const match = await resolveMatch(op, getUserId);
  if (!match) return { ok: false, retriable: true, error: "Not signed in yet" };
  const row: Record<string, unknown> = { ...op.payload, ...match };

  if (NEEDS_USER_ID.includes(op.table) && row.user_id == null) {
    const uid = await getUserId();
    // No session yet is a *transient* state, not a rejection: the queue should
    // wait for auth to rehydrate rather than park the user's captures.
    if (!uid) return { ok: false, retriable: true, error: "Not signed in yet" };
    row.user_id = uid;
  }
  if (patchRpcAvailable !== false) row.field_ts = op.fieldTs;

  const onConflict = identity.conflictTarget;

  const { error } = await supabase
    .from(op.table)
    .upsert(row, { onConflict, ignoreDuplicates: !identity.mergeOnConflict });

  if (!error) return { ok: true };

  // A unique violation on an INSERT means the row this op wanted already
  // exists — the intent is satisfied, so the op is done. `ignoreDuplicates`
  // only covers the declared conflict target; a collision on some *other*
  // unique constraint (a recurrence's `(recurrence_id, recurrence_date)`, say)
  // still surfaces as 23505 and would otherwise be classified fatal and park a
  // write that had nothing left to do.
  if (isUniqueViolation(error)) return { ok: true };

  // The migration adds `field_ts`; without it the column is unknown. Retry the
  // insert clean rather than parking a capture over a missing column.
  if (isMissingFieldTs(error) && row.field_ts !== undefined) {
    patchRpcAvailable = false;
    delete row.field_ts;
    const retry = await supabase
      .from(op.table)
      .upsert(row, { onConflict, ignoreDuplicates: !identity.mergeOnConflict });
    if (!retry.error) return { ok: true };
    const c = classifyError(retry.error);
    return { ok: false, retriable: c.retriable, error: c.message };
  }

  const { retriable, message } = classifyError(error);
  return { ok: false, retriable, error: message };
}

async function sendUpdate(
  op: Op,
  getUserId: () => Promise<string | null>,
): Promise<SendResult> {
  const match = await resolveMatch(op, getUserId);
  if (!match) return { ok: false, retriable: true, error: "Not signed in yet" };

  if (patchRpcAvailable !== false) {
    const { error } = await supabase.rpc("apply_patch", {
      p_table: op.table,
      p_match: match,
      p_patch: op.payload,
      p_field_ts: op.fieldTs,
    });

    if (!error) {
      patchRpcAvailable = true;
      return { ok: true };
    }

    if (isMissingRpc(error)) {
      // Not deployed. Degrade to row-level LWW for the rest of the session.
      patchRpcAvailable = false;
    } else {
      const { retriable, message } = classifyError(error);
      return { ok: false, retriable, error: message };
    }
  }

  const { error } = await supabase.from(op.table).update(op.payload).match(match);
  if (!error) return { ok: true };
  const { retriable, message } = classifyError(error);
  return { ok: false, retriable, error: message };
}

async function sendDelete(
  op: Op,
  getUserId: () => Promise<string | null>,
): Promise<SendResult> {
  const match = await resolveMatch(op, getUserId);
  if (!match) return { ok: false, retriable: true, error: "Not signed in yet" };
  const { error } = await supabase.from(op.table).delete().match(match);
  if (!error) return { ok: true };
  const { retriable, message } = classifyError(error);
  return { ok: false, retriable, error: message };
}

/** PostgREST reports an undeployed function as a schema-cache miss, not a 404. */
function isMissingRpc(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const msg = ((error as { message?: string } | null)?.message ?? "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    /could not find the function|function .* does not exist|schema cache/.test(msg)
  );
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "23505";
}

function isMissingFieldTs(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const msg = ((error as { message?: string } | null)?.message ?? "").toLowerCase();
  return code === "PGRST204" || code === "42703" || /field_ts/.test(msg);
}
