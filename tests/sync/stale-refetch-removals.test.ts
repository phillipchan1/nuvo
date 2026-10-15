import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";

import { resetIdbForTests } from "../../src/lib/sync/idb";
import { ack, pendingOps } from "../../src/lib/sync/outbox";
import {
  installOwingGuards,
  preserveOwingRows,
  refreshOwing,
  resetOwingForTests,
} from "../../src/lib/sync/coordinator";
import { makeOp, queueWrite } from "../../src/lib/sync";
import { patchCaches, putTaskInCaches, scheduledTasksKey } from "../../src/hooks/useTasks";
import { putSlotInCaches, slotsKey } from "../../src/hooks/useSlots";
import type { Slot, Task } from "../../src/lib/types";

/**
 * The other half of "a refetch is authoritative for rows this device doesn't
 * owe": for the rows it *does* owe, a refetch must not hand back what this
 * device already took away.
 *
 * A snapshot that predates a queued delete still has the row, and a snapshot
 * that predates a queued move still has it in the old list. The owing merge
 * looked only for rows the refetch *lacked*; a row the refetch *had* and the
 * cache didn't was admitted as "new on the server". So a deleted slot came back
 * on the Schedule, a removed step came back on its checklist, and a block dragged
 * to next week stood in both weeks — until the drain and a later refetch. The
 * fetches that reach this while owing are the ungated ones: the calendar's
 * neighbour prefetch (`prefetchCalendarRange`) and any key's first fetch.
 */

const THIS_WEEK = scheduledTasksKey("2026-10-12T07:00:00.000Z", "2026-10-19T07:00:00.000Z");
const NEXT_WEEK = scheduledTasksKey("2026-10-19T07:00:00.000Z", "2026-10-26T07:00:00.000Z");
const SLOTS_THIS_WEEK = slotsKey("2026-10-12T07:00:00.000Z", "2026-10-19T07:00:00.000Z");
/** The same days through a different window — the month lens, say. Never fetched. */
const SLOTS_MONTH = slotsKey("2026-09-28T07:00:00.000Z", "2026-11-09T08:00:00.000Z");

function wipe() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetOwingForTests();
}

function task(over: Partial<Task> & Pick<Task, "id">): Task {
  return {
    user_id: "u",
    created_at: "2026-10-01T18:00:00+00:00",
    updated_at: "2026-10-01T18:00:00+00:00",
    title: "A block",
    notes: "",
    status: "planned",
    do_date: "2026-10-15",
    start_time: "2026-10-15T16:00:00+00:00",
    duration_minutes: 60,
    deadline: null,
    priority: "none",
    roll_count: 0,
    completed_at: null,
    trashed_at: null,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    key_result_id: null,
    sprint_id: null,
    big_rock_id: null,
    energy: null,
    assignee: "me",
    prework: "",
    prework_at: null,
    suggestion: null,
    suggested_at: null,
    google_event_id: null,
    sort_order: 0,
    slot_id: null,
    parent_task_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    task_labels: [],
    ...over,
  } as Task;
}

function slot(over: Partial<Slot> & Pick<Slot, "id">): Slot {
  return {
    user_id: "u",
    created_at: "2026-10-01T18:00:00+00:00",
    updated_at: "2026-10-01T18:00:00+00:00",
    title: "Deep work",
    do_date: "2026-10-15",
    start_time: "2026-10-15T16:00:00+00:00",
    duration_minutes: 120,
    project_id: null,
    domain_id: null,
    color: null,
    google_event_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    ...over,
  };
}

function client() {
  const qc = new QueryClient();
  installOwingGuards(qc);
  return qc;
}

const ids = (qc: QueryClient, key: readonly unknown[]) =>
  (qc.getQueryData<{ id: string }[]>(key) ?? []).map((r) => r.id).sort();

/** What `prefetchCalendarRange` does: no owing gate, and the 60s window has passed. */
const prefetch = <T>(qc: QueryClient, key: readonly unknown[], server: T[]) =>
  qc.prefetchQuery({ queryKey: key, staleTime: 0, queryFn: async () => server });

beforeEach(async () => {
  wipe();
  await refreshOwing();
});

