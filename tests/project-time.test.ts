// Deferring a project clears the calendar it leaves behind.
//
// The thing being protected: **a project taken off a week must not leave its
// sitting on the grid.** "Take it off this week" used to write the span and
// stop — the slate forgot the project while Thursday still promised it, and the
// nightly rollover then carried that work into Today each morning. The kernel
// now decides WHICH blocks and WHICH work come off (`clearProjectTime`), and
// every surface that defers a project applies that one plan.
//
// Run: npm test

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  clearProjectTime,
  clearSlotTime,
  deferralClearRange,
  releasedTaskPatch,
  type TimedSlot,
  type TimedTask,
} from "../supabase/functions/_shared/planningRules.ts";
import { costPhrase, costSentence, projectTimeCost, slotTimeCost } from "../src/lib/projectTime";
import type { Slot, Task } from "../src/lib/types";

const WEEK = "2026-10-05"; // a Monday
const THU = "2026-10-08";

const task = (id: string, over: Partial<TimedTask> = {}): TimedTask => ({
  id,
  projectId: "p1",
  status: "planned",
  doDate: null,
  slotId: null,
  ...over,
});
const slot = (id: string, doDate: string, over: Partial<TimedSlot> = {}): TimedSlot => ({
  id,
  projectId: "p1",
  doDate,
  recurring: false,
  ...over,
});

describe("which days a deferral clears", () => {
  it("taking a project off clears everything ahead — it has no week left", () => {
    expect(deferralClearRange("take_off", WEEK, THU)).toEqual({ fromISO: THU, toISO: null });
  });

  it("moving to next week clears only the rest of the week it leaves", () => {
    expect(deferralClearRange("next_week", WEEK, THU)).toEqual({ fromISO: THU, toISO: "2026-10-11" });
  });

  it("a week that hasn't started clears from its Monday, not from today", () => {
    expect(deferralClearRange("next_week", "2026-10-12", THU)).toEqual({ fromISO: "2026-10-12", toISO: "2026-10-18" });
  });
});

describe("clearProjectTime", () => {
  const slots = [
    slot("mon", "2026-10-05"), // already happened
    slot("thu", THU),
    slot("next", "2026-10-13"),
    slot("other", THU, { projectId: "p2" }),
    slot("standing", "2026-10-09", { recurring: true }),
  ];
  const tasks = [
    task("in-mon", { slotId: "mon", doDate: "2026-10-05" }),
    task("in-thu", { slotId: "thu", doDate: THU }),
    task("in-thu-done", { slotId: "thu", doDate: THU, status: "done" }),
    task("timed-fri", { doDate: "2026-10-09" }),
    task("in-standing", { slotId: "standing", doDate: "2026-10-09" }),
    task("in-next", { slotId: "next", doDate: "2026-10-13" }),
    task("loose"),
    task("foreign", { projectId: "p2", slotId: "other", doDate: THU }),
  ];

  it("clears the rest of this week and nothing that already happened", () => {
    const c = clearProjectTime("p1", deferralClearRange("next_week", WEEK, THU), tasks, slots);
    expect(c.removeSlotIds).toEqual(["thu"]);
    expect(c.emptySlotIds).toEqual(["standing"]);
    expect(c.taskIds.sort()).toEqual(["in-standing", "in-thu", "timed-fri"]);
  });

  it("off the week entirely reaches into the weeks ahead", () => {
    const c = clearProjectTime("p1", deferralClearRange("take_off", WEEK, THU), tasks, slots);
    expect(c.removeSlotIds.sort()).toEqual(["next", "thu"]);
    expect(c.taskIds).toContain("in-next");
  });

  it("never moves done work — a completed block is evidence", () => {
    const c = clearProjectTime("p1", { fromISO: WEEK, toISO: null }, tasks, slots);
    expect(c.taskIds).not.toContain("in-thu-done");
  });

  it("never deletes a recurring slot, only empties it", () => {
    const c = clearProjectTime("p1", { fromISO: WEEK, toISO: null }, tasks, slots);
    expect(c.removeSlotIds).not.toContain("standing");
  });

  it("never touches another project", () => {
    const c = clearProjectTime("p1", { fromISO: WEEK, toISO: null }, tasks, slots);
    expect(c.removeSlotIds).not.toContain("other");
    expect(c.taskIds).not.toContain("foreign");
  });

  it("a project with nothing on the calendar clears nothing (P7)", () => {
    expect(clearProjectTime("p1", { fromISO: THU, toISO: null }, [task("loose")], [])).toEqual({
      removeSlotIds: [],
      emptySlotIds: [],
      taskIds: [],
    });
  });
});

