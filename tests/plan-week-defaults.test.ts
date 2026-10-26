// The placement defaults Plan the week composes before you touch anything
// (docs/plan-the-week-ux-review-2026-10-25.md §5, bet 1).
//
// The week that prompted them: an open Mon–Fri, nine to five-thirty, four
// projects — and every sitting landed Mon/Tue between 1pm and 4:30 while every
// morning and all of Wed–Fri stayed empty. Three rules answer it: project work
// takes the morning whatever its energy tag, the week is spread rather than
// front-loaded, and loose work is gathered by domain without waiting on the AI.

import { describe, expect, it } from "vitest";
import { composeWeek, draftableKept, isStaleBlock } from "../src/lib/compose";
import { batchLooseWork, clusterWeek } from "../src/lib/batch";
import { suggestPull } from "../src/lib/pull";
import type { VerticalData } from "../src/lib/vertical";
import type { Task } from "../src/lib/types";

const WEEK = "2026-10-26"; // Monday
const DAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
const NOON = 12 * 60 + 30;

const t = (id: string, mins: number, o: Partial<Task> = {}): Task =>
  ({
    id,
    title: id,
    duration_minutes: mins,
    project_id: null,
    energy: null,
    deadline: null,
    initiative_id: null,
    domain_id: null,
    sort_order: 0,
    start_time: null,
    status: "backlog",
    ...o,
  }) as unknown as Task;

/** A project sitting as the draft hands it over: one atomic block, no energy tag. */
const sitting = (id: string, mins: number, projectId: string, sortOrder = 0) =>
  t(id, mins, { project_id: projectId, sort_order: sortOrder });

const run = (tasks: Task[], atomicIds: string[] = [], o: { todayISO?: string; events?: unknown[] } = {}) =>
  composeWeek({
    weekStartISO: WEEK,
    todayISO: o.todayISO ?? WEEK,
    now: new Date(`${o.todayISO ?? WEEK}T05:00:00`),
    tasks,
    events: (o.events ?? []) as never[],
    blocks: [],
    workStartMin: 9 * 60,
    workEndMin: 17 * 60 + 30,
    focusInitiativeIds: [],
    dayContexts: {},
    workingDays: [1, 2, 3, 4, 5],
    weeklyBudgetMins: null,
    atomicIds,
  });

const at = (r: ReturnType<typeof run>, id: string) => r.placements.find((p) => p.task.id === id)!;

describe("project work takes the morning", () => {
  it("seats an untagged project sitting before noon on an open week", () => {
    const r = run([sitting("p", 120, "p1")], ["p"]);
    expect(at(r, "p").startMin).toBe(9 * 60);
    expect(at(r, "p").reason).toMatch(/morning/);
  });

  it("puts four projects in four mornings — not two afternoons", () => {
    // the reported week, exactly: four projects, nothing else on the calendar
    const ids = ["mkt", "billing", "garage", "talk"];
    const r = run(
      ids.map((id) => sitting(id, 120, id)),
      ids,
    );
    expect(r.unplaced).toHaveLength(0);
    for (const id of ids) expect(at(r, id).startMin + at(r, id).durationMin).toBeLessThanOrEqual(NOON);
    expect(new Set(ids.map((id) => at(r, id).dayISO)).size).toBe(4);
  });

  it("still sends untagged loose work to the afternoon", () => {
    const r = run([t("errand", 30)]);
    expect(at(r, "errand").startMin).toBeGreaterThanOrEqual(13 * 60);
  });
});

