// The task-query kernel's conformance suite.
//
// The rules worth pinning are the ones a second implementation would get
// subtly wrong: what an UNDATED task matches, what a relative window means at
// a boundary, and whether a query can ever surface a trashed row.

import { describe, expect, it } from "vitest";
import {
  describeQuery,
  isOverdue,
  matchesWindow,
  isEmptyQuery,
  matchesQuery,
  queryFacetCount,
  type QueryClock,
  type QueryableTask,
  type TaskFacets,
} from "../supabase/functions/_shared/taskQuery.ts";

// Wed 2026-08-12, inside the planning week Mon Aug 10 – Sun Aug 16.
const CLOCK: QueryClock = {
  today: "2026-08-12",
  weekStart: "2026-08-10",
  weekEnd: "2026-08-16",
  nowMs: Date.UTC(2026, 7, 12, 21, 0), // 2pm Pacific on the 12th
};

const task = (over: Partial<QueryableTask> = {}): QueryableTask => ({
  title: "Fix Stampede subdomains",
  notes: "",
  status: "planned",
  priority: "none",
  energy: null,
  do_date: null,
  deadline: null,
  project_id: null,
  ...over,
});
const facets = (over: Partial<TaskFacets> = {}): TaskFacets => ({ labelIds: [], domainId: null, ...over });
const match = (t: QueryableTask, q: Parameters<typeof matchesQuery>[1], f = facets()) =>
  matchesQuery(t, q, f, CLOCK);

describe("relative windows", () => {
  it("resolves each window against the clock it is given, never a wall clock", () => {
    expect(matchesWindow("2026-08-12", "today", CLOCK)).toBe(true);
    expect(matchesWindow("2026-08-13", "tomorrow", CLOCK)).toBe(true);
    expect(matchesWindow("2026-08-11", "overdue", CLOCK)).toBe(true);
    expect(matchesWindow("2026-08-12", "overdue", CLOCK)).toBe(false); // today is not late
    expect(matchesWindow("2026-08-10", "this_week", CLOCK)).toBe(true);
    expect(matchesWindow("2026-08-16", "this_week", CLOCK)).toBe(true); // Sunday is inclusive
    expect(matchesWindow("2026-08-17", "this_week", CLOCK)).toBe(false);
    expect(matchesWindow("2026-08-17", "next_week", CLOCK)).toBe(true);
    expect(matchesWindow("2026-08-23", "next_week", CLOCK)).toBe(true);
    expect(matchesWindow("2026-08-24", "next_week", CLOCK)).toBe(false);
  });

  it("never calls an undated task overdue", () => {
    // The bug this exists for: treating null as -Infinity turns the whole
    // backlog red, which teaches you to ignore red.
    expect(matchesWindow(null, "overdue", CLOCK)).toBe(false);
    expect(matchesWindow(null, "this_week", CLOCK)).toBe(false);
    expect(matchesWindow(null, "today", CLOCK)).toBe(false);
    expect(matchesWindow(null, "undated", CLOCK)).toBe(true);
    expect(matchesWindow(null, "any", CLOCK)).toBe(true);
    expect(matchesWindow("2026-08-12", "undated", CLOCK)).toBe(false);
  });

  it("crosses a month boundary without arithmetic drift", () => {
    const endOfMonth: QueryClock = {
      today: "2026-08-31",
      weekStart: "2026-08-31",
      weekEnd: "2026-09-06",
      nowMs: Date.UTC(2026, 7, 31, 21, 0),
    };
    expect(matchesWindow("2026-09-01", "tomorrow", endOfMonth)).toBe(true);
    expect(matchesWindow("2026-09-06", "this_week", endOfMonth)).toBe(true);
    expect(matchesWindow("2026-09-07", "next_week", endOfMonth)).toBe(true);
  });
});

