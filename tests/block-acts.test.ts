/**
 * Task and slot acts that both shells now share (D-177). The desktop menu and
 * popover and the phone's sheets call these; the phone used to delete one row
 * and nothing else, so a repeating occurrence came straight back.
 */
import { describe, expect, it, vi } from "vitest";
import { trashTaskScoped } from "../src/components/tasks/TaskActionsMenu";
import { applySlotRepeat, deleteSlotScoped, duplicateSlotInput, duplicateTaskInput } from "../src/lib/taskActs";
import type { Recurrence, Slot, Task } from "../src/lib/types";

const rec = { id: "r1", freq: "weekly", interval: 1, by_weekday: [3] } as unknown as Recurrence;
const task = { id: "t1", title: "Water plants", recurrence_id: "r1", recurrence_date: "2026-11-05", do_date: "2026-11-05", priority: "none", task_labels: [{ label_id: "l1" }] } as unknown as Task;
const slot = { id: "s1", title: "Deep work", do_date: "2026-11-05", start_time: "2026-11-05T17:00:00.000Z", duration_minutes: 90, recurrence_id: "r1", recurrence_date: "2026-11-05", project_id: null, domain_id: "d1", color: null } as unknown as Slot;

const recM = () => ({
  skipOccurrence: vi.fn(), deleteFollowing: vi.fn(), deleteSeries: vi.fn(),
  convertToSeries: vi.fn(), updateSeries: vi.fn(), stopSeries: vi.fn(),
});

describe("trashTaskScoped", () => {
  it("THIS skips the occurrence so the series won't stamp it back, then trashes it", () => {
    const m = { trash: vi.fn() }; const r = recM();
    trashTaskScoped(m as never, r as never, rec, task, "THIS");
    expect(r.skipOccurrence).toHaveBeenCalledWith(rec, "2026-11-05");
    expect(m.trash).toHaveBeenCalledWith(task);
  });
  it("FOLLOWING and ALL end the series", () => {
    const m = { trash: vi.fn() }; const r = recM();
    trashTaskScoped(m as never, r as never, rec, task, "FOLLOWING");
    expect(r.deleteFollowing).toHaveBeenCalledWith(rec, "2026-11-05");
    trashTaskScoped(m as never, r as never, rec, task, "ALL");
    expect(r.deleteSeries).toHaveBeenCalledWith(rec);
    expect(m.trash).not.toHaveBeenCalled();
  });
});

describe("deleteSlotScoped", () => {
  const mk = () => ({ slotMutations: { removeSlot: vi.fn() }, recurrenceMutations: recM(), taskMutations: { trash: vi.fn() } });
  const kids = [{ id: "a" }, { id: "b" }] as Task[];

  it("keeps the block's tasks unless asked", () => {
    const m = mk();
    deleteSlotScoped(m as never, slot, null, kids, "simple", false);
    expect(m.slotMutations.removeSlot).toHaveBeenCalledWith(slot);
    expect(m.taskMutations.trash).not.toHaveBeenCalled();
  });
  it("trashes them with it when asked", () => {
    const m = mk();
    deleteSlotScoped(m as never, slot, null, kids, "simple", true);
    expect(m.taskMutations.trash).toHaveBeenCalledTimes(2);
  });
  it("one occurrence of a series is skipped, not just removed", () => {
    const m = mk();
    deleteSlotScoped(m as never, slot, rec, [], "this", false);
    expect(m.recurrenceMutations.skipOccurrence).toHaveBeenCalledWith(rec, "2026-11-05");
    expect(m.slotMutations.removeSlot).toHaveBeenCalled();
  });
  it("following / series go through the series", () => {
    const m = mk();
    deleteSlotScoped(m as never, slot, rec, [], "following", false);
    deleteSlotScoped(m as never, slot, rec, [], "series", false);
    expect(m.recurrenceMutations.deleteFollowing).toHaveBeenCalledWith(rec, "2026-11-05");
    expect(m.recurrenceMutations.deleteSeries).toHaveBeenCalledWith(rec);
    expect(m.slotMutations.removeSlot).not.toHaveBeenCalled();
  });
});

describe("applySlotRepeat", () => {
  it("turns a one-off into a series, and stops one", () => {
    const r = recM();
    applySlotRepeat(r as never, slot, null, { freq: "weekly", interval: 1 } as never);
    expect(r.convertToSeries).toHaveBeenCalledWith("slot", slot, expect.anything(), expect.objectContaining({ duration_minutes: 90 }));
    applySlotRepeat(r as never, slot, rec, null);
    expect(r.stopSeries).toHaveBeenCalledWith(rec, "2026-11-05");
  });
});

describe("duplicates", () => {
  it("a task copy keeps its place and filing", () => {
    expect(duplicateTaskInput(task, "c1")).toMatchObject({ clientId: "c1", title: "Water plants", do_date: "2026-11-05", labelIds: ["l1"] });
    expect(duplicateTaskInput(task, "c1").priority).toBeUndefined();
  });
  it("a slot copy is the container only — and a one-off", () => {
    const d = duplicateSlotInput(slot);
    expect(d).toMatchObject({ title: "Deep work", duration_minutes: 90, domain_id: "d1" });
    expect(d).not.toHaveProperty("recurrence_id");
  });
});
