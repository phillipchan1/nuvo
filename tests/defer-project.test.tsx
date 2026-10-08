// @vitest-environment jsdom
/**
 * The deferral as ONE act — span, calendar, undo.
 *
 * `tests/project-time.test.ts` proves the kernel picks the right blocks and
 * work. This drives the real `useDeferProject` over fixture caches and asserts
 * the composition: the span is written, the block is removed, the work loses
 * its day AND its time, and a single undo puts every piece back — with the work
 * pointed at the block that replaced the one it was in (a slot's id is minted on
 * create, so a restored block is a new row).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

const calls = {
  project: [] as { id: string; patch: Record<string, unknown> }[],
  task: [] as { id: string; patch: Record<string, unknown> }[],
  removed: [] as string[],
  created: [] as Record<string, unknown>[],
  undo: [] as { label: string; undo: () => void }[],
};

vi.mock("../src/hooks/useTasks", () => ({
  useAllTasks: () => ({ data: undefined }),
  useTaskMutations: () => ({
    patchTask: (id: string, patch: Record<string, unknown>) => calls.task.push({ id, patch }),
  }),
}));
vi.mock("../src/hooks/useSlots", () => ({
  slotsKey: (a: string, b: string) => ["slots", a, b],
  fetchSlotsRange: async () => [],
  useSlots: () => ({ data: undefined }),
  useSlotMutations: () => ({
    removeSlot: (s: { id: string }) => calls.removed.push(s.id),
    createSlot: (input: Record<string, unknown>) => {
      calls.created.push(input);
      return { ...input, id: `reborn-${calls.created.length}` };
    },
  }),
}));
vi.mock("../src/hooks/useUndoStack", () => ({
  useOptionalUndoStack: () => ({
    recordUndo: (e: { label: string; undo: () => void }) => calls.undo.push(e),
  }),
}));
const store = {
  data: { projects: [], sprint: null },
  updateProject: (id: string, patch: Record<string, unknown>) => calls.project.push({ id, patch }),
};
vi.mock("../src/hooks/useVertical", () => ({ useOptionalVertical: () => store }));

import { useDeferProject } from "../src/hooks/useProjectTime";
import { toDateISO } from "../src/lib/dates";
import { mondayOf } from "../supabase/functions/_shared/planningRules.ts";
import type { Project } from "../src/lib/vertical";

const TODAY = startOfDay(new Date());
const todayISO = toDateISO(TODAY);
const WEEK = mondayOf(todayISO);
const at = (h: number) => new Date(TODAY.getTime() + h * 3_600_000).toISOString();

const PROJECT = {
  id: "p1",
  name: "Frontier Site",
  startDate: WEEK,
  targetDate: toDateISO(addDays(new Date(WEEK + "T12:00:00"), 4)),
  status: "in_progress",
  shippedAt: null,
} as unknown as Project;

const SLOT = {
  id: "s1",
  title: "",
  project_id: "p1",
  domain_id: "d1",
  color: null,
  do_date: todayISO,
  start_time: at(14),
  duration_minutes: 120,
  recurrence_id: null,
};

const TASKS = [
  { id: "a", project_id: "p1", status: "planned", do_date: todayISO, start_time: null, slot_id: "s1", parent_task_id: null },
  { id: "b", project_id: "p1", status: "planned", do_date: todayISO, start_time: at(17), slot_id: null, parent_task_id: null },
  { id: "done", project_id: "p1", status: "done", do_date: todayISO, start_time: null, slot_id: "s1", parent_task_id: null },
  { id: "loose", project_id: "p1", status: "backlog", do_date: null, start_time: null, slot_id: null, parent_task_id: null },
];

function mount() {
  const qc = new QueryClient();
  qc.setQueryData(["tasks", "all"], TASKS);
  qc.setQueryData(["slots", TODAY.toISOString(), "9999-12-31T00:00:00.000Z"], [SLOT]);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useDeferProject(), { wrapper });
}

beforeEach(() => {
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k].length = 0;
});

const RELEASED = { do_date: null, start_time: null, slot_id: null, status: "backlog" };

describe("taking a project off the week", () => {
  it("writes the span, removes the block, and releases the work — day and time", async () => {
    const { result } = mount();
    await act(() => result.current.takeOff(PROJECT, WEEK));

    expect(calls.project).toEqual([{ id: "p1", patch: { startDate: null, targetDate: null } }]);
    expect(calls.removed).toEqual(["s1"]);
    expect(calls.task).toEqual([
      { id: "a", patch: RELEASED },
      { id: "b", patch: RELEASED },
    ]);
  });

  it("never moves done work or work that had no time", async () => {
    const { result } = mount();
    await act(() => result.current.takeOff(PROJECT, WEEK));
    expect(calls.task.map((c) => c.id)).not.toContain("done");
    expect(calls.task.map((c) => c.id)).not.toContain("loose");
  });

  it("is ONE undo, and its label says what came off the calendar", async () => {
    const { result } = mount();
    await act(() => result.current.takeOff(PROJECT, WEEK));
    expect(calls.undo).toHaveLength(1);
    expect(calls.undo[0].label).toMatch(/^Took “Frontier Site” off the week — .+ and 2 tasks off the calendar$/);
  });

  it("undo restores the span, the block, and each piece into the block that replaced it", async () => {
    const { result } = mount();
    await act(() => result.current.takeOff(PROJECT, WEEK));
    calls.project.length = 0;
    calls.task.length = 0;

    act(() => calls.undo[0].undo());

    expect(calls.project).toEqual([
      { id: "p1", patch: { startDate: PROJECT.startDate, targetDate: PROJECT.targetDate, status: "in_progress" } },
    ]);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]).toMatchObject({ project_id: "p1", start_time: SLOT.start_time, duration_minutes: 120 });
    expect(calls.task).toEqual([
      { id: "a", patch: { status: "planned", do_date: todayISO, start_time: null, slot_id: "reborn-1" } },
      { id: "b", patch: { status: "planned", do_date: todayISO, start_time: at(17), slot_id: null } },
    ]);
  });

  it("keeps the status a surface writes alongside (the deck shelves to backlog)", async () => {
    const { result } = mount();
    await act(() => result.current.takeOff(PROJECT, WEEK, { status: "backlog" }));
    expect(calls.project[0].patch).toEqual({ startDate: null, targetDate: null, status: "backlog" });
  });
});

describe("moving a project to next week", () => {
  it("moves the span a week and clears the rest of this one", async () => {
    const { result } = mount();
    await act(() => result.current.pushOut(PROJECT, WEEK));
    const next = toDateISO(addDays(new Date(WEEK + "T12:00:00"), 7));
    expect(calls.project[0].patch).toMatchObject({ startDate: next });
    expect(calls.removed).toEqual(["s1"]);
    expect(calls.task.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("freeing just one block", () => {
  it("leaves the project's span alone and releases only what the block held", () => {
    const { result } = mount();
    act(() => result.current.freeSlot(SLOT as never));
    expect(calls.project).toEqual([]);
    expect(calls.removed).toEqual(["s1"]);
    expect(calls.task).toEqual([{ id: "a", patch: RELEASED }]);
    expect(calls.undo[0].label).toMatch(/^Freed .+ — 1 task loose again$/);
  });
});
