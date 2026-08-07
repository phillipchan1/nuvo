// Domain faithfulness — the ledger that decides whether a domain is "quiet".
//
// These drive the REAL `buildVertical`, not hand-built `Domain` objects, because
// that's where the bug lived: the ledger counted completed tasks and attended
// meetings, and a shipped project reached it only by the accident of a task that
// happened to be checked off. A domain where a major project had just landed read
// "Quiet for 7 days — when did you last show up here?" (D-087). A test over a
// fabricated `Domain` would have passed happily — `DomainHarness` does exactly
// that, which is why nothing caught it.

import { describe, expect, it } from "vitest";
import {
  buildVertical,
  faithfulness,
  type DomainRow,
  type ProjectRow,
} from "../src/lib/vertical";
import { domainRead, stateOf } from "../src/lib/domainRead";
import { domainShipped } from "../src/lib/domainRead";
import { readPeriodGain, readShipped } from "../src/lib/shipped";
import type { Task } from "../src/lib/types";

// A Thursday, so "this week" has days on both sides of it.
const NOW = new Date("2026-08-06T15:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();
const dateAgo = (n: number) => daysAgo(n).slice(0, 10);

const DOM = "dom-1";

function domainRow(over: Partial<DomainRow> = {}): DomainRow {
  return {
    id: DOM,
    name: "Stampede",
    color: "#7C3AED",
    icon: "🐎",
    intention: "",
    charter: "",
    context: null,
    weekly_target_hours: 0,
    sort_order: 0,
    ...over,
  };
}

function projectRow(over: Partial<ProjectRow> & { id: string }): ProjectRow {
  return {
    initiative_id: null,
    key_result_id: null,
    domain_id: DOM,
    name: over.id,
    outcome: "",
    description: "",
    start_date: null,
    target_date: null,
    status: "complete",
    progress: 0,
    shipped_at: null,
    sort_order: 0,
    ...over,
  };
}

function taskRow(over: Partial<Task> & { id: string }): Task {
  return {
    user_id: "u1",
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
    title: over.id,
    notes: "",
    status: "done",
    do_date: null,
    start_time: null,
    duration_minutes: 60,
    deadline: null,
    priority: "normal",
    roll_count: 0,
    completed_at: null,
    project_id: null,
    initiative_id: null,
    domain_id: DOM,
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
    sort_order: 0,
    ...over,
  } as Task;
}

/** Build a snapshot and hand back the one domain under test. */
function build(projects: ProjectRow[], tasks: Task[], domains: DomainRow[] = [domainRow()]) {
  const data = buildVertical(domains, [], projects, tasks, null, NOW);
  return { data, dom: data.domains[0] };
}

describe("a ship is a touch", () => {
  it("A · a project shipped with no tasks still lands on the ledger", () => {
    const { data, dom } = build([projectRow({ id: "Stampede rebrand", shipped_at: daysAgo(2) })], []);

    expect(dom.lastTouchedDays).toBe(2);
    expect(dom.lastShip).toEqual({ name: "Stampede rebrand", daysAgo: 2 });
    expect(faithfulness(dom).lit).toBe(true);

    const st = stateOf(dom);
    expect(st.because).toBe("shipped");
    expect(st.tone).toBe("lit");
    expect(st.line).toContain("Stampede rebrand");
    expect(domainRead(data, dom, NOW).every((r) => r.tone !== "warn")).toBe(true);

    // the guarantee that keeps this honest: a ship is a TOUCH, never HOURS (P6)
    expect(dom.investedThisWeek).toBe(0);
    expect(dom.quarterHours).toBe(0);
    expect(dom.weeks.every((h) => h === 0)).toBe(true);
    expect(dom.days.every((h) => h === 0)).toBe(true);
  });

  it("B · shipping with the 'drop' verdict cannot erase the touch", () => {
    // ShipAssess trashes the leftovers when you ship with "drop", and trashed rows
    // never reach `tasks` — so before the fix, finishing deleted its own evidence
    const { dom } = build(
      [projectRow({ id: "Rebrand", shipped_at: daysAgo(1) })],
      [taskRow({ id: "t1", status: "trashed", completed_at: null, project_id: "Rebrand" })],
    );

    expect(dom.lastTouchedDays).toBe(1);
    expect(stateOf(dom).because).toBe("shipped");
    expect(dom.investedThisWeek).toBe(0);
  });

  it("C · the reported bug — shipped 3 days ago, last task closed 9 days ago", () => {
    const { data, dom } = build(
      [projectRow({ id: "Stampede rebrand", shipped_at: daysAgo(3) })],
      [taskRow({ id: "t1", completed_at: daysAgo(9), project_id: "Stampede rebrand" })],
    );

    expect(dom.lastTouchedDays).toBe(3); // not 9
    expect(stateOf(dom).because).toBe("shipped");
    expect(stateOf(dom).line).toBe("Shipped Stampede rebrand 3 days ago");
    for (const r of domainRead(data, dom, NOW)) expect(r.text).not.toContain("Quiet");
  });

  it("D · past the glow, a quiet domain still reads as rested, not drifting", () => {
    const { data, dom } = build([projectRow({ id: "The book proposal", shipped_at: daysAgo(30) })], []);

    const st = stateOf(dom);
    expect(st.tone).toBe("quiet");
    expect(st.because).toBe("resting");
    expect(st.line).toBe("Quiet since The book proposal shipped");

    const reads = domainRead(data, dom, NOW);
    expect(reads.filter((r) => r.tone === "good").length).toBe(1);
    expect(reads.filter((r) => r.tone === "warn").length).toBe(0);
    expect(reads.find((r) => r.tone === "good")!.text).toContain("that's what finishing looks like");
  });

  it("H · real hours stay measured, ship or no ship", () => {
    const { dom } = build(
      [projectRow({ id: "Rebrand", shipped_at: daysAgo(0) })],
      [taskRow({ id: "t1", completed_at: daysAgo(1), duration_minutes: 120 })],
    );

    expect(dom.investedThisWeek).toBe(2);
    expect(dom.weeks[12]).toBe(2);
    expect(dom.days.reduce((s, h) => s + h, 0)).toBe(2);
  });

  it("M · un-shipping clears the touch", () => {
    // `shippedAt` is nulled the moment a project stops being complete, so a
    // reopened project can't keep a domain warm on a finish line it took back
    const { dom } = build([projectRow({ id: "Rebrand", status: "in_progress", shipped_at: daysAgo(1) })], []);

    expect(dom.lastShip).toBeNull();
    expect(dom.lastTouchedDays).toBeNull();
    expect(stateOf(dom).because).toBe("unstarted");
  });
});

describe("the quiet signal speaks at domain altitude", () => {
  it("E · a domain last touched 120 days ago says so — the 99 sentinel is gone", () => {
    const { dom } = build([], [taskRow({ id: "t1", completed_at: daysAgo(120) })]);

    expect(dom.lastTouchedDays).toBe(120); // not 99, and not null
    const st = stateOf(dom);
    expect(st.because).toBe("drifting");
    expect(st.short).toBe("quiet · 17w");
    expect(st.line).not.toContain("kept here yet");
    // no rhythm to point at, so it says the gap once and stops
    expect(st.line).toBe("Quiet for 17 weeks");
  });

  it("E · a trough inside a real rhythm carries that rhythm as context", () => {
    const { data, dom } = build([], [
      taskRow({ id: "t1", completed_at: daysAgo(21) }),
      taskRow({ id: "t2", completed_at: daysAgo(28) }),
      taskRow({ id: "t3", completed_at: daysAgo(35) }),
    ]);

    expect(stateOf(dom).line).toBe("Quiet for 3 weeks — 3 of the last 13 weeks kept");
    const read = domainRead(data, dom, NOW).find((r) => r.text.startsWith("Quiet"))!;
    expect(read.tone).toBe("info");
    expect(read.text).toContain("you've kept 3 of the last 13 weeks here");
    expect(read.text).toContain("no rush");
  });

  it("F · an empty account invents no failure", () => {
    const { data, dom } = build([], []);

    expect(dom.lastTouchedDays).toBeNull();
    expect(dom.lastShip).toBeNull();
    expect(stateOf(dom).because).toBe("unstarted");
    expect(stateOf(dom).line).toBe("Nothing kept here yet");

    const reads = domainRead(data, dom, NOW);
    expect(reads.filter((r) => r.tone === "info").length).toBe(1);
    expect(reads.filter((r) => r.tone === "warn").length).toBe(0);
  });

  it("G · a week of silence is not news on a quarterly instrument", () => {
    const { data, dom } = build([], [taskRow({ id: "t1", completed_at: daysAgo(7) })]);

    expect(stateOf(dom).tone).toBe("quiet");
    const reads = domainRead(data, dom, NOW);
    expect(reads.every((r) => r.tone !== "warn")).toBe(true);
    // and it never counts days at the reader
    for (const r of reads) expect(r.text).not.toMatch(/\d+ days?/);
  });
});

describe("shipped work is filed by when it shipped", () => {
  const twoDomains = [domainRow(), domainRow({ id: "dom-2", name: "Other", sort_order: 1 })];

  it("I · a project shipped today files under this month, not its old finish line", () => {
    const { data } = build(
      [projectRow({ id: "p1", target_date: "2026-06-15", shipped_at: daysAgo(0) })],
      [],
      twoDomains,
    );

    const board = readShipped(data, "project", NOW);
    expect(board.thisPeriodCount).toBe(1);
    expect(board.groups[0].label).toBe("August 2026");
  });

  it("I · with no ship stamp it still falls back to the finish line", () => {
    const { data } = build([projectRow({ id: "p1", target_date: "2026-06-15" })], [], twoDomains);

    const board = readShipped(data, "project", NOW);
    expect(board.groups[0].label).toBe("June 2026");
    expect(board.thisPeriodCount).toBe(0);
  });

  it("J · a ship with no finish line set is no longer invisible on the Gain rail", () => {
    const { data } = build([projectRow({ id: "p1", target_date: null, shipped_at: daysAgo(5) })], [], twoDomains);

    expect(readPeriodGain(data, "project", NOW).count).toBe(1);
  });

  it("K · a domain's built list orders by ship, not by due date", () => {
    const { data } = build(
      [
        // due first, shipped last
        projectRow({ id: "early-due", target_date: "2026-07-01", shipped_at: daysAgo(1), sort_order: 0 }),
        projectRow({ id: "late-due", target_date: "2026-08-31", shipped_at: daysAgo(20), sort_order: 1 }),
      ],
      [],
      twoDomains,
    );

    expect(domainShipped(data, DOM, NOW).map((it) => it.id)).toEqual(["early-due", "late-due"]);
  });

  it("L · initiatives, which carry no ship stamp, still group by their finish line", () => {
    const data = buildVertical(
      [domainRow()],
      [
        {
          id: "i1",
          domain_id: DOM,
          name: "The bet",
          outcome: "",
          description: "",
          start_date: null,
          target_date: "2026-05-20",
          status: "complete",
          progress: 0,
          momentum: "flat",
          sort_order: 0,
        } as never,
      ],
      [],
      [],
      null,
      NOW,
    );

    const board = readShipped(data, "initiative", NOW);
    expect(board.groups[0].label).toBe("Q2 2026");
  });
});