describe("the week is spread, not front-loaded", () => {
  it("gives a project at most one sitting a day while there's room", () => {
    const r = run(
      [sitting("a1", 120, "a", 0), sitting("a2", 120, "a", 1), sitting("a3", 120, "a", 2)],
      ["a1", "a2", "a3"],
    );
    const days = ["a1", "a2", "a3"].map((id) => at(r, id).dayISO);
    expect(new Set(days).size).toBe(3);
    // …and still in the project's own order
    expect([...days].sort()).toEqual(days);
  });

  it("leaves later days for a project's later sittings", () => {
    // Only Thu and Fri are open, and Friday has more room — so the spread alone
    // would hand part 1 Friday and strand part 2 off the end of the week
    const busy = (iso: string, from = "09:00", to = "17:30") => ({
      id: `${iso}-${from}`, title: "busy", busy: true, all_day: false,
      start_at: `${iso}T${from}:00`, end_at: `${iso}T${to}:00`,
    });
    const r = run(
      [sitting("b1", 90, "b", 0), sitting("b2", 90, "b", 1)],
      ["b1", "b2"],
      { events: [...DAYS.slice(0, 3).map((d) => busy(d)), busy(DAYS[3], "14:00", "17:30")] },
    );
    expect(r.unplaced).toHaveLength(0);
    expect(at(r, "b1").dayISO).toBe(DAYS[3]);
    expect(at(r, "b2").dayISO).toBe(DAYS[4]);
  });

  it("stacks a project's sittings on one day only when the week can't hold them apart", () => {
    // a one-day week: refusing the second sitting would be the app deciding
    const r = run(
      [sitting("c1", 60, "c", 0), sitting("c2", 60, "c", 1)],
      ["c1", "c2"],
      { todayISO: DAYS[4] },
    );
    expect(r.unplaced).toHaveLength(0);
    expect(at(r, "c1").dayISO).toBe(DAYS[4]);
    expect(at(r, "c2").dayISO).toBe(DAYS[4]);
  });

  it("spreads loose runs across the week instead of piling them on Monday", () => {
    const runs = ["r1", "r2", "r3"];
    const r = run(runs.map((id) => t(id, 60, { energy: "quick" })), runs);
    expect(new Set(runs.map((id) => at(r, id).dayISO)).size).toBe(3);
  });

  it("keeps overdue work in the first open slot", () => {
    const r = run([sitting("p", 120, "p1"), t("owed", 30, { deadline: "2026-10-20" })], ["p"]);
    expect(at(r, "owed").dayISO).toBe(DAYS[0]);
  });

  it("never spreads deadline work past its due day", () => {
    // Monday is crowded, so the spread prefers later days — but this is due Tuesday
    const crowd = { id: "m", title: "busy", busy: true, all_day: false, start_at: `${DAYS[0]}T09:00:00`, end_at: `${DAYS[0]}T15:00:00` };
    const r = run([t("due", 60, { deadline: DAYS[1] })], [], { events: [crowd] });
    expect(at(r, "due").dayISO <= DAYS[1]).toBe(true);
  });

  it("keeps a project's loose steps together on one day (Find Time's shape)", () => {
    // not sittings — one project's individual tasks. They belong in one context.
    const r = run([
      t("s1", 30, { project_id: "q", sort_order: 0 }),
      t("s2", 45, { project_id: "q", sort_order: 1 }),
      t("s3", 45, { project_id: "q", sort_order: 2 }),
    ]);
    expect(new Set(["s1", "s2", "s3"].map((id) => at(r, id).dayISO)).size).toBe(1);
  });
});

describe("loose work is gathered by domain", () => {
  const data = {
    domains: [
      { id: "home", name: "Home", color: "var(--d1)" },
      { id: "work", name: "Work", color: "var(--d2)" },
    ],
    projects: [{ id: "p1", name: "Launch", domainId: "work" }],
    initiatives: [],
  } as unknown as VerticalData;

  it("batches same-domain captures into one run and leaves a lone task alone", () => {
    const { batches, singles } = batchLooseWork(
      [
        t("plumber", 15, { domain_id: "home" }),
        t("filter", 15, { domain_id: "home" }),
        t("gutters", 20, { domain_id: "home" }),
        t("invoice", 15, { domain_id: "work" }),
      ],
      data,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].name).toBe("Home admin");
    expect(batches[0].taskIds.sort()).toEqual(["filter", "gutters", "plumber"]);
    expect(singles.map((s) => s.id)).toEqual(["invoice"]);
  });

  it("ignores project work and never collides with the project sittings' ids", () => {
    const project = clusterWeek([t("step", 60, { project_id: "p1" })], data);
    const { batches } = batchLooseWork(
      [t("step", 60, { project_id: "p1" }), t("a", 15, { domain_id: "home" }), t("b", 15, { domain_id: "home" })],
      data,
    );
    expect(batches.flatMap((b) => b.taskIds)).not.toContain("step");
    const ids = new Set(project.map((b) => b.id));
    for (const b of batches) expect(ids.has(b.id)).toBe(false);
  });
});