describe("clearSlotTime — free just this block", () => {
  it("releases everything live in the block, and removes it", () => {
    const c = clearSlotTime(slot("thu", THU), [
      task("a", { slotId: "thu" }),
      task("b", { slotId: "thu", status: "done" }),
      task("c", { slotId: "elsewhere" }),
    ]);
    expect(c).toEqual({ removeSlotIds: ["thu"], emptySlotIds: [], taskIds: ["a"] });
  });

  it("a recurring block is emptied, never removed", () => {
    const c = clearSlotTime(slot("s", THU, { recurring: true }), [task("a", { slotId: "s" })]);
    expect(c).toEqual({ removeSlotIds: [], emptySlotIds: ["s"], taskIds: ["a"] });
  });
});

describe("where released work rests", () => {
  it("project work goes back to the project, never the inbox", () => {
    expect(releasedTaskPatch(true)).toEqual({ do_date: null, start_time: null, slot_id: null, status: "backlog" });
  });
  it("a capture that was only riding the block goes back to the inbox", () => {
    expect(releasedTaskPatch(false).status).toBe("inbox");
  });
  it("clears the day, not just the time — a dated task is what the rollover carries into Today", () => {
    expect(releasedTaskPatch(true).do_date).toBeNull();
  });
});

describe("the cost, in words", () => {
  const at = (h: number) => new Date(2026, 9, 8, h, 0).toISOString();
  const row = (id: string, startH: number, mins: number): Slot =>
    ({ id, project_id: "p1", do_date: THU, start_time: at(startH), duration_minutes: mins, recurrence_id: null }) as Slot;
  const work = (id: string, over: Partial<Task> = {}): Task =>
    ({ id, project_id: "p1", status: "planned", do_date: THU, slot_id: "s1", parent_task_id: null, ...over }) as Task;

  it("names the block and counts the work", () => {
    const cost = projectTimeCost(
      "p1",
      { fromISO: THU, toISO: null },
      [work("a"), work("b"), work("c")],
      [row("s1", 14, 120)],
    );
    expect(costPhrase(cost)).toBe("Thu 2–4pm and 3 tasks");
    expect(costSentence(cost)).toBe("This takes Thu 2–4pm and 3 tasks off the calendar. The work stays in the project.");
  });

  it("past two blocks it counts the rest", () => {
    const cost = projectTimeCost(
      "p1",
      { fromISO: THU, toISO: null },
      [],
      [row("s1", 9, 60), row("s2", 11, 60), row("s3", 14, 60), row("s4", 16, 60)],
    );
    expect(costPhrase(cost)).toBe("Thu 9–10am, Thu 11am–12pm and 2 more blocks");
  });

  it("says nothing when nothing is on the calendar", () => {
    const cost = projectTimeCost("p1", { fromISO: THU, toISO: null }, [work("a", { do_date: null, slot_id: null })], []);
    expect(costPhrase(cost)).toBeNull();
    expect(costSentence(cost)).toBeNull();
  });

  it("a checklist step is not a task and is never counted", () => {
    const cost = projectTimeCost(
      "p1",
      { fromISO: THU, toISO: null },
      [work("a"), work("step", { parent_task_id: "a" })],
      [row("s1", 14, 120)],
    );
    expect(cost.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("a slot handed back by two range queries is one block", () => {
    const s = row("s1", 14, 120);
    expect(projectTimeCost("p1", { fromISO: THU, toISO: null }, [], [s, s]).removed).toHaveLength(1);
  });

  it("freeing one block costs only that block", () => {
    const cost = slotTimeCost(row("s1", 14, 120), [work("a"), work("elsewhere", { slot_id: "s2" })]);
    expect(costPhrase(cost)).toBe("Thu 2–4pm and 1 task");
  });
});

// ── the drift guard ──────────────────────────────────────────────────────────
// A bare span write is the bug. Five surfaces each took a project off a week
// with their own `{ startDate: null, targetDate: null }` and none of them
// touched the calendar. They all go through `useDeferProject` now; this fails
// the moment a surface grows its own copy again.

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("taking a project off a week goes through one act", () => {
  const src = sourceFiles("src");

  it("no surface applies takeOffWeekPatch or pushToNextWeekPatch itself", () => {
    const offenders = src.filter(
      (f) =>
        !f.endsWith("hooks/useProjectTime.ts") &&
        /\b(takeOffWeekPatch|pushToNextWeekPatch)\s*\(/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("no surface clears a project's span by hand", () => {
    const offenders = src.filter(
      (f) =>
        !f.includes("Harness") &&
        /updateProject\([^)]*startDate:\s*null,\s*targetDate:\s*null/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the agent clears the calendar through the same kernel plan", () => {
    const tools = readFileSync("supabase/functions/agent/tools.ts", "utf8");
    expect(tools).toMatch(/clearProjectTime\(/);
    expect(tools).toMatch(/releasedTaskPatch\(/);
  });
});