describe("a queued delete is not undone by a snapshot that predates it", () => {
  it("keeps a deleted slot off the week the calendar prefetches", async () => {
    const qc = client();
    const server = [slot({ id: "sitting" }), slot({ id: "kept", start_time: "2026-10-16T16:00:00+00:00" })];
    qc.setQueryData(SLOTS_THIS_WEEK, server);

    // `removeSlot`: off every range now, the delete queued behind it.
    putSlotInCaches(qc, "sitting", null);
    await queueWrite(makeOp("slots", "delete", "sitting"));

    await prefetch(qc, SLOTS_THIS_WEEK, server);

    expect(ids(qc, SLOTS_THIS_WEEK), "the deleted slot came back from a stale snapshot").toEqual(["kept"]);
  });

  it("keeps it out of a range fetched for the first time", async () => {
    const qc = client();
    qc.setQueryData(SLOTS_THIS_WEEK, [slot({ id: "sitting" })]);
    putSlotInCaches(qc, "sitting", null);
    await queueWrite(makeOp("slots", "delete", "sitting"));

    // No previous list to compare against — the delete alone has to decide.
    await prefetch(qc, SLOTS_MONTH, [slot({ id: "sitting" }), slot({ id: "other" })]);

    expect(ids(qc, SLOTS_MONTH)).toEqual(["other"]);
  });

  it("keeps a removed step off its checklist", async () => {
    const qc = client();
    const steps = ["tasks", "steps", "parent"] as const;
    const server = [
      task({ id: "step-1", parent_task_id: "parent", start_time: null, do_date: null }),
      task({ id: "step-2", parent_task_id: "parent", start_time: null, do_date: null }),
    ];
    qc.setQueryData(steps, server);

    // `removeStep`.
    putTaskInCaches(qc, "step-2", null);
    await queueWrite(makeOp("tasks", "delete", "step-2"));

    await qc.fetchQuery({ queryKey: steps, staleTime: 0, queryFn: async () => server });

    expect(ids(qc, steps)).toEqual(["step-1"]);
  });

  it("does not hold a deleted row as a local-only extra either", async () => {
    await queueWrite(makeOp("tasks", "delete", "purged"));

    // A list that still had it (the unfiltered pool keeps trashed rows) and a
    // refetch that no longer does: the delete is not a reason to keep it.
    const merged = preserveOwingRows("tasks", [task({ id: "purged", status: "trashed" })], []);

    expect(merged).toEqual([]);
  });

  it("admits a recreate of the same id — the row lives again on this device", async () => {
    await queueWrite(makeOp("tasks", "delete", "same-id"));
    await queueWrite(makeOp("tasks", "insert", "same-id", { title: "Again" }));

    const merged = preserveOwingRows("tasks", undefined, [task({ id: "same-id" })]);

    expect(merged.map((r) => r.id)).toEqual(["same-id"]);
  });

  it("lets the row back in once the delete is no longer queued", async () => {
    const qc = client();
    qc.setQueryData(SLOTS_THIS_WEEK, [slot({ id: "sitting" })]);
    putSlotInCaches(qc, "sitting", null);
    await queueWrite(makeOp("slots", "delete", "sitting"));

    // Retired without the row going away (discarded, say): the server's word stands.
    await ack(await pendingOps());
    await refreshOwing();
    await prefetch(qc, SLOTS_THIS_WEEK, [slot({ id: "sitting" })]);

    expect(ids(qc, SLOTS_THIS_WEEK)).toEqual(["sitting"]);
  });
});

describe("a queued move out of a list is not undone by a snapshot that predates it", () => {
  it("keeps a block dragged to next week off this week", async () => {
    const qc = client();
    const server = [task({ id: "dragged" }), task({ id: "stays", start_time: "2026-10-16T16:00:00+00:00" })];
    qc.setQueryData(THIS_WEEK, server);
    qc.setQueryData(NEXT_WEEK, []);

    // The drag: off this week, onto next, the update queued behind it.
    const moved = { start_time: "2026-10-22T16:00:00.000Z", do_date: "2026-10-22" };
    patchCaches(qc, "dragged", moved);
    await queueWrite(makeOp("tasks", "update", "dragged", moved));
    expect(ids(qc, NEXT_WEEK)).toEqual(["dragged"]);

    // The calendar warms the week it just left; the server hasn't seen the drag.
    await prefetch(qc, THIS_WEEK, server);

    expect(ids(qc, THIS_WEEK), "the block stands in both weeks").toEqual(["stays"]);
    expect(ids(qc, NEXT_WEEK)).toEqual(["dragged"]);
  });

  it("still admits a row the server moved in when this device owes nothing on it", async () => {
    const qc = client();
    qc.setQueryData(THIS_WEEK, []);
    await queueWrite(makeOp("tasks", "insert", "unrelated", { title: "Occurrence" }));

    await prefetch(qc, THIS_WEEK, [task({ id: "moved-on-phone" })]);

    expect(ids(qc, THIS_WEEK)).toEqual(["moved-on-phone"]);
  });
});
