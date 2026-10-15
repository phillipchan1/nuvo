/**
 * Apply a Realtime row to the query cache immediately — the Google-docs path.
 *
 * Invalidating and refetching is correct eventually, but it is not live: a
 * table that still owes the outbox defers the refetch, and even a free table
 * waits a network round-trip. Agent / MCP / Capture writes are already in
 * Postgres when the socket fires, so the payload *is* the truth. Paint it now,
 * merging any unsent local op for the same row through the same field-LWW rule
 * `apply_patch` uses, so a queued title edit does not hide Friday's reschedule
 * and Friday's reschedule does not wipe a newer local drag.
 *
 * The merge also folds ops this device delivered in the last few seconds
 * (`recentlyAcked`). An ack does not mean every older echo has arrived: drag to
 * 9, drag to 10, both land, and the echo of the 9 can still be on the wire —
 * merged against nothing, it moved the block back. Delivered ops never decide a
 * DELETE, though: that is still only about work this device owes.
 *
 * Returns whether this device could apply the row. False means the caller
 * should fall back to `invalidateWhenSafe`.
 */

import type { QueryClient } from "@tanstack/react-query";
import { normalizeSettingsRow } from "../../hooks/useSettings";
import { eventInRange, isStaleEventEcho, pendingCreateFor, swapCreatedEvent } from "../eventWriteback";
import type { ExternalEvent } from "../types";
import { putSlotInCaches } from "../../hooks/useSlots";
import { putTaskInCaches } from "../../hooks/useTasks";
import type { Slot, Task } from "../types";
import { runWithoutOwingPreserve } from "./coordinator";
import { mergeFieldLww, type Op, type SyncTable } from "./ops";

export interface LiveChange {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE" | string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

const TASK_TS_FIELDS = ["start_time", "completed_at", "trashed_at", "suggested_at", "prework_at"] as const;

function asIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function fieldTsOf(row: Record<string, unknown> | null): Record<string, string> {
  const raw = row?.field_ts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v != null) out[k] = String(v);
  }
  return out;
}

function opsFor(pending: Op[], table: string, rowId: string): Op[] {
  return pending.filter((o) => o.table === table && o.rowId === rowId).sort((a, b) => a.seq - b.seq);
}

/** What a remote row is merged against: delivered-but-recent ops, then the
 *  ones still owed, in replay order. */
function mergeOpsFor(pending: Op[], delivered: Op[], table: string, rowId: string): Op[] {
  return opsFor([...delivered, ...pending], table, rowId);
}

/** Fold unsent local ops onto a remote row. `"deleted"` means this device still
 *  owes a delete — keep the optimistic removal, ignore the remote image. */
function mergePending(
  remote: Record<string, unknown>,
  remoteTs: Record<string, string>,
  ops: Op[],
): Record<string, unknown> | "deleted" {
  let row = { ...remote };
  let ts = { ...remoteTs };
  for (const op of ops) {
    if (op.kind === "delete") return "deleted";
    const { merged, applied } = mergeFieldLww(row, ts, op.payload, op.fieldTs);
    row = merged;
    for (const field of applied) ts[field] = op.fieldTs[field];
  }
  return row;
}

function coerceTask(row: Record<string, unknown>): Task {
  const next = { ...row };
  for (const field of TASK_TS_FIELDS) {
    if (field in next) next[field] = asIso(next[field]);
  }
  return next as unknown as Task;
}

function coerceSlot(row: Record<string, unknown>): Slot {
  return { ...row, start_time: asIso(row.start_time) ?? String(row.start_time ?? "") } as unknown as Slot;
}

function upsertById<T extends { id: string }>(
  qc: QueryClient,
  queryKey: string[],
  id: string,
  row: T | null,
  belongs?: (item: T, key: readonly unknown[]) => boolean,
): void {
  // Live apply already folded unsent local ops through field-LWW. The owing
  // structuralSharing merge would then prefer the previous cache body and
  // undo both a membership drop and Friday's newer fields.
  runWithoutOwingPreserve(() => {
    for (const [key, data] of qc.getQueriesData<T[]>({ queryKey })) {
      if (!Array.isArray(data)) continue;
      const existing = data.find((r) => r.id === id);
      const keep = row != null && (belongs ? belongs(row, key) : true);
      let updated: T[];
      if (!keep) updated = data.filter((r) => r.id !== id);
      else if (existing) updated = data.map((r) => (r.id === id ? { ...r, ...row! } : r));
      else updated = [...data, row!];
      qc.setQueryData(key, updated);
    }
  });
}

