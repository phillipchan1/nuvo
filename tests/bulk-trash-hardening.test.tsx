// @vitest-environment jsdom
/**
 * List and bulk acts an audit proved wrong, pinned:
 *  - trashing a repeating occurrence from a list, a key or the bulk bar let the
 *    series stamp it straight back — it must skip the occurrence (exdate), as
 *    the calendar's and the phone's "This event" do (`trashTaskScoped`);
 *  - bulk Done re-completed done rows (rewriting completed_at) and its undo
 *    reopened them;
 *  - bulk "Clear the date" left rows `planned` with no date (on no list), and
 *    "No project" left a homeless `backlog` row;
 *  - ticking a row and closing the list inside the bloom dropped the completion.
 */
import { readFileSync } from "node:fs";
import { act, render, renderHook } from "@testing-library/react";
import React, { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Recurrence, Task } from "../src/lib/types";

const REC = { id: "rec1", exdates: [] as string[] } as unknown as Recurrence;
const skipOccurrence = vi.fn();

vi.mock("../src/hooks/useRecurrence", () => ({
  useRecurrences: () => ({ data: [REC] }),
  useRecurrenceMutations: () => ({ skipOccurrence, deleteFollowing: vi.fn(), deleteSeries: vi.fn() }),
}));

const recorded: { undo: () => void; redo: () => void }[] = [];
vi.mock("../src/hooks/useUndoStack", async (orig) => ({
  ...(await orig<typeof import("../src/hooks/useUndoStack")>()),
  useOptionalUndoStack: () => ({ recordUndo: (e: { undo: () => void; redo: () => void }) => recorded.push(e) }),
}));

// The row's bloom is a real wait only when the material moves.
vi.mock("../src/lib/motion", async (orig) => ({
  ...(await orig<typeof import("../src/lib/motion")>()),
  motionOff: () => false,
  motionMs: () => 440,
}));

const { useBulkOps } = await import("../src/hooks/useBulkOps");
const { clearDatePatch, unfilePatch } = await import("../src/components/BulkBar");
const { default: TaskRow } = await import("../src/components/TaskRow");

const t = (over: Partial<Task>): Task =>
  ({
    id: "t",
    title: "t",
    status: "planned",
    do_date: "2026-11-16",
    start_time: null,
    slot_id: null,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    sprint_id: null,
    recurrence_id: null,
    recurrence_date: null,
    completed_at: null,
    task_labels: [],
    sort_order: 0,
    ...over,
  }) as Task;

function fakeMutations() {
  return {
    complete: vi.fn(),
    uncomplete: vi.fn(),
    trash: vi.fn(),
    patchTask: vi.fn(),
    backToInbox: vi.fn(),
    setLabels: vi.fn(),
  };
}

function bulk(selected: Task[]) {
  const mutations = fakeMutations();
  const { result } = renderHook(() =>
    useBulkOps({ selected, mutations: mutations as never, clear: () => {} }),
  );
  return { ops: result.current, mutations };
}

beforeEach(() => skipOccurrence.mockReset());

describe("trash on a repeating occurrence", () => {
  it("the bulk bar skips the occurrence as well as trashing the row", () => {
    const occ = t({ id: "o1", recurrence_id: "rec1", recurrence_date: "2026-11-18" });
    const plain = t({ id: "p1" });
    const { ops, mutations } = bulk([occ, plain]);
    ops.trash();
    expect(skipOccurrence).toHaveBeenCalledTimes(1);
    expect(skipOccurrence).toHaveBeenCalledWith(REC, "2026-11-18");
    expect(mutations.trash).toHaveBeenCalledTimes(2);
  });

  it("the rail's and every task list's trash key go through the same scoped act", () => {
    const rail = readFileSync("src/components/LeftRail.tsx", "utf8");
    const list = readFileSync("src/components/tasks/TaskListView.tsx", "utf8");
    for (const src of [rail, list]) {
      const act = src.match(/\btrash: \(targets\) =>[\s\S]{0,160}/)?.[0] ?? "";
      expect(act).toMatch(/trashTask\(t/);
      expect(act).not.toMatch(/mutations\.trash\(/);
    }
  });
});

describe("bulk Done", () => {
  it("completes only the open rows, and its undo reopens only those", () => {
    const open = t({ id: "a", status: "planned" });
    const done = t({ id: "b", status: "done", completed_at: "2026-11-01T10:00:00Z" });
    recorded.length = 0;
    const { ops, mutations } = bulk([open, done]);
    ops.complete();
    expect(mutations.complete).toHaveBeenCalledTimes(1);
    expect(mutations.complete.mock.calls[0][0].id).toBe("a");
    expect(recorded).toHaveLength(1);
    recorded[0].undo();
    expect(mutations.uncomplete.mock.calls.map((c) => c[0].id)).toEqual(["a"]);
  });

  it("all done already: nothing is rewritten and no undo is recorded", () => {
    recorded.length = 0;
    const { ops, mutations } = bulk([t({ status: "done" })]);
    ops.complete();
    expect(mutations.complete).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });
});

describe("bulk Clear the date / No project", () => {
  it("a planned row with its date cleared rests in the Inbox, or its home's backlog", () => {
    expect(clearDatePatch(t({ status: "planned" }))).toMatchObject({ do_date: null, status: "inbox" });
    expect(clearDatePatch(t({ status: "planned", project_id: "p" }))).toMatchObject({ do_date: null, status: "backlog" });
    // done work stays done
    expect(clearDatePatch(t({ status: "done" }))).not.toHaveProperty("status");
  });

  it("an unfiled backlog row goes to the Inbox, or stays in its domain's backlog", () => {
    expect(unfilePatch(t({ status: "backlog", do_date: null, project_id: "p" }))).toMatchObject({ project_id: null, status: "inbox" });
    expect(unfilePatch(t({ status: "backlog", do_date: null, project_id: "p", domain_id: "d" }))).not.toHaveProperty("status");
    // a planned row keeps its day
    expect(unfilePatch(t({ status: "planned", project_id: "p" }))).not.toHaveProperty("status");
  });

  it("patchAll writes each row's own patch", () => {
    const a = t({ id: "a", status: "planned" });
    const b = t({ id: "b", status: "planned", project_id: "p" });
    const { ops, mutations } = bulk([a, b]);
    ops.patchAll(clearDatePatch, "unscheduled");
    expect(mutations.patchTask.mock.calls.map((c) => [c[0], c[1].status])).toEqual([
      ["a", "inbox"],
      ["b", "backlog"],
    ]);
  });
});

describe("TaskRow: closing inside the bloom", () => {
  it("still completes the task it was ticking", () => {
    vi.useFakeTimers();
    try {
      const onToggleDone = vi.fn();
      const ref = createRef<{ triggerToggle: () => void }>();
      const view = render(
        <TaskRow ref={ref} task={t({ id: "r", status: "planned" })} labels={[]} selected={false} onSelect={() => {}} onOpen={() => {}} onToggleDone={onToggleDone} />,
      );
      act(() => ref.current!.triggerToggle());
      expect(onToggleDone).not.toHaveBeenCalled();
      view.unmount();
      expect(onToggleDone).toHaveBeenCalledTimes(1);
      vi.runAllTimers();
      expect(onToggleDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
