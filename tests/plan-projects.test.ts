// Plan projects / Plan initiatives (D-216, docs/offer-rules.md §4) — the pure
// decisions: the walk's order, R12's pinning, the pace a span is sized at,
// the spans offered with their costs, and the labels. Plus the deck's rest
// state (R6): which stack cards ride a row, and the line that opens the walk.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  commitLabel,
  domainPace,
  lookLast,
  mergeSteer,
  nextSize,
  occupantSpan,
  quarterOffers,
  readyCounter,
  redraftTitles,
  sizesSaid,
  spanCost,
  spanLabel,
  spanOffers,
  spanWeeks,
  walkOrder,
  type PlanLine,
} from "../src/lib/planProjects";
import { deckPlanLine, planCard, rowOffers, subjectOf } from "../src/lib/deckReady";
import type { ReadyCard } from "../src/lib/readyCards";

const line = (key: string, title: string, extra: Partial<PlanLine> = {}): PlanLine => ({ key, title, mins: 30, from: "nuvo", touched: false, ...extra });

describe("the walk", () => {
  it("goes rawest first, then nearest, then by name", () => {
    expect(
      walkOrder([
        { id: "a", name: "Zed", met: 2, at: 0 },
        { id: "b", name: "Beta", met: 0, at: 3 },
        { id: "c", name: "Alpha", met: 0, at: 1 },
        { id: "d", name: "Able", met: 0, at: 1 },
      ]),
    ).toEqual(["d", "c", "b", "a"]);
  });
  it("looks at one last without losing any", () => {
    expect(lookLast(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
    expect(lookLast(["a", "b"], "x")).toEqual(["a", "b"]);
  });
  it("counts a state, never a tally", () => {
    expect(readyCounter(3, 5)).toBe("Ready 3 of 5");
  });
});

describe("R12 — a steer never rewrites what you touched", () => {
  const lines = [
    line("1", "Call Ana"),
    line("2", "Draft the issue", { touched: true }),
    line("3", "Collect stories"),
    line("4", "My own line", { from: "you", touched: true }),
  ];
  it("hands the drafter only Nuvo's untouched lines", () => {
    expect(redraftTitles(lines)).toEqual(["Call Ana", "Collect stories"]);
  });
  it("keeps every pinned line, in place, and puts the redraft where the first free line stood", () => {
    const out = mergeSteer(lines, [line("5", "Call Ana and Ben"), line("6", "One story")]);
    expect(out.map((l) => l.key)).toEqual(["5", "6", "2", "4"]);
  });
  it("never hands back a line you already have", () => {
    const out = mergeSteer(lines, [line("7", "draft the issue"), line("8", "New")]);
    expect(out.map((l) => l.title)).toEqual(["New", "Draft the issue", "My own line"]);
  });
  it("appends when everything is pinned", () => {
    const pinnedOnly = [line("a", "A", { touched: true })];
    expect(mergeSteer(pinnedOnly, [line("b", "B")]).map((l) => l.key)).toEqual(["a", "b"]);
  });
});

describe("labels and sizes", () => {
  it("says tasks, never steps (D-103)", () => {
    expect(commitLabel(4, "Rebuild Fundraising")).toEqual({ verb: "Add 4 tasks to", name: "Rebuild Fundraising" });
    expect(commitLabel(1, "X").verb).toBe("Add 1 task to");
    expect(commitLabel(2, "X").verb).not.toMatch(/step/i);
  });
  it("cycles sizes and wraps", () => {
    expect(nextSize(30)).toBe(45);
    expect(nextSize(180)).toBe(15);
    expect(nextSize(50)).toBe(60);
  });
  it("says what the sizes are built from (R4)", () => {
    expect(sizesSaid([line("1", "a")], "Family", true)).toMatch(/30m guess/);
    expect(sizesSaid([line("1", "a", { measured: true })], "Frontier", false)).toBe("Sized from your finished work in Frontier");
    expect(sizesSaid([line("1", "a")], "Frontier", false)).toMatch(/estimates/);
    expect(sizesSaid([line("1", "a", { from: "you", touched: true })], "Frontier", false)).toBeNull();
  });
});

describe("the pace a span is sized at", () => {
  it("is your usual week in the domain — the median of finished weeks with work", () => {
    const p = domainPace({ name: "Frontier", weeks: [0, 2, 3, 1, 0, 4, 9] });
    expect(p.source).toBe("usual");
    expect(p.minsPerWeek).toBe(150); // median of 2,3,1,4 = 2.5h — this week (9) doesn't count
    expect(p.said).toMatch(/usual 2\.5h a week in Frontier/);
  });
  it("falls back to the domain's target, then to a named default", () => {
    expect(domainPace({ name: "F", weeks: [0, 1, 0], weeklyTargetHours: 4 }).source).toBe("target");
    const d = domainPace({ name: "Family", weeks: [0, 0, 0] });
    expect(d.source).toBe("default");
    expect(d.minsPerWeek).toBe(90);
    expect(d.said).toMatch(/default/);
  });
  it("turns hours into whole weeks, at least one", () => {
    expect(spanWeeks(0, 90)).toBe(1);
    expect(spanWeeks(240, 90)).toBe(3);
    expect(spanWeeks(90, 90)).toBe(1);
  });
});

describe("spans and their costs (R5, R13)", () => {
  const base = new Date(2026, 10, 16); // Mon Nov 16
  const others = [
    { id: "cf", name: "Cloudflare migration", domainId: "d1", start: 1, end: 2 },
    { id: "x", name: "Other", domainId: "d2", start: 0, end: 0 },
    { id: "y", name: "Other 2", domainId: "d3", start: 0, end: 0 },
  ];
  const input = { base, id: "p", domainId: "d1", weeks: 2, earliest: 0, others, cap: 3 };
  it("labels a span by the deck's dates", () => {
    expect(spanLabel(base, 0, 1)).toBe("Nov 16–20");
    expect(spanLabel(base, 1, 3)).toBe("Nov 23 – Dec 11");
  });
  it("names the same-domain overlap first", () => {
    expect(spanCost(input, 0)).toBe("Overlaps Cloudflare migration the week of Nov 23");
  });
  it("names a week over the cap when nothing in the domain collides", () => {
    expect(spanCost({ ...input, domainId: "d9", cap: 2 }, 0)).toMatch(/^The week of Nov 16 would hold 3 · room for 2/);
  });
  it("offers the soonest with its cost, and the first clear span later", () => {
    const offers = spanOffers(input);
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({ start: 0, cost: expect.stringMatching(/Overlaps Cloudflare/) });
    expect(offers[1]).toMatchObject({ start: 3, cost: null, reason: "Clear weeks · later" });
  });
  it("a clear soonest span is the only answer", () => {
    expect(spanOffers({ ...input, earliest: 3 })).toHaveLength(1);
  });
  it("ignores the project's own span", () => {
    expect(spanCost({ ...input, id: "cf" }, 1)).toBeNull();
  });
  it("reads a dated span as week indexes from the deck's first week", () => {
    expect(occupantSpan(base, "2026-11-23", "2026-12-04")).toEqual({ start: 1, end: 2 });
    expect(occupantSpan(base, null, "2026-11-20")).toEqual({ start: 0, end: 0 });
    expect(occupantSpan(base, null, null)).toBeNull();
  });
});

describe("quarters (Plan initiatives)", () => {
  const labelOf = (q: number) => ["Q4 2026", "Q1 2027", "Q2 2027", "Q3 2027"][q];
  it("names a same-domain bet finishing there, and offers a clear quarter", () => {
    const offers = quarterOffers({
      id: "i",
      domainId: "d1",
      earliest: 0,
      quarters: 4,
      labelOf,
      others: [{ id: "g", name: "Grow the church", domainId: "d1", quarter: 0 }],
      cap: 3,
    });
    expect(offers[0].cost).toBe("Grow the church also finishes in Q4 2026");
    expect(offers[1]).toMatchObject({ quarter: 1, cost: null });
  });
  it("names a quarter over the cap", () => {
    const offers = quarterOffers({ id: "i", domainId: "d1", earliest: 0, quarters: 1, labelOf, others: [{ id: "a", name: "A", domainId: "d2", quarter: 0 }], cap: 1 });
    expect(offers).toEqual([{ quarter: 0, cost: "Q4 2026 would hold 2 · room for 1", reason: null }]);
  });
});

const card = (key: string, kind: ReadyCard["kind"], verb: string, projectId: string | null = null, name?: string): ReadyCard => ({
  key,
  kind,
  title: key,
  why: "why",
  primary: { verb, name, run: () => {} },
  projectId,
});

describe("the deck at rest (R6)", () => {
  it("rides a card only when its act names where it goes — never an Open", () => {
    const m = rowOffers([
      card("deck:overdue:p1", "risk", "Open", "p1"),
      card("deck:crowd:p2", "crowd", "Move to", "p2", "Nov 23"),
      card("deck:thin:p3", "path", "Suggest tasks", "p3"),
      card("deck:gap:p4", "shape", "Open", "p4"),
    ]);
    expect([...m.keys()]).toEqual(["p2", "p3"]);
  });
  it("one chip per row, at most three", () => {
    const m = rowOffers([
      card("a:p1", "crowd", "Move to", "p1"),
      card("b:p1", "path", "Suggest tasks", "p1"),
      card("c:p2", "path", "Suggest tasks", "p2"),
      card("d:p3", "path", "Suggest tasks", "p3"),
      card("e:p4", "path", "Suggest tasks", "p4"),
    ]);
    expect(m.size).toBe(3);
    expect(m.get("p1")?.key).toBe("a:p1");
  });
  it("reads a bet's id from its key", () => {
    expect(subjectOf(card("bet:risk:i9", "risk", "Suggest projects"))).toBe("i9");
  });
  it("the walk is a card in the stack, last, only while something isn't Ready", () => {
    expect(planCard(0, "project", () => {})).toBeNull();
    expect(planCard(2, "project", () => {})).toMatchObject({ kind: "plan", opensMode: "plan", primary: { verb: "Plan projects" }, why: "2 not Ready" });
  });
  it("the line opens the walk when shaping leads, the stack when something is at risk", () => {
    const shaping = deckPlanLine([card("deck:gap:p1", "shape", "Open", "p1")], 2, "project");
    expect(shaping.opens).toBe("plan");
    expect(shaping.line).toMatchObject({ text: "2 not Ready", act: "Plan projects" });
    const risk = deckPlanLine([card("deck:overdue:p1", "risk", "Open", "p1")], 2, "project");
    expect(risk.opens).toBe("ready");
    expect(risk.line?.act).toBe("Get ready");
    expect(risk.line?.then).toBe("2 not Ready");
    expect(deckPlanLine([], 0, "initiative").line).toBeNull();
    expect(deckPlanLine([], 1, "initiative").line?.act).toBe("Plan initiatives");
  });
});

describe("the wiring", () => {
  it("neither deck stands the Get ready card above its list any more", () => {
    for (const f of ["src/components/ondeck/OnDeckPlanner.tsx", "src/components/ondeck/InitiativeDeck.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/<RestDeck/);
    }
  });
  it("one drafter: the walk and the record's list ask through askScaffold", () => {
    expect(readFileSync("src/components/tasks/usePathDraft.ts", "utf8")).toMatch(/askScaffold\(/);
    expect(readFileSync("src/components/ondeck/PlanProjectsRail.tsx", "utf8")).toMatch(/askScaffold/);
    expect(readFileSync("src/components/ondeck/usePlanDraft.ts", "utf8")).not.toMatch(/functions\.invoke/);
  });
  it("a span is written through the deck's own placement (the kernel's weekSpanFor)", () => {
    const src = readFileSync("src/components/ondeck/OnDeckPlanner.tsx", "utf8");
    expect(src).toMatch(/moveProject\(p, \{ \.\.\.weekSpan\(p, addDays\(base, start \* 7\), weeks\), status: "in_progress" \}, "Planned"\)/);
  });
});
