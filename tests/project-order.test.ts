import { describe, expect, it } from "vitest";
import { composeWeek } from "../src/lib/compose";
import type { Task } from "../src/lib/types";

const WEEK = "2026-07-27"; // Monday
const t = (id: string, mins: number, o: Partial<Task> = {}): Task =>
  ({
    id,
    title: id,
    duration_minutes: mins,
    project_id: "p1",
    energy: null,
    deadline: null,
    initiative_id: null,
    domain_id: null,
    sort_order: 0,
    start_time: null,
    status: "backlog",
    ...o,
  }) as unknown as Task;

const day = (i: number) => `2026-07-2${7 + i}`.slice(0, 10);
/** A meeting, as composeWeek reads them. */
const ev = (iso: string, fromH: number, toH: number) =>
  ({
    id: `${iso}-${fromH}`,
    title: "busy",
    busy: true,
    all_day: false,
    start_at: `${iso}T${String(fromH).padStart(2, "0")}:00:00`,
    end_at: `${iso}T${String(toH).padStart(2, "0")}:00:00`,
  }) as never;

/**
 * The shape that produced the bug: Monday has a two-hour morning, Tue–Thu are
 * solid, Friday is wide open. A project's big part 1 can't fit Monday so it
 * falls through to Friday — while its small part 2 happily takes Monday, leaving
 * the week asking for step 2 before step 1.
 */
const FRAGMENTED = [ev(day(0), 10, 17), ev(day(1), 8, 17), ev(day(2), 8, 17), ev(day(3), 8, 17)];

const run = (tasks: Task[], events: unknown[] = []) =>
  composeWeek({
    weekStartISO: WEEK,
    todayISO: WEEK,
    now: new Date(`${WEEK}T05:00:00`),
    tasks,
    events: events as never[],
    blocks: [],
    workStartMin: 8 * 60,
    workEndMin: 17 * 60,
    focusInitiativeIds: [],
    dayContexts: {},
    workingDays: [1, 2, 3, 4, 5],
    weeklyBudgetMins: null,
  });

const at = (r: ReturnType<typeof run>, id: string) => r.placements.find((p) => p.task.id === id)!;
const order = (p: { dayISO: string; startMin: number }) => `${p.dayISO}#${String(p.startMin).padStart(4, "0")}`;

describe("a project's pieces run in their own order", () => {
  it("never places a later part before an earlier one", () => {
    // part 1 is the big one — greedy placement used to strand it late in the week
    // while the small part 2 took Monday morning.
    const r = run(
      [t("part1", 180, { sort_order: 0, energy: "deep" }), t("part2", 30, { sort_order: 1, energy: "deep" })],
      FRAGMENTED,
    );
    expect(at(r, "part1")).toBeDefined();
    expect(at(r, "part2")).toBeDefined();
    expect(order(at(r, "part1")) < order(at(r, "part2"))).toBe(true);
  });

  it("keeps three parts in sequence", () => {
    const r = run([
      t("a", 90, { sort_order: 0 }),
      t("b", 90, { sort_order: 1 }),
      t("c", 90, { sort_order: 2 }),
    ]);
    const [a, b, c] = ["a", "b", "c"].map((id) => order(at(r, id)));
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it("does not chain across different projects", () => {
    const r = run([t("p1only", 60, { sort_order: 0 }), t("p2only", 60, { project_id: "p2", sort_order: 0 })]);
    // both should still find a place; the constraint is per-project, not global
    expect(r.placements).toHaveLength(2);
  });
});
