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

import { pendingOps, ack, recordFailure, refreshOutboxStatus, setOutboxStatus } from "./outbox";
import type { Op } from "./ops";

export type SendResult =
  | { ok: true }
  /** The write never landed and re-sending it is safe. */
  | { ok: false; retriable: true; error: string }
  /** Postgres understood the write and refused it. Retrying cannot help. */
  | { ok: false; retriable: false; error: string };

export interface Transport {
  send(op: Op): Promise<SendResult>;
}

export interface DrainReport {
  sent: number;
  parked: number;
  /** True when the drain stopped early because the network went away. */
  interrupted: boolean;
}

let draining: Promise<DrainReport> | null = null;

/**
 * Send everything owed. Concurrent calls share one pass — a drain kicked off by
 * the `online` event and one kicked off by a keystroke must not both walk the
 * queue, or the same op goes out twice.
 */
export function drain(transport: Transport): Promise<DrainReport> {
  draining ??= runDrain(transport).finally(() => {
    draining = null;
  });
  return draining;
}

async function runDrain(transport: Transport): Promise<DrainReport> {
  const report: DrainReport = { sent: 0, parked: 0, interrupted: false };
  const ops = await pendingOps();
  if (!ops.length) {
    setOutboxStatus({ syncing: false, lastError: undefined });
    return report;
  }

  setOutboxStatus({ syncing: true });
  const delivered: Op[] = [];

  for (const op of ops) {
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

  // Considered refusals: RLS, constraints, bad payloads.
  if (status != null && status >= 400 && status < 500) return { retriable: false, message };
  if (code != null && /^(23|22|42)/.test(code)) return { retriable: false, message };

  return { retriable: true, message };
}
