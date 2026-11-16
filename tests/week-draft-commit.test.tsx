// @vitest-environment jsdom
/**
 * The plan's finish (`useWeekDraft.commit`) — driven through the real hook over
 * a mocked store, so each assertion is about what the finish asks the store to
 * write.
 *
 * Confirmed bugs (hardening audit, 2026-11):
 *   · a plan opened on NEXT week (late Friday) committed into THIS week's sprint
 *   · a failed write left `applying` stuck true — the planner wedged for good
 *   · the finish raced a block still being saved (D-217) and wrote it twice
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildVertical } from "../src/lib/vertical";
import type { Task } from "../src/lib/types";

const NEXT_WEEK = "2026-11-16";

const TASK = {
  id: "t1",
  title: "Write the brief",
  status: "backlog",
  project_id: null,
  initiative_id: null,
  domain_id: null,
  do_date: null,
  start_time: null,
  sprint_id: null,
  slot_id: null,
  recurrence_id: null,
  duration_minutes: 60,
  deadline: null,
  sort_order: 0,
  completed_at: null,
} as unknown as Task;

const store = {
  data: buildVertical([], [], [], [TASK], null, new Date("2026-11-14T00:50:00.000Z")),
  planWeek: vi.fn(async (_input: unknown) => {}),
  applySlots: vi.fn(async (_specs: unknown, _opts?: unknown) => [] as string[]),
  assignToStanding: vi.fn(async (_specs: unknown, _opts?: unknown) => {}),
  unplanTask: vi.fn(),
};

vi.mock("../src/hooks/useVertical", () => ({ useVertical: () => store }));
vi.mock("../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { work_start_minutes: 480, work_end_minutes: 990 }, update: vi.fn() }),
}));
vi.mock("../src/hooks/useWorkingDays", () => ({ useWorkingDays: () => [[1, 2, 3, 4, 5], vi.fn()] }));
vi.mock("../src/hooks/useCalendar", () => ({ useExternalEvents: () => ({ data: [] }) }));
vi.mock("../src/hooks/useSlots", () => ({
  useSlotMutations: () => ({ updateSlot: vi.fn(), removeSlot: vi.fn() }),
  useSlots: () => ({ data: [] }),
  useSlotTasks: () => ({ data: [] }),
}));
const ALL = [TASK];
vi.mock("../src/hooks/useTasks", () => ({
  useAllTasks: () => ({ data: ALL }),
  useScheduledTasks: () => ({ data: [] }),
  useTaskMutations: () => ({ patchTask: vi.fn() }),
}));
vi.mock("../src/lib/supabase", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { placementKey, useWeekDraft } from "../src/hooks/useWeekDraft";

beforeEach(() => {
  store.planWeek.mockReset().mockImplementation(async () => {});
  store.applySlots.mockReset().mockImplementation(async () => []);
  store.assignToStanding.mockReset().mockImplementation(async () => {});
  // Friday 2026-11-13, 4:50pm in the app's zone — the plan opens on next week
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T00:50:00.000Z"));
});
afterEach(() => vi.useRealTimers());

async function draftWithBlock(saveAsYouGo = false) {
  const hook = renderHook(() => useWeekDraft({ autoTheme: false, weekStartISO: NEXT_WEEK, saveAsYouGo }));
  act(() => hook.result.current.setKept(new Set(["t1"])));
  await waitFor(() => expect(hook.result.current.placements.map((p) => p.task.id)).toContain("t1"));
  return hook;
}

describe("the plan's finish", () => {
  it("commits into the sprint of the week being planned", async () => {
    const { result } = await draftWithBlock();
    await act(() => result.current.commit());
    expect(store.planWeek).toHaveBeenCalledTimes(1);
    expect(store.planWeek.mock.calls[0][0]).toMatchObject({ weekStartISO: NEXT_WEEK, commitTaskIds: ["t1"] });
    expect(result.current.committed).toBe(true);
  });

  it("a failed write rejects and never leaves the planner stuck applying", async () => {
    store.planWeek.mockImplementation(async () => {
      throw new Error("offline");
    });
    const { result } = await draftWithBlock();
    let caught: unknown = null;
    await act(async () => {
      await result.current.commit().catch((e) => (caught = e));
    });
    expect((caught as Error)?.message).toBe("offline");
    expect(result.current.applying).toBe(false);
    expect(result.current.committed).toBe(false);
  });

  it("waits for a block still being saved, and doesn't write it a second time", async () => {
    let release!: () => void;
    const saving = new Promise<void>((r) => (release = r));
    store.planWeek.mockImplementationOnce(async () => saving); // the save-as-you-go write
    const { result } = await draftWithBlock(true);
    const key = placementKey(result.current.placements.find((p) => p.task.id === "t1")!);

    act(() => result.current.holdPlacement(key)); // accepting it saves it (D-217)
    await waitFor(() => expect(store.planWeek).toHaveBeenCalledTimes(1));
    expect(store.planWeek.mock.calls[0][0]).toMatchObject({ weekStartISO: NEXT_WEEK, stamp: false });

    let finished = false;
    let commitP!: Promise<void>;
    act(() => {
      commitP = result.current.commit().then(() => {
        finished = true;
      });
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    // the finish is waiting on the save — it has written nothing of its own yet
    expect(store.planWeek).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);

    await act(async () => {
      release();
      await commitP;
    });
    expect(store.planWeek).toHaveBeenCalledTimes(2);
    const fin = store.planWeek.mock.calls[1][0] as { placements: { id: string }[]; weekStartISO: string };
    expect(fin.weekStartISO).toBe(NEXT_WEEK);
    expect(fin.placements.map((p) => p.id)).not.toContain("t1"); // already on the calendar
    expect(store.applySlots).not.toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ taskIds: ["t1"] })]), expect.anything());
  });
});
