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

/**
 * The week that produced the "it says these don't fit — look how much free space
 * is on the calendar" report. Mornings are open all week; the afternoons fill
 * up in queue order, so the last project's part 1 takes Friday's final slot —
 * and its part 2, which may only start after it, falls off the end of the week.
 *
 * Placement is greedy, so the only cure is to seat a project as a **set**: give
 * the whole thing back and start it again from the top of the week.
 */
describe("a project is seated as a set", () => {
  // The `day()` above is only correct for the first three days; these cases need
  // Thursday and Friday to be real.
  const d = (i: number) => ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"][i];
  /** A meeting given in minutes-from-midnight, so half hours are expressible. */
  const evAt = (iso: string, fromM: number, toM: number) =>
    ({
      id: `${iso}-${fromM}`, title: "busy", busy: true, all_day: false,
      start_at: `${iso}T${String(Math.floor(fromM / 60)).padStart(2, "0")}:${String(fromM % 60).padStart(2, "0")}:00`,
      end_at: `${iso}T${String(Math.floor(toM / 60)).padStart(2, "0")}:${String(toM % 60).padStart(2, "0")}:00`,
    }) as never;

  it("re-seats a project rather than stranding its later part", () => {
    // mornings free every day; Mon–Thu offer one afternoon slot, Friday's is last
    const events = [
      ...[0, 1, 2, 3].flatMap((i) => [evAt(d(i), 720, 780), evAt(d(i), 930, 1020)]),
      evAt(d(4), 720, 875),
    ];
    // four other projects soak up Mon–Thu's afternoons before this one is reached
    const others = [0, 1, 2, 3].map((i) =>
      t(`other${i}`, 120, { id: `other${i}`, project_id: `p${i}`, sort_order: 0 }),
    );
    const r = run(
      [
        ...others,
        t("part1", 120, { sort_order: 0, project_id: "z1" }),
        t("part2", 90, { sort_order: 1, project_id: "z1" }),
      ],
      events,
    );
    expect(r.unplaced).toHaveLength(0);
    expect(order(at(r, "part1")) < order(at(r, "part2"))).toBe(true);
  });

  it("never claims the week is full while hours of it are open", () => {
    // one 5h block against days that only ever offer under 4h — a real refusal,
    // but "the week is full" is a lie when 19 hours of it are open
    const r = run([t("huge", 300, { sort_order: 0 })], [0, 1, 2, 3, 4].map((i) => evAt(d(i), 720, 1020)));
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0].reason).toMatch(/unbroken/);
    expect(r.unplaced[0].reason).not.toMatch(/week is full/);
  });
});

/**
 * The buffer that deleted the week.
 *
 * Ten minutes either side of every meeting used to be subtracted from busy time,
 * which made it a hard wall: a clean 8–10 gap between two meetings measures 120
 * minutes and offered 110, so a two-hour sitting fit nowhere, five days running,
 * and the plan reported "the week is full" over an open calendar.
 */
describe("breathing room is a preference, not a wall", () => {
  const d = (i: number) => ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"][i];
  const evAt = (iso: string, fromM: number, toM: number) =>
    ({
      id: `${iso}-${fromM}`, title: "busy", busy: true, all_day: false,
      start_at: `${iso}T${String(Math.floor(fromM / 60)).padStart(2, "0")}:${String(fromM % 60).padStart(2, "0")}:00`,
      end_at: `${iso}T${String(Math.floor(toM / 60)).padStart(2, "0")}:${String(toM % 60).padStart(2, "0")}:00`,
    }) as never;

  it("places a 2h sitting in an exactly-2h gap rather than refusing it", () => {
    // 10:00 standup every day, nothing else — the gap is 8:00–10:00, dead on
    const events = [0, 1, 2, 3, 4].flatMap((i) => [evAt(d(i), 600, 630), evAt(d(i), 660, 1020)]);
    const r = run([t("sitting", 120, { sort_order: 0 })], events);
    expect(r.unplaced).toHaveLength(0);
    expect(at(r, "sitting").startMin).toBe(8 * 60);
  });

  it("still leaves the cushion when the gap can afford it", () => {
    // a 3h morning for a 1h block — no reason to sit flush against the 11:00
    const events = [0, 1, 2, 3, 4].flatMap((i) => [evAt(d(i), 660, 720), evAt(d(i), 780, 1020)]);
    const r = run([t("roomy", 60, { sort_order: 0, energy: "deep" })], events);
    expect(r.unplaced).toHaveLength(0);
    expect(at(r, "roomy").startMin + 60).toBeLessThanOrEqual(11 * 60 - 10);
  });
});