/**
 * The row as this device currently holds it, from whichever `tasks` fragment
 * has it. Realtime sends the bare table row — no joins — so a payload painted
 * straight over the cache erases every column the *query* assembles rather than
 * selects. `task_labels` is the one that shows: a colour on a row, gone the
 * moment anyone touched that task from another device, back again after the
 * next refetch, and impossible to reproduce on purpose.
 */
function cachedTask(qc: QueryClient, id: string): Task | undefined {
  for (const [, data] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
    if (!Array.isArray(data)) continue;
    const hit = data.find((t) => t.id === id);
    if (hit) return hit;
  }
  return undefined;
}

function applyTask(qc: QueryClient, change: LiveChange, pending: Op[], delivered: Op[]): boolean {
  const id = String((change.new ?? change.old)?.id ?? "");
  if (!id) return false;
  const local = opsFor(pending, "tasks", id);

  if (change.eventType === "DELETE") {
    // This device still owes work on a row the server says is gone. Keeping the
    // optimistic row is right — our op may be a recreate — but claiming the
    // change was *handled* is not: it suppressed the fallback invalidate, so
    // nothing ever reconciled the two and the row outlived the delete forever.
    // Hand it back so the caller defers an invalidate behind the drain.
    if (local.length) return false;
    putTaskInCaches(qc, id, null);
    return true;
  }

  if (!change.new) return false;
  const merged = mergePending(change.new, fieldTsOf(change.new), mergeOpsFor(pending, delivered, "tasks", id));
  if (merged === "deleted") return true;
  const existing = cachedTask(qc, id);
  const next = coerceTask(merged);
  putTaskInCaches(qc, id, existing ? { ...existing, ...next } : next);
  return true;
}

function applySlot(qc: QueryClient, change: LiveChange, pending: Op[], delivered: Op[]): boolean {
  const id = String((change.new ?? change.old)?.id ?? "");
  if (!id) return false;
  const local = opsFor(pending, "slots", id);

  if (change.eventType === "DELETE") {
    if (local.length) return false; // see applyTask
    putSlotInCaches(qc, id, null);
    return true;
  }

  if (!change.new) return false;
  const merged = mergePending(change.new, fieldTsOf(change.new), mergeOpsFor(pending, delivered, "slots", id));
  if (merged === "deleted") return true;
  putSlotInCaches(qc, id, coerceSlot(merged));
  return true;
}

function applyListRow(
  qc: QueryClient,
  table: string,
  queryKey: string[],
  change: LiveChange,
  pending: Op[],
  delivered: Op[],
  belongs?: (item: Record<string, unknown> & { id: string }, key: readonly unknown[]) => boolean,
): boolean {
  const id = String((change.new ?? change.old)?.id ?? "");
  if (!id) return false;
  const local = opsFor(pending, table, id);

  if (change.eventType === "DELETE") {
    if (local.length) return false; // see applyTask
    upsertById(qc, queryKey, id, null);
    return true;
  }

  if (!change.new) return false;
  const merged = mergePending(change.new, fieldTsOf(change.new), mergeOpsFor(pending, delivered, table, id));
  if (merged === "deleted") return true;
  const row = { ...merged, id } as Record<string, unknown> & { id: string };
  if ("start_time" in row) row.start_time = asIso(row.start_time);
  if ("start_at" in row) row.start_at = asIso(row.start_at);
  if ("end_at" in row) row.end_at = asIso(row.end_at);
  upsertById(qc, queryKey, id, row, belongs);
  return true;
}

/**
 * A provider event's row. Not an outbox table — its writes are ordered by the
 * event write-back lane (`lib/eventWriteback`), which also decides when an echo
 * is older than the cache:
 *
 *  • an echo for an event this device is still writing, or one carrying times
 *    it wrote and then moved past, is not painted — it was the jump back to
 *    the previous drag;
 *  • the real row of a create still on the wire replaces its temporary row
 *    rather than being drawn beside it.
 */
function applyEventRow(qc: QueryClient, change: LiveChange): boolean {
  const id = String((change.new ?? change.old)?.id ?? "");
  if (!id) return false;
  if (change.eventType !== "DELETE" && change.new) {
    if (isStaleEventEcho(id, change.new)) return true;
    const cached = qc
      .getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] })
      .some(([, data]) => Array.isArray(data) && data.some((e) => e.id === id));
    const tempId = cached ? undefined : pendingCreateFor(change.new);
    if (tempId) {
      const row = { ...change.new, id } as Record<string, unknown>;
      if ("start_at" in row) row.start_at = asIso(row.start_at);
      if ("end_at" in row) row.end_at = asIso(row.end_at);
      swapCreatedEvent(qc, tempId, row as unknown as ExternalEvent);
      return true;
    }
  }
  return applyListRow(qc, "external_events", ["external_events"], change, [], [], eventInRange);
}

