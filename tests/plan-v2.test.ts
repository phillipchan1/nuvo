// Plan the week v2 (docs/plan-the-week-v2.md): runs are cut by what you'll be
// doing, and "where else could this go" is the composer asked again — never a
// second placement rule.

import { describe, expect, it } from "vitest";
import { actionKindOf } from "../src/lib/actionKind";
import { batchLooseWork } from "../src/lib/batch";
import { alternativesFor, asBusyBlock, composeWeek, type ComposeInput } from "../src/lib/compose";
import type { VerticalData } from "../src/lib/vertical";
import type { Task } from "../src/lib/types";

const WEEK = "2026-10-26"; // Monday
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

const data = {
  domains: [
    { id: "home", name: "Home", color: "var(--d1)" },
    { id: "work", name: "Work", color: "var(--d2)" },
  ],
  projects: [],
  initiatives: [],
} as unknown as VerticalData;

describe("the kind of action a title names", () => {
  it("reads the leading verb, and says nothing when there isn't one", () => {
    expect(actionKindOf("Call David re the lease")).toBe("calls");
    expect(actionKindOf("reply to Grace about Sunday")).toBe("replies");
    expect(actionKindOf("Pick up dry cleaning")).toBe("errands");
    expect(actionKindOf("Draft the sermon intro")).toBe("writing");
    expect(actionKindOf("Quarterly taxes")).toBeNull();
    // the verb has to lead — "recall" is not a call
    expect(actionKindOf("recall the order")).toBeNull();
  });
});

describe("loose work is gathered by what you'll be doing", () => {
  it("puts calls from two domains in one run, and falls back to domain for the rest", () => {
    const { batches, singles } = batchLooseWork(
      [
        t("Call the plumber", 15, { domain_id: "home" }),
        t("Call Acme back", 15, { domain_id: "work" }),
        t("filter", 15, { domain_id: "home" }),
        t("gutters", 15, { domain_id: "home" }),
        t("invoice", 15, { domain_id: "work" }),
      ],
      data,
    );
    const calls = batches.find((b) => b.name === "Calls")!;
    expect(calls.taskIds.sort()).toEqual(["Call Acme back", "Call the plumber"]);
    expect(batches.find((b) => b.name === "Home admin")!.taskIds.sort()).toEqual(["filter", "gutters"]);
    expect(singles.map((s) => s.id)).toEqual(["invoice"]);
  });
});

describe("alternatives are the composer asked again", () => {
  const base: ComposeInput = {
    weekStartISO: WEEK,
    todayISO: WEEK,
    now: new Date(`${WEEK}T05:00:00`),
    tasks: [],
    events: [],
    blocks: [],
    workStartMin: 9 * 60,
    workEndMin: 17 * 60 + 30,
    focusInitiativeIds: [],
    dayContexts: {},
    workingDays: [1, 2, 3, 4, 5],
    weeklyBudgetMins: null,
  };
  const sitting = t("p", 90, { project_id: "p1" });

  it("offers distinct places that never sit on the current one or on other blocks", () => {
    const first = composeWeek({ ...base, tasks: [sitting], atomicIds: ["p"] }).placements[0];
    const other = asBusyBlock("o", "Other", "2026-10-27", 9 * 60, 120);
    const alts = alternativesFor({ ...base, blocks: [other] }, sitting, first, 5);
    expect(alts.length).toBeGreaterThanOrEqual(3);
    for (const a of alts) {
      // not where it already is
      expect(a.dayISO === first.dayISO && Math.abs(a.startMin - first.startMin) < 60).toBe(false);
      // never on the other block (Tue 9–11)
      if (a.dayISO === "2026-10-27") expect(a.startMin >= 11 * 60 || a.startMin + a.durationMin <= 9 * 60).toBe(true);
      // the composer's own rule still holds: a project sitting starts in the morning
      expect(a.startMin).toBeLessThan(12 * 60 + 30);
    }
    // each answer is a genuinely different place
    const keys = alts.map((a) => `${a.dayISO}@${a.startMin}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

import { EMPTY_RULES, proposals, rulesAsBusy, type PlanMemory } from "../src/lib/planMemory";

describe("what the planner remembers", () => {
  const week = "2026-11-09";
  const weeks = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];
  const mem = (signals: PlanMemory["signals"]): PlanMemory => ({ signals, rules: { ...EMPTY_RULES }, forgotten: {} });
  const cleared = (w: string) => ({ kind: "cleared" as const, week: w, weekdays: [1, 2, 3, 4, 5], startMin: 480, endMin: 540, at: "" });

  it("proposes nothing from one or two weeks of evidence", () => {
    expect(proposals(mem([cleared(weeks[2]), cleared(weeks[3])]), week, "2026-11-09")).toEqual([]);
  });

  it("proposes keeping an hour clear after three of four weeks, and says so", () => {
    const p = proposals(mem([cleared(weeks[0]), cleared(weeks[2]), cleared(weeks[3])]), week, "2026-11-09");
    expect(p.map((x) => x.label)).toEqual(["Keep 8–9am clear"]);
    expect(p[0].pips).toEqual([true, false, true, true]);
    const rules = p[0].apply(EMPTY_RULES);
    // a kept rule is time the composer can't use, on working days only
    const busy = rulesAsBusy(rules, ["2026-11-09", "2026-11-14"], 990);
    expect(busy).toEqual([{ dayISO: "2026-11-09", startMin: 480, endMin: 540, label: "Kept clear" }]);
  });

  it("doesn't ask again once kept, or while forgotten", () => {
    const signals = [cleared(weeks[0]), cleared(weeks[1]), cleared(weeks[2])];
    const kept = proposals(mem(signals), week, "2026-11-09")[0].apply(EMPTY_RULES);
    expect(proposals({ ...mem(signals), rules: kept }, week, "2026-11-09")).toEqual([]);
    expect(proposals({ ...mem(signals), forgotten: { "clear-480": "2027-01-01" } }, week, "2026-11-09")).toEqual([]);
  });

  it("proposes an early end for a day whose late blocks keep moving off it", () => {
    const moved = (w: string, day: string) => ({
      kind: "moved" as const, week: w, dayISO: day, fromMin: 15 * 60, toDayISO: "2026-11-02", toMin: 9 * 60, durationMin: 60, isRun: true, at: "",
    });
    // three Fridays
    const p = proposals(mem([moved(weeks[0], "2026-10-23"), moved(weeks[1], "2026-10-30"), moved(weeks[3], "2026-11-13")]), week, "2026-11-09");
    expect(p.map((x) => x.label)).toContain("End Fridays at 3pm");
  });
});
