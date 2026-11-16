/**
 * The drain loop: outbox → network, in order, forever until it lands.
 *
 * Two rules shape it.
 *
 * **Order is preserved across a retriable failure.** If op #4 can't go out
 * because the network died, ops #5+ wait. Sending them anyway would let a task
 * insert overtake the project insert it references, and Postgres would reject
 * the child for a foreign key that is merely *late*.
 *
 * **Order is abandoned across a fatal one.** If op #4 is rejected by RLS or
 * violates a check constraint, no amount of waiting fixes it. Holding the queue
 * behind it would mean one bad row silently freezes every future write on the
 * device — the worst possible failure for a planner. So a fatal op is parked
 * (kept, surfaced, never deleted) and the drain continues past it.
 *
 * The transport is injected so the whole loop can be driven in tests without a
 * network, a Supabase project, or a clock.
 */

import {
  pendingOps,
  ack,
  markInFlight,
  outboxOwner,
  recordFailure,
  refreshOutboxStatus,
  setOutboxOwner,
  setOutboxStatus,
} from "./outbox";
import type { Op, SyncTable } from "./ops";

export type SendResult =
  | { ok: true }
  /** The write never landed and re-sending it is safe. */
  | { ok: false; retriable: true; error: string }
  /** Postgres understood the write and refused it. Retrying cannot help. */
  | { ok: false; retriable: false; error: string };

export interface Transport {
  send(op: Op): Promise<SendResult>;
  /**
   * Who the session is right now, read at the start of every pass. When
   * present, the pass sends only that account's ops — and nothing at all
   * without a session. Optional so a bare test transport keeps the old rule.
   */
  owner?(): Promise<string | null>;
}

export interface DrainReport {
  sent: number;
  parked: number;
  /** Tables an op was actually delivered for this pass — the precise scope for
   *  post-drain refetches. The pre-drain `owing` snapshot can't provide this:
   *  an op queued after the snapshot but delivered by this drain is in neither
   *  the before- nor the after-set. */
  sentTables: ReadonlySet<SyncTable>;
  /** True when the drain stopped early because the network went away. */
  interrupted: boolean;
}

let draining: Promise<DrainReport> | null = null;
/** A drain was asked for while one was already walking the queue. */
let again = false;

/**
 * Send everything owed. Concurrent calls share one pass — a drain kicked off by
 * the `online` event and one kicked off by a keystroke must not both walk the
 * queue, or the same op goes out twice.
 *
 * But a pass only sends what was queued when it *started*. An op queued while
 * it runs (a task insert right behind the label it references) used to join
 * that pass, miss it, and then sit in the outbox until the next focus or
 * reconnect — seconds to minutes of "saved" work that hadn't left the device.
 * So a call that arrives mid-pass asks for one more pass.
 */
export function drain(transport: Transport): Promise<DrainReport> {
  if (draining) {
    again = true;
    return draining;
  }
  draining = (async () => {
    const sentTables = new Set<SyncTable>();
    const total: DrainReport = { sent: 0, parked: 0, sentTables, interrupted: false };
    do {
      again = false;
      const r = await runDrain(transport);
      total.sent += r.sent;
      total.parked += r.parked;
      for (const t of r.sentTables) sentTables.add(t);
      if (r.interrupted) {
        total.interrupted = true;
        break;
      }
    } while (again);
    return total;
  })().finally(() => {
    draining = null;
    again = false;
  });
  return draining;
}

async function runDrain(transport: Transport): Promise<DrainReport> {
  const sentTables = new Set<SyncTable>();
  const report: DrainReport = { sent: 0, parked: 0, sentTables, interrupted: false };
  // The session decides whose ops go out. Never drain without one: a queue
  // left by a signed-out account must not be delivered into the next one.
  if (transport.owner) {
    let uid: string | null;
    try {
      uid = await transport.owner();
    } catch {
      uid = null;
    }
    setOutboxOwner(uid);
    if (!uid) {
      setOutboxStatus({ syncing: false });
      return report;
    }
  } else if (outboxOwner() === null) {
    setOutboxStatus({ syncing: false });
    return report;
  }
  const ops = await pendingOps();
  if (!ops.length) {
    setOutboxStatus({ syncing: false, lastError: undefined });
    return report;
  }

  setOutboxStatus({ syncing: true });
  // From here until every result is recorded, these may be on the wire: a
  // delete queued meanwhile must not annihilate one of their inserts.
  markInFlight(ops);
  try {
    return await sendPass(transport, ops, report, sentTables);
  } finally {
    markInFlight([]);
  }
}