function applyTaskLabels(qc: QueryClient, change: LiveChange): boolean {
  const taskId = String((change.new ?? change.old)?.task_id ?? "");
  const labelId = String((change.new ?? change.old)?.label_id ?? "");
  if (!taskId || !labelId) return false;
  for (const [, data] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
    if (!Array.isArray(data)) continue;
    const hit = data.find((t) => t.id === taskId);
    if (!hit) continue;
    const labels = hit.task_labels ?? [];
    const nextLabels =
      change.eventType === "DELETE"
        ? labels.filter((l) => l.label_id !== labelId)
        : labels.some((l) => l.label_id === labelId)
          ? labels
          : [...labels, { label_id: labelId }];
    putTaskInCaches(qc, taskId, { ...hit, task_labels: nextLabels });
    return true;
  }
  return false;
}

/**
 * Paint a Realtime change into the caches the UI already reads.
 * Unknown tables return false so the socket handler can invalidate instead.
 */
export function applyLiveChange(
  qc: QueryClient,
  change: LiveChange,
  pending: Op[] = [],
  delivered: Op[] = [],
): boolean {
  switch (change.table as SyncTable | string) {
    case "tasks":
      return applyTask(qc, change, pending, delivered);
    case "slots":
      return applySlot(qc, change, pending, delivered);
    case "projects":
      return applyListRow(qc, "projects", ["vertical", "projects"], change, pending, delivered);
    case "domains":
      return applyListRow(qc, "domains", ["vertical", "domains"], change, pending, delivered);
    case "initiatives":
      return applyListRow(qc, "initiatives", ["vertical", "initiatives"], change, pending, delivered);
    case "labels":
      return applyListRow(qc, "labels", ["labels"], change, pending, delivered);
    case "recurrences":
      return applyListRow(qc, "recurrences", ["recurrences"], change, pending, delivered);
    case "week_reviews":
      return applyListRow(qc, "week_reviews", ["week_reviews"], change, pending, delivered);
    case "record_comments":
      return applyListRow(qc, "record_comments", ["record_comments"], change, pending, delivered);
    case "external_events":
      return applyEventRow(qc, change);
    case "reminders":
      return applyListRow(qc, "reminders", ["reminders"], change, pending, delivered);
    case "task_labels":
      return applyTaskLabels(qc, change);
    case "user_settings": {
      if (change.eventType === "DELETE" || !change.new) return false;
      const local = [...delivered, ...pending]
        .filter((o) => o.table === "user_settings")
        .sort((a, b) => a.seq - b.seq);
      const merged = mergePending(change.new, fieldTsOf(change.new), local);
      if (merged === "deleted") return true;
      // Normalized like the query's own read: the raw row can carry a legacy
      // `reminder_prefs` the popover can't render.
      qc.setQueryData(["settings"], (old: Record<string, unknown> | undefined) =>
        normalizeSettingsRow(old ? { ...old, ...merged } : merged),
      );
      return true;
    }
    case "sprints": {
      const id = String((change.new ?? change.old)?.id ?? "");
      if (!id) return false;
      const local = opsFor(pending, "sprints", id);
      if (change.eventType === "DELETE") {
        if (local.length) return true;
        qc.setQueriesData({ queryKey: ["sprint"] }, (old: { id?: string } | null | undefined) =>
          old && old.id === id ? null : old,
        );
        return true;
      }
      if (!change.new) return false;
      const merged = mergePending(change.new, fieldTsOf(change.new), mergeOpsFor(pending, delivered, "sprints", id));
      if (merged === "deleted") return true;
      let painted = false;
      for (const [key, data] of qc.getQueriesData({ queryKey: ["sprint"] })) {
        const week = key[1];
        const row = merged as { id: string; week_start?: string };
        if (data && typeof data === "object" && "id" in data && (data as { id: string }).id === id) {
          qc.setQueryData(key, { ...(data as object), ...row });
          painted = true;
        } else if ((data == null || data === undefined) && row.week_start === week) {
          qc.setQueryData(key, row);
          painted = true;
        }
      }
      return painted;
    }
    default:
      return false;
  }
}
