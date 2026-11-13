import { describe, expect, it } from "vitest";
import {
  atOnce,
  canDraftProjects,
  clampSpan,
  fallbackSpans,
  heldProjectPatch,
  ownBars,
  packRows,
  quarterWeeks,
  shapeProjectProposals,
  spanLabel,
  weekIndexOf,
} from "../src/lib/projectDraft";
import { weekSpanFor } from "../supabase/functions/_shared/planningRules.ts";
import type { Project, VerticalData } from "../src/lib/vertical";

const Q1 = { start: new Date(2027, 0, 1), end: new Date(2027, 2, 31, 23, 59) };
const NOV13 = new Date(2026, 10, 13, 9);
const weeks = quarterWeeks(Q1, NOV13);

describe("quarterWeeks — the grid a quarter is drafted on", () => {
  it("is the quarter's Mondays, from the first one inside it", () => {
    expect(weeks).toHaveLength(13);
    expect(weeks[0]).toBe("2027-01-04");
    expect(weeks[12]).toBe("2027-03-29");
  });
  it("starts at this week inside the current quarter — the past isn't draftable", () => {
    const q4 = quarterWeeks({ start: new Date(2026, 9, 1), end: new Date(2026, 11, 31, 23, 59) }, NOV13);
    expect(q4[0]).toBe("2026-11-09");
    expect(q4[q4.length - 1]).toBe("2026-12-28");
  });
});

describe("shapeProjectProposals — what both runtimes trust a proposal is", () => {
  it("converts the model's 1-based weeks and clamps spans into the quarter", () => {
    const [a, b] = shapeProjectProposals(
      [
        { name: "Portfolio site", outcome: "Live with booking", why: "Clients look first", start_week: 2, weeks: 4 },
        { name: "Follow up every lead", start_week: 11, weeks: 9 },
      ],
      13,
    );
    expect(a).toMatchObject({ name: "Portfolio site", start: 1, weeks: 4, why: "Clients look first" });
    expect(b).toMatchObject({ start: 10, weeks: 3 });
  });

  it("drops duplicates of your own projects and of each other, keeps five at most", () => {
    const raw = ["Price list", "Portfolio site", "portfolio site", "A", "B", "C", "D", "E"].map((name) => ({ name, start_week: 1, weeks: 2 }));
    const out = shapeProjectProposals(raw, 13, ["Price List"]);
    expect(out.map((p) => p.name)).toEqual(["Portfolio site", "A", "B", "C", "D"]);
  });

  it("lays out proposals that came without spans, in order, and keeps two alternatives at most", () => {
    const out = shapeProjectProposals(
      [{ name: "One", alternatives: [{ name: "One b" }, { name: "One" }, { name: "One c" }, { name: "One d" }] }, { name: "Two" }],
      12,
    );
    expect(out.map((p) => [p.start, p.weeks])).toEqual(fallbackSpans(2, 12).map((s) => [s.start, s.weeks]));
    // an alternative without a span takes its project's; one that repeats the name is dropped
    expect(out[0].alternatives.map((a) => a.name)).toEqual(["One b", "One c"]);
    expect(out[0].alternatives[0].start).toBe(out[0].start);
  });

  it("survives a model that answered nonsense", () => {
    expect(shapeProjectProposals(undefined, 13)).toEqual([]);
    expect(shapeProjectProposals([null, 3, { outcome: "no name" }], 13)).toEqual([]);
    expect(clampSpan(Number.NaN, -2, 13)).toEqual({ start: 0, weeks: 1 });
  });
});

describe("the grid's reads", () => {
  it("packs overlapping bars into rows, in start order", () => {
    const rows = packRows([
      { id: "a", start: 0, weeks: 2 },
      { id: "b", start: 1, weeks: 3 },
      { id: "c", start: 2, weeks: 2 },
      { id: "d", start: 4, weeks: 1 },
    ]);
    expect([rows.get("a"), rows.get("b"), rows.get("c"), rows.get("d")]).toEqual([0, 1, 0, 0]);
  });
  it("counts what runs each week", () => {
    expect(atOnce([{ start: 0, weeks: 2 }, { start: 1, weeks: 2 }], 4)).toEqual([1, 2, 1, 0]);
  });
});

describe("holding a bar writes the deck's own span", () => {
  it("uses the kernel's weekSpanFor, so the project deck draws it where it stood", () => {
    expect(heldProjectPatch(weeks, { start: 1, weeks: 4 })).toEqual(weekSpanFor("2027-01-11", 4));
    expect(spanLabel(weeks, { start: 1, weeks: 4 })).toMatch(/Jan 11 – Feb 5 · 4 weeks/);
  });
  it("reads your own projects back onto the grid, clipped to the quarter", () => {
    const p = (id: string, startDate: string | null, targetDate: string | null, status = "in_progress") =>
      ({ id, name: id, outcome: "", startDate, targetDate, status }) as Project;
    const bars = ownBars(
      [p("in", "2027-01-04", "2027-01-15"), p("straddles", "2026-12-14", "2027-01-08"), p("later", "2027-05-03", "2027-05-07"), p("undated", null, null)],
      weeks,
    );
    expect(bars.map((b) => [b.id, b.start, b.weeks])).toEqual([
      ["in", 0, 2],
      ["straddles", 0, 1],
    ]);
    expect(weekIndexOf(weeks, "2026-12-01")).toBe(-1);
  });
});

describe("canDraftProjects — the door is offered just in time", () => {
  const init = { id: "i1", outcome: "Ten paying commissions by March 31" } as never;
  const d = (projects: Partial<Project>[]) => ({ projects: projects.map((p) => ({ initiativeId: "i1", ...p })) }) as unknown as VerticalData;
  it("this quarter or next, with an outcome, and no open project under it", () => {
    expect(canDraftProjects(d([]), { initiative: init, state: "needs_shaping", quarterIdx: 1 })).toBe(true);
    expect(canDraftProjects(d([{ id: "p", status: "complete" }]), { initiative: init, state: "needs_shaping", quarterIdx: 0 })).toBe(true);
  });
  it("never on a far-out, finished, outcome-less or already-planned bet", () => {
    expect(canDraftProjects(d([]), { initiative: init, state: "needs_shaping", quarterIdx: 2 })).toBe(false);
    expect(canDraftProjects(d([]), { initiative: init, state: "done", quarterIdx: 0 })).toBe(false);
    expect(canDraftProjects(d([]), { initiative: { id: "i1", outcome: " " } as never, state: "idea", quarterIdx: 0 })).toBe(false);
    expect(canDraftProjects(d([{ id: "p", status: "backlog" }]), { initiative: init, state: "on_track", quarterIdx: 0 })).toBe(false);
  });
});