async function sendPass(
  transport: Transport,
  ops: Op[],
  report: DrainReport,
  sentTables: Set<SyncTable>,
): Promise<DrainReport> {
  const delivered: Op[] = [];
  /** Rows whose insert or delete parked in this pass: their later ops stay
   *  queued behind it (the outbox holds them from the next pass on — see
   *  `partition` in outbox.ts). */
  const parkedRows = new Set<string>();

  for (const op of ops) {
    if (parkedRows.has(`${op.table}:${op.rowId}`)) continue;
    let result: SendResult;
    try {
      result = await transport.send(op);
    } catch (e) {
      // A transport that throws rather than returning is treated as retriable:
      // an unexpected exception is far more likely to be an environment problem
      // than the server's considered judgement on this row.
      result = { ok: false, retriable: true, error: errText(e) };
    }

    if (result.ok) {
      delivered.push(op);
      report.sent++;
      sentTables.add(op.table);
      continue;
    }

    if (result.retriable) {
      // Stop here and keep the tail in order. Flush what did land first so a
      // long queue makes progress across repeated flaky drains instead of
      // re-sending its head every time.
      await recordFailure(op, result.error, false);
      report.interrupted = true;
      setOutboxStatus({ syncing: false, lastError: result.error });
      if (delivered.length) await ack(delivered);
      await refreshOutboxStatus();
      return report;
    }

    // Fatal: park it and keep going, so one poisoned row can't wedge the queue.
    await recordFailure(op, result.error, true);
    if (op.kind !== "update") parkedRows.add(`${op.table}:${op.rowId}`);
    report.parked++;
  }

  await ack(delivered);
  setOutboxStatus({ syncing: false, lastError: undefined });
  await refreshOutboxStatus();
  return report;
}

/**
 * PostgREST rejections arrive as plain objects, not Errors — `String(e)` on one
 * yields "[object Object]", which is what a parked op would have shown the user
 * in place of the reason their write was refused.
 */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [o.message, o.details, o.hint].filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (parts.length) return parts.join(" — ");
  }
  return String(e);
}

/**
 * Classify a Supabase/PostgREST failure.
 *
 * Getting this wrong in either direction is costly: calling a real rejection
 * "retriable" spins forever, and calling a network blip "fatal" parks a write
 * the user made perfectly legitimately. When in doubt we choose retriable —
 * a stuck op is visible and recoverable, a wrongly-parked one looks like the
 * app lost the edit.
 */
export function classifyError(error: unknown): { retriable: boolean; message: string } {
  const message = errText(error);
  const lower = message.toLowerCase();

  // Never reached the server.
  if (error instanceof TypeError) return { retriable: true, message };
  if (/failed to fetch|networkerror|load failed|network request failed|timeout|socket|connection|aborted/.test(lower)) {
    return { retriable: true, message };
  }

  const status = (error as { status?: number } | null)?.status;
  const code = (error as { code?: string } | null)?.code;

  // Auth that can refresh itself on the next attempt.
  if (status === 401 || code === "PGRST301" || /jwt (expired|invalid)/.test(lower)) {
    return { retriable: true, message };
  }
  // Server-side transients.
  if (status != null && status >= 500) return { retriable: true, message };
  if (status === 429) return { retriable: true, message };
  // Postgres: serialization failure / deadlock / too many connections.
  if (code === "40001" || code === "40P01" || code === "53300") return { retriable: true, message };

  // PostgREST's own codes: PGRST0xx is the database being unreachable (503)
  // and PGRST3xx is the bearer — both pass. PGRST1xx (a request it cannot
  // parse) and PGRST2xx (a column or function the schema cache lacks — the
  // PGRST204 of a client writing a column the server does not have yet) are
  // considered refusals. The error body carries no HTTP status, so without this
  // they fell through to "retriable" and held the whole queue behind them.
  if (code != null && /^PGRST[03]/.test(code)) return { retriable: true, message };
  if (code != null && /^PGRST/.test(code)) return { retriable: false, message };

  // Considered refusals: RLS, constraints, bad payloads.
  if (status != null && status >= 400 && status < 500) return { retriable: false, message };
  if (code != null && /^(23|22|42)/.test(code)) return { retriable: false, message };

  return { retriable: true, message };
}