describe("matchesQuery", () => {
  it("the empty query is every open task", () => {
    expect(match(task(), {})).toBe(true);
    expect(match(task({ status: "inbox" }), {})).toBe(true);
    expect(match(task({ status: "backlog" }), {})).toBe(true);
    expect(match(task({ status: "done" }), {})).toBe(false);
  });

  it("never surfaces a trashed task, whatever is asked", () => {
    // A filter is not a recovery tool. The trash is its own face, on purpose.
    const trashed = task({ status: "trashed" });
    expect(match(trashed, {})).toBe(false);
    expect(match(trashed, { status: "any" })).toBe(false);
    expect(match(trashed, { status: "done" })).toBe(false);
    expect(match(trashed, { text: "stampede" })).toBe(false);
  });

  it("is ANY-of within a field and ALL-of across fields", () => {
    const t = task({ priority: "high", do_date: "2026-08-12" });
    const f = facets({ labelIds: ["errand"] });
    expect(match(t, { labelIds: ["errand", "calls"] }, f)).toBe(true); // any-of
    expect(match(t, { labelIds: ["calls"] }, f)).toBe(false);
    // the audit's example, exactly: "@errand + high priority + due this week"
    expect(match(t, { labelIds: ["errand"], priorities: ["high"], when: "this_week" }, f)).toBe(true);
    expect(match(t, { labelIds: ["errand"], priorities: ["low"], when: "this_week" }, f)).toBe(false);
  });

  it("asks the date field it was told to ask", () => {
    const t = task({ do_date: "2026-09-20", deadline: "2026-08-12" });
    expect(match(t, { when: "today" })).toBe(false); // do_date by default
    expect(match(t, { when: "today", dateField: "deadline" })).toBe(true);
  });

  it("filters on the domain the caller resolved, not on a task's own copy", () => {
    // D-088: `task.domain_id` is a denormalized copy that goes stale when a
    // project is re-homed, so the kernel is only ever handed a RESOLVED domain
    // and has no way to read the stale one.
    const t = task({ project_id: "proj-1" });
    expect(match(t, { domainIds: ["dom-work"] }, facets({ domainId: "dom-work" }))).toBe(true);
    expect(match(t, { domainIds: ["dom-work"] }, facets({ domainId: "dom-church" }))).toBe(false);
    expect(Object.keys(task())).not.toContain("domain_id");
  });

  it("matches text word-by-word, and only reaches the notes when asked", () => {
    const t = task({ title: "Call the ATC reviewer", notes: "ask about the Stampede build" });
    expect(match(t, { text: "atc reviewer" })).toBe(true);
    expect(match(t, { text: "reviewer atc" })).toBe(true); // order-free
    expect(match(t, { text: "atc missing" })).toBe(false); // every word must land
    expect(match(t, { text: "stampede" })).toBe(false); // title only by default
    expect(match(t, { text: "stampede", deep: true })).toBe(true);
  });
});

describe("reading a query back", () => {
  it("calls the empty query what it is", () => {
    expect(isEmptyQuery({})).toBe(true);
    expect(isEmptyQuery({ status: "open" })).toBe(true);
    expect(isEmptyQuery({ when: "any" })).toBe(true);
    expect(isEmptyQuery({ when: "today" })).toBe(false);
    expect(describeQuery({})).toBe("Everything open");
  });

  it("counts the facets a surface has to explain", () => {
    expect(queryFacetCount({})).toBe(0);
    expect(queryFacetCount({ labelIds: ["a", "b"], priorities: ["high"], when: "this_week" })).toBe(3);
  });

  it("names what it can and counts what it cannot", () => {
    const names = { label: (id: string) => (id === "l1" ? "errand" : undefined) };
    expect(describeQuery({ labelIds: ["l1"], priorities: ["high"], when: "this_week" }, names)).toBe(
      "errand · high priority · this week",
    );
    expect(describeQuery({ labelIds: ["l1", "l9"] }, names)).toBe("2 labels");
    expect(describeQuery({ when: "overdue" })).toBe("overdue");
    expect(describeQuery({ when: "this_week", dateField: "deadline" })).toBe("due this week");
  });
});

describe("overdue is the app's overdue, not a date comparison", () => {
  // The bug this pins: a filter chip labelled "Overdue" sitting three lines
  // under a rail section labelled "Overdue", meaning something different. The
  // rail counts a block that ran an hour past its end; a naive filter counts a
  // stale date. Both are late, so the rule is the union — defined once, here.
  const at = (h: number) => Date.UTC(2026, 7, 12, h + 7, 0); // h, Pacific

  it("counts a block that ran more than an hour past its end", () => {
    const block = { start_time: "2026-08-12T16:00:00.000Z", duration_minutes: 60, status: "planned" };
    expect(isOverdue(block, at(10))).toBe(false); // 10am — it just ended
    expect(isOverdue(block, at(11))).toBe(false); // inside the hour of grace
    expect(isOverdue(block, at(12))).toBe(true); // past it
  });

  it("counts a date that has already passed, timed or not", () => {
    expect(isOverdue({ do_date: "2026-08-11", status: "planned" }, at(9), "2026-08-12")).toBe(true);
    expect(isOverdue({ do_date: "2026-08-12", status: "planned" }, at(9), "2026-08-12")).toBe(false);
  });

  it("never calls finished or deleted work late", () => {
    const stale = { do_date: "2026-08-01", start_time: "2026-08-01T16:00:00.000Z", duration_minutes: 60 };
    expect(isOverdue({ ...stale, status: "done" }, at(9), "2026-08-12")).toBe(false);
    expect(isOverdue({ ...stale, status: "trashed" }, at(9), "2026-08-12")).toBe(false);
  });

  it("the `overdue` window asks that rule, so a late block today matches", () => {
    // do_date is TODAY — a pure date comparison would miss this, which is
    // exactly what shipped and was caught in the running app.
    const lateToday = task({ do_date: "2026-08-12", start_time: "2026-08-12T16:00:00.000Z", duration_minutes: 60 });
    expect(match(lateToday, { when: "overdue" })).toBe(true);
    expect(match(task({ do_date: "2026-08-11" }), { when: "overdue" })).toBe(true);
    expect(match(task({ do_date: "2026-08-13" }), { when: "overdue" })).toBe(false);
  });
});