/**
 * The kept task that vanished. "Run" was a block missed on Oct 15 that rollover
 * never cleared: the pull offered it, you kept it, and the draft dropped it for
 * having a start_time — one that wasn't in this week's blocks either. It landed
 * nowhere and was reported nowhere. Its hour belongs to a week that's gone
 * (D-141), so the week takes it as unplaced work.
 */
describe("a missed block from a past week is placed fresh", () => {
  const LAST_WEEK = "2026-10-15T14:15:00+00:00";
  const THIS_WEEK = "2026-10-27T16:00:00+00:00";
  const missed = t("run", 40, { start_time: LAST_WEEK, status: "planned", recurrence_id: null } as Partial<Task>);

  it("knows a past week's hour from this week's", () => {
    expect(isStaleBlock(missed, WEEK)).toBe(true);
    expect(isStaleBlock({ start_time: THIS_WEEK, recurrence_id: null }, WEEK)).toBe(false);
    expect(isStaleBlock({ start_time: null, recurrence_id: null }, WEEK)).toBe(false);
  });

  it("never re-places a missed occurrence of a repeating series", () => {
    // the series already has this week's own occurrences (D-009) — re-placing
    // last week's Shutdown review put a second one on Wednesday
    const occurrence = t("shutdown", 15, { start_time: LAST_WEEK, recurrence_id: "series" } as Partial<Task>);
    expect(isStaleBlock(occurrence, WEEK)).toBe(false);
    expect(draftableKept([occurrence], new Set(["shutdown"]), WEEK)).toEqual([]);
  });

  it("hands the composer a kept stale block with its old time cleared", () => {
    const tasks = [
      missed,
      t("onCal", 30, { start_time: THIS_WEEK } as Partial<Task>), // already this week — stays put
      t("slotted", 30, { slot_id: "s1" } as Partial<Task>),
      t("finished", 30, { start_time: LAST_WEEK, status: "done" } as Partial<Task>),
      t("notKept", 30, { start_time: LAST_WEEK } as Partial<Task>),
      t("open", 30),
    ];
    const kept = new Set(["run", "onCal", "slotted", "finished", "open"]);
    const out = draftableKept(tasks, kept, WEEK);
    expect(out.map((x) => x.id).sort()).toEqual(["open", "run"]);
    expect(out.find((x) => x.id === "run")!.start_time).toBeNull();
    // the source row is untouched — the draft never mutates what it was given
    expect(missed.start_time).toBe(LAST_WEEK);
  });

  it("lands on this week's grid", () => {
    const r = run(draftableKept([missed], new Set(["run"]), WEEK));
    expect(r.unplaced).toHaveLength(0);
    expect(DAYS).toContain(at(r, "run").dayISO);
  });
});

describe("the pull never offers a repeating occurrence as presence work", () => {
  const vt = (id: string, mins: number, o: Record<string, unknown> = {}) => ({
    id, title: id, projectId: null, initiativeId: null, domainId: "fam", keyResultId: null,
    bigRockId: null, energy: null, durationMins: mins, deadlineDaysAway: null, status: "backlog",
    doDate: null, startTime: null, slotId: null, createdAt: null, completedAt: null,
    assignee: "me", rollCount: 0, sprint: false, inbox: false, ...o,
  });
  const data = (tasks: unknown[]) =>
    ({
      domains: [{ id: "fam", name: "Family", lastTouchedDays: 20, investedThisWeek: 0, weeklyTargetHours: 2, lastShip: null }],
      initiatives: [],
      projects: [],
      tasks,
      focusInitiativeIds: [],
    }) as unknown as VerticalData;

  it("offers the domain's one-off task even when an occurrence is smaller", () => {
    // the 15-minute occurrence used to win "the smallest task" and was offered
    // as presence — then it duplicated a block the series already had
    const out = suggestPull(data([vt("shutdown", 15, { recurring: true }), vt("call-mom", 30)]));
    const quiet = out.filter((s) => s.kind === "quiet").map((s) => s.task.id);
    expect(quiet).toEqual(["call-mom"]);
  });
});
