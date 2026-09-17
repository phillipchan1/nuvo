import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";

import { resetIdbForTests } from "../../src/lib/sync/idb";
import { enqueue } from "../../src/lib/sync/outbox";
import { refreshOwing, resetOwingForTests, settleWrite, syncNow } from "../../src/lib/sync/coordinator";
import { resetLiveHealthForTests, setTableLive } from "../../src/lib/sync/liveHealth";
import { applyLiveChange } from "../../src/lib/sync/liveApply";
import { putTaskInCaches, sameTaskContent } from "../../src/hooks/useTasks";
import type { Task } from "../../src/lib/types";

/**
 * One tick used to cost a refetch of every task list, the whole account
 * included, plus three `buildVertical` passes: the optimistic patch, the
 * Realtime echo of our own write, and the post-drain refetch. These pin the
 * two that were pure repetition.
 */

function spyQc() {
  const qc = new QueryClient();
  const invalidated: unknown[] = [];
  qc.invalidateQueries = ((args: { queryKey: unknown }) => {
    invalidated.push(args.queryKey);
    return Promise.resolve();
  }) as typeof qc.invalidateQueries;
  return { qc, invalidated };
}

const ok = { send: async () => ({ ok: true as const }) };

function task(over: Partial<Task> & Pick<Task, "id">): Task {
  return {
    user_id: "u",
    created_at: "2026-09-10T20:00:00+00:00",
    updated_at: "2026-09-17T15:00:00+00:00",
    title: "Write the FAQ",
    notes: "",
    status: "planned",
    do_date: "2026-09-17",
    start_time: "2026-09-17T16:00:00+00:00",
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
    sort_order: 3,
    slot_id: null,
    parent_task_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    task_labels: [],
    ...over,
  };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetOwingForTests();
  resetLiveHealthForTests();
});

describe("settleWrite", () => {
  it("skips the refetch while the table's Realtime channel is joined", async () => {
    const { qc, invalidated } = spyQc();
    await refreshOwing();
    setTableLive("tasks", true);
    settleWrite(qc, "tasks", ["tasks"]);
    expect(invalidated).toEqual([]);
  });

  it("falls back to a refetch when the channel is down", async () => {
    const { qc, invalidated } = spyQc();
    await refreshOwing();
    settleWrite(qc, "tasks", ["tasks"]);
    expect(invalidated).toEqual([["tasks"]]);
  });
});

describe("syncNow after a delivered task write", () => {
  it("does not refetch every task list when the echo will settle it", async () => {
    const { qc, invalidated } = spyQc();
    setTableLive("tasks", true);
    await enqueue({ table: "tasks", kind: "update", rowId: "a", payload: { status: "done" }, ts: new Date().toISOString() });
    await refreshOwing();
    await syncNow({ qc, transport: ok });
    expect(invalidated).not.toContainEqual(["tasks"]);
  });

  it("still refetches when Realtime is down", async () => {
    const { qc, invalidated } = spyQc();
    await enqueue({ table: "tasks", kind: "update", rowId: "a", payload: { status: "done" }, ts: new Date().toISOString() });
    await refreshOwing();
    await syncNow({ qc, transport: ok });
    expect(invalidated).toContainEqual(["tasks"]);
  });
});

describe("the echo of our own write", () => {
  it("leaves every list's identity alone when it says what the cache already says", () => {
    const qc = new QueryClient();
    const row = task({ id: "faq", status: "done", completed_at: "2026-09-17T15:00:00.000Z" });
    const day = [row];
    const all = [row];
    qc.setQueryData(["tasks", "day", "2026-09-17"], day);
    qc.setQueryData(["tasks", "all"], all);

    // Realtime: bare row (no joins), newer updated_at, `Z`-style instants.
    const { task_labels: _labels, ...bare } = row;
    applyLiveChange(qc, {
      table: "tasks",
      eventType: "UPDATE",
      new: {
        ...bare,
        updated_at: "2026-09-17T15:00:02.000Z",
        start_time: "2026-09-17T16:00:00.000Z",
        created_at: "2026-09-10T20:00:00.000Z",
        field_ts: { status: "2026-09-17T15:00:00.000Z" },
      },
      old: null,
    });

    expect(qc.getQueryData(["tasks", "day", "2026-09-17"])).toBe(day);
    expect(qc.getQueryData(["tasks", "all"])).toBe(all);
  });

  it("still paints a change another device made", () => {
    const qc = new QueryClient();
    const row = task({ id: "faq" });
    qc.setQueryData(["tasks", "all"], [row]);
    putTaskInCaches(qc, "faq", { ...row, title: "Write the FAQ (v2)" });
    expect(qc.getQueryData<Task[]>(["tasks", "all"])![0].title).toBe("Write the FAQ (v2)");
  });

  it("sameTaskContent ignores bookkeeping only", () => {
    const a = task({ id: "x" });
    expect(sameTaskContent(a, { ...a, updated_at: "2030-01-01T00:00:00Z" })).toBe(true);
    expect(sameTaskContent(a, { ...a, sort_order: 4 })).toBe(false);
    expect(sameTaskContent(a, { ...a, task_labels: [{ label_id: "l" }] })).toBe(false);
  });
});

describe("drain — an op queued mid-pass", () => {
  it("still goes out, instead of waiting for the next focus", async () => {
    const { drain } = await import("../../src/lib/sync/engine");
    const { pendingOps } = await import("../../src/lib/sync/outbox");
    const sent: string[] = [];
    let queuedBehind = false;
    const transport = {
      send: async (op: { rowId: string }) => {
        sent.push(op.rowId);
        if (!queuedBehind) {
          queuedBehind = true;
          // The task insert lands in the outbox while the label is on the wire,
          // and its own queueWrite asks for a drain.
          await enqueue({ table: "tasks", kind: "insert", rowId: "task", payload: { title: "Call Dana" }, ts: new Date().toISOString() });
          void drain(transport as never);
        }
        return { ok: true as const };
      },
    };
    await enqueue({ table: "labels", kind: "insert", rowId: "label", payload: { name: "calls" }, ts: new Date().toISOString() });
    await drain(transport as never);
    expect(sent).toEqual(["label", "task"]);
    expect(await pendingOps()).toEqual([]);
  });
});
