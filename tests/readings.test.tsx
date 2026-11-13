// @vitest-environment jsdom
/**
 * The readings (D-203) and the Reach (D-202).
 *
 *  · `weekSignificance` — the planning kernel's one rule for "did my finished
 *    hours go toward an initiative". Fixtures deliberately unlike the builder's
 *    account: an empty week, an account with no initiatives, a week of only
 *    meetings, a week of only loose upkeep, and a parented task whose own
 *    denormalized copies are stale.
 *  · `PaceTrack`'s third state — done · placed · loose — and that placing
 *    advances the track forward only.
 *  · `reachMark` / `reachToCrown` draw nothing when motion is off, or when no
 *    crown is there to land on.
 */
import { render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doneTaskSignificance, weekSignificance, type SignificanceTask } from "../supabase/functions/_shared/planningRules";
import { PaceTrack, WeekTrack } from "../src/components/progress/PaceTrack";
import { WEEK_REACH_KEY, crownTarget, reachMark, reachToCrown } from "../src/lib/motion";
import { composeWeekTrack, weekElapsed, weekTrackPieces, type WeekTrack as WeekTrackModel } from "../src/lib/weekTrack";

// ── weekSignificance ────────────────────────────────────────────────────────

const START = Date.parse("2026-11-09T00:00:00Z");
const END = Date.parse("2026-11-16T00:00:00Z");
const inWeek = "2026-11-11T15:00:00Z";
const lastWeek = "2026-11-04T15:00:00Z";

const done = (o: Partial<SignificanceTask>): SignificanceTask => ({
  projectId: null,
  status: "done",
  completedAt: inWeek,
  estimateMins: 60,
  ...o,
});

const PROJECTS = [
  { id: "bet-work", initiativeId: "i1" },
  { id: "plain", initiativeId: null },
  { id: "orphaned", initiativeId: "deleted-initiative" },
];

const base = { startMs: START, endMs: END, projects: PROJECTS, initiativeIds: ["i1"] };

describe("weekSignificance", () => {
  it("is null when the account has no initiatives — a stranger is not scored", () => {
    expect(
      weekSignificance({ ...base, initiativeIds: [], tasks: [done({ projectId: "bet-work" })] }),
    ).toBeNull();
  });

  it("an empty week is zero on both sides, not null", () => {
    expect(weekSignificance({ ...base, tasks: [] })).toEqual({ initiativeMins: 0, otherMins: 0 });
  });

  it("a week of only meetings is all other — Counts toward resolves to a domain, never a project", () => {
    expect(
      weekSignificance({ ...base, tasks: [], events: [{ mins: 90, projectId: null }, { mins: 30, projectId: null }] }),
    ).toEqual({ initiativeMins: 0, otherMins: 120 });
  });

  it("an event that resolves to a laddered project counts toward it", () => {
    expect(weekSignificance({ ...base, tasks: [], events: [{ mins: 45, projectId: "bet-work" }] })).toEqual({
      initiativeMins: 45,
      otherMins: 0,
    });
  });

  it("a week of only loose upkeep is all other", () => {
    const tasks = [done({ estimateMins: 15 }), done({ estimateMins: 20 }), done({ estimateMins: 25 })];
    expect(weekSignificance({ ...base, tasks })).toEqual({ initiativeMins: 0, otherMins: 60 });
  });

  it("only a project attached to a live initiative counts; a plain project and a dangling link are other", () => {
    const tasks = [
      done({ projectId: "bet-work", estimateMins: 90 }),
      done({ projectId: "plain", estimateMins: 30 }),
      done({ projectId: "orphaned", estimateMins: 40 }),
    ];
    expect(weekSignificance({ ...base, tasks })).toEqual({ initiativeMins: 90, otherMins: 70 });
  });

  it("the parent rule: a parented task counts by its PROJECT, whatever its own copies say", () => {
    // The task row's own denormalized initiative/domain point elsewhere (it was
    // filed before the project was re-homed). The kernel never reads them: the
    // shape has no field for them, so a stale copy can't leak in.
    const stale = { ...done({ projectId: "bet-work", estimateMins: 50 }), initiativeId: null, domainId: "old" };
    const staleOther = { ...done({ projectId: "plain", estimateMins: 20 }), initiativeId: "i1", domainId: "old" };
    expect(weekSignificance({ ...base, tasks: [stale, staleOther] })).toEqual({ initiativeMins: 50, otherMins: 20 });
  });

  it("counts only work finished inside the window, and prefers the block's length to the estimate", () => {
    const tasks = [
      done({ projectId: "bet-work", estimateMins: 30, blockMins: 75 }),
      done({ projectId: "bet-work", completedAt: lastWeek }),
      done({ projectId: "bet-work", status: "ready", completedAt: null }),
      done({ projectId: "bet-work", completedAt: null }),
    ];
    expect(weekSignificance({ ...base, tasks })).toEqual({ initiativeMins: 75, otherMins: 0 });
  });
});

// ── Significant in TASKS (D-206) ────────────────────────────────────────────

describe("doneTaskSignificance — the crown's split, counted in tasks", () => {
  const ladder = { projects: [{ id: "bet-work", initiativeId: "i1" }, { id: "plain", initiativeId: null }, { id: "orphan", initiativeId: "gone" }], initiativeIds: ["i1"] };
  it("is unsaid with no initiatives (P7, P16)", () => {
    expect(doneTaskSignificance({ ...ladder, initiativeIds: [], tasks: [{ projectId: "bet-work", status: "done" }] })).toBeNull();
  });
  it("counts a done task toward an initiative iff its project ladders to one that exists", () => {
    const tasks = [
      { projectId: "bet-work", status: "done" },
      { projectId: "bet-work", status: "done" },
      { projectId: "plain", status: "done" },
      { projectId: "orphan", status: "done" }, // its initiative no longer exists → other
      { projectId: null, status: "done" }, // loose → other
      { projectId: "bet-work", status: "ready" }, // not done → not counted
    ];
    expect(doneTaskSignificance({ ...ladder, tasks })).toEqual({ initiativeTasks: 2, otherTasks: 3 });
  });
});

// ── the week's track (D-206) ────────────────────────────────────────────────

/** A crown row as far as the track reads it. */
const trackRow = (projectId: string, done: number, open: number, placed: number, loose: number) => ({
  work: {
    tasks: [
      ...Array.from({ length: done }, (_, i) => ({ id: `${projectId}-d${i}`, projectId, status: "done" })),
      ...Array.from({ length: open }, (_, i) => ({ id: `${projectId}-o${i}`, projectId, status: "ready" })),
    ],
  },
  placed: Array.from({ length: placed }, (_, i) => ({ task: { id: `${projectId}-o${i}` } })),
  loose: Array.from({ length: loose }, (_, i) => ({ id: `${projectId}-o${placed + i}` })),
});
const LADDER = { projects: [{ id: "bet", initiativeId: "i1" }, { id: "upkeep", initiativeId: null }], initiativeIds: ["i1"] };

describe("composeWeekTrack", () => {
  it("one piece per slate task, ordered done-initiative · done-other · placed · no time", () => {
    // bet: 3 done, 2 open (1 placed, 1 loose) · upkeep: 1 done, 3 open (1 placed, 2 loose)
    const rows = [trackRow("bet", 3, 2, 1, 1), trackRow("upkeep", 1, 3, 1, 2)] as never[];
    const t = composeWeekTrack(rows, LADDER, 0.5);
    expect(t).toMatchObject({ doneInitiative: 3, doneOther: 1, placed: 2, noTime: 3, done: 4, total: 9, split: true, elapsed: 0.5 });
    expect(weekTrackPieces(t)).toEqual([
      "done-initiative", "done-initiative", "done-initiative",
      "done-other",
      "placed", "placed",
      "no-time", "no-time", "no-time",
    ]);
    expect(t.label).toBe("4 of 9 done: 3 done toward an initiative, 1 other, 2 placed, 3 with no time");
  });

  it("never counts a task twice when two rows carry it", () => {
    const r = trackRow("bet", 2, 1, 0, 1);
    const t = composeWeekTrack([r, r] as never[], LADDER, null);
    expect(t.total).toBe(3);
  });

  it("an account with no initiatives draws done as one state, not a ladder (P16)", () => {
    const t = composeWeekTrack([trackRow("bet", 2, 1, 1, 0)] as never[], { ...LADDER, initiativeIds: [] }, null);
    expect(t.split).toBe(false);
    expect(weekTrackPieces(t)).toEqual(["done", "done", "placed"]);
    expect(t.label).toBe("2 of 3 done: 2 done, 1 placed");
  });

  it("meetings never enter it — only the slate's tasks do", () => {
    // weekSignificance (hours) takes meetings; the track has no input for them.
    const t = composeWeekTrack([trackRow("upkeep", 1, 0, 0, 0)] as never[], LADDER, null);
    expect(t).toMatchObject({ doneInitiative: 0, doneOther: 1, total: 1 });
  });

  it("the week's clock is linear through the planning week, null outside it", () => {
    expect(weekElapsed("2026-11-09", new Date(2026, 10, 12, 12))).toBeCloseTo(3.5 / 7, 5);
    expect(weekElapsed("2026-11-09", new Date(2026, 10, 20))).toBeNull();
  });
});

describe("WeekTrack", () => {
  const model = (o: Partial<WeekTrackModel>): WeekTrackModel => ({
    doneInitiative: 0, doneOther: 0, placed: 0, noTime: 0, done: 0, total: 0, split: true, elapsed: null, label: "", ...o,
  });
  const pieces = (c: HTMLElement) => [...c.querySelectorAll(".pace-seg")].map((s) => s.getAttribute("data-piece"));
  beforeEach(() => {
    calls.length = 0;
    stubMotion(false);
  });
  afterEach(() => vi.restoreAllMocks());

  it("draws a piece per task, says the split in words (no legend), and carries the week's Reach target", () => {
    const m = model({ doneInitiative: 2, doneOther: 1, placed: 1, noTime: 2, done: 3, total: 6, elapsed: 0.4, label: "3 of 6 done: 2 done toward an initiative, 1 other, 1 placed, 2 with no time" });
    const { container } = render(<WeekTrack track={m} />);
    expect(pieces(container)).toEqual(["done-initiative", "done-initiative", "done-other", "placed", "no-time", "no-time"]);
    const el = container.querySelector("[data-crown-week]") as HTMLElement;
    expect(el.getAttribute("aria-label")).toBe(m.label);
    expect(el.getAttribute("title")).toBe(m.label);
    expect(container.textContent).toBe("");
    expect(container.querySelector(".pace-now")).not.toBeNull();
  });

  it("past the piece cap it fills — one run per state, in order", () => {
    const m = model({ doneInitiative: 10, doneOther: 3, placed: 2, noTime: 2, done: 13, total: 17 });
    const { container } = render(<WeekTrack track={m} />);
    expect(container.querySelectorAll(".pace-seg")).toHaveLength(0);
    expect([...container.querySelectorAll(".pace-run")].map((r) => r.getAttribute("data-piece"))).toEqual(["done-initiative", "done-other", "placed", "no-time"]);
  });

  it("a piece that moves forward advances once; nothing on mount; an undo snaps", () => {
    const a = model({ doneInitiative: 1, placed: 1, noTime: 2, done: 1, total: 4 });
    const b = model({ doneInitiative: 1, placed: 2, noTime: 1, done: 1, total: 4 });
    const { container, rerender } = render(<WeekTrack track={a} />);
    expect(calls).toHaveLength(0);
    rerender(<WeekTrack track={b} />);
    expect(calls).toHaveLength(1);
    expect(calls[0].el).toBe(container.querySelectorAll(".pace-fill")[2]);
    calls.length = 0;
    rerender(<WeekTrack track={a} />);
    expect(calls).toHaveLength(0);
  });

  it("a card can Reach the week", () => {
    const { container } = render(<WeekTrack track={model({ doneInitiative: 1, done: 1, total: 1 })} />);
    const el = container.querySelector("[data-crown-week]") as HTMLElement;
    el.getBoundingClientRect = () => ({ left: 10, top: 10, right: 50, bottom: 16, width: 40, height: 6, x: 10, y: 10 }) as DOMRect;
    expect(crownTarget(WEEK_REACH_KEY)).toBe(el);
  });
});

// ── PaceTrack: done · placed · loose ────────────────────────────────────────

const TOKENS: Record<string, string> = {
  "--d-land": "352ms",
  "--d-advance": "680ms",
  "--d-stagger": "72ms",
  "--ease-land": "cubic-bezier(0.3, 1.35, 0.55, 1)",
  "--ease-momentum": "cubic-bezier(0.16, 1, 0.3, 1)",
};
const calls: { kf: Keyframe[]; opts: KeyframeAnimationOptions; el: Element }[] = [];
const stubMotion = (reduced: boolean) => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () => ({ getPropertyValue: (n: string) => TOKENS[n] ?? "" }) as unknown as CSSStyleDeclaration,
  );
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduce"), media: q })) as unknown as typeof window.matchMedia;
  (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, kf: Keyframe[], opts: KeyframeAnimationOptions) {
    calls.push({ kf, opts, el: this });
    return { onfinish: null, oncancel: null } as unknown as Animation;
  };
};

describe("PaceTrack — three states", () => {
  beforeEach(() => {
    calls.length = 0;
    stubMotion(false);
  });
  afterEach(() => vi.restoreAllMocks());

  const states = (c: HTMLElement) => [...c.querySelectorAll(".pace-seg")].map((s) => s.getAttribute("data-piece"));

  it("draws done, then placed, then loose", () => {
    const { container } = render(<PaceTrack done={2} placed={2} total={6} color="red" />);
    expect(states(container)).toEqual(["done", "done", "placed", "placed", "loose", "loose"]);
    const fills = [...container.querySelectorAll<HTMLElement>(".pace-fill")];
    expect(fills[0].style.background).toBe("red");
    expect(fills[2].style.background).toContain("color-mix");
    expect(fills[4].style.transform).toBe("scaleX(0)");
  });

  it("without `placed` it is the old two-state track", () => {
    const { container } = render(<PaceTrack done={1} total={3} color="red" />);
    expect(states(container)).toEqual(["done", "loose", "loose"]);
  });

  it("never draws more placed than there is open work", () => {
    const { container } = render(<PaceTrack done={3} placed={5} total={4} color="red" />);
    expect(states(container)).toEqual(["done", "done", "done", "placed"]);
  });

  it("loose → placed advances the new piece, once; nothing on mount", () => {
    const { container, rerender } = render(<PaceTrack done={1} placed={1} total={5} color="red" />);
    expect(calls).toHaveLength(0);
    rerender(<PaceTrack done={1} placed={2} total={5} color="red" />);
    expect(calls).toHaveLength(1);
    expect(calls[0].kf).toEqual([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }]);
    expect(calls[0].el).toBe(container.querySelectorAll(".pace-fill")[2]);
  });

  it("placed → done advances that piece to solid", () => {
    const { container, rerender } = render(<PaceTrack done={1} placed={2} total={5} color="red" />);
    rerender(<PaceTrack done={2} placed={1} total={5} color="red" />);
    expect(calls).toHaveLength(1);
    expect(calls[0].el).toBe(container.querySelectorAll(".pace-fill")[1]);
  });

  it("un-placing (an undo) snaps", () => {
    const { rerender } = render(<PaceTrack done={1} placed={2} total={5} color="red" />);
    rerender(<PaceTrack done={1} placed={1} total={5} color="red" />);
    expect(calls).toHaveLength(0);
  });

  it("past ten pieces the placed share is its own fill, and it advances", () => {
    const { container, rerender } = render(<PaceTrack done={4} placed={2} total={12} color="red" />);
    expect(container.querySelector('[data-piece="placed"]')).not.toBeNull();
    rerender(<PaceTrack done={4} placed={5} total={12} color="red" />);
    expect(calls).toHaveLength(1);
    expect(calls[0].kf[0]).toEqual({ transform: `scaleX(${6 / 9})` });
  });
});

// ── the Reach ───────────────────────────────────────────────────────────────

describe("reachMark / reachToCrown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  const boxes = () => {
    const from = document.createElement("div");
    const to = document.createElement("div");
    to.setAttribute("data-crown-project", "p1");
    document.body.append(from, to);
    const rect = (x: number) => ({ left: x, top: 10, right: x + 20, bottom: 30, width: 20, height: 20, x, y: 10 }) as DOMRect;
    from.getBoundingClientRect = () => rect(10);
    to.getBoundingClientRect = () => rect(200);
    return { from, to };
  };

  it("does nothing under reduced motion — no element, no animation", async () => {
    calls.length = 0;
    stubMotion(true);
    const { from, to } = boxes();
    await reachMark(from, to, "red");
    await reachToCrown(from, "p1", "red");
    expect(calls).toHaveLength(0);
    expect(document.querySelector(".reach-mark")).toBeNull();
  });

  it("does nothing on a still material (a ladder under 30ms)", async () => {
    calls.length = 0;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ getPropertyValue: (n: string) => (n.startsWith("--d-") ? "1ms" : "") }) as unknown as CSSStyleDeclaration,
    );
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
    const { from, to } = boxes();
    await reachMark(from, to, "red");
    expect(document.querySelector(".reach-mark")).toBeNull();
  });

  it("flies one dot, transform and opacity only, and removes it when done", () => {
    calls.length = 0;
    stubMotion(false);
    const { from, to } = boxes();
    void reachMark(from, to, "red");
    expect(document.querySelectorAll(".reach-mark")).toHaveLength(1);
    expect(calls).toHaveLength(1);
    for (const f of calls[0].kf) {
      for (const k of Object.keys(f)) expect(["transform", "opacity", "offset"]).toContain(k);
    }
    expect(calls[0].opts.duration).toBe(680);
  });

  it("no crown mounted → no target, no Reach", async () => {
    calls.length = 0;
    stubMotion(false);
    const from = document.createElement("div");
    document.body.append(from);
    expect(crownTarget("p1")).toBeNull();
    await reachToCrown(from, "p1", "red");
    expect(calls).toHaveLength(0);
  });
});

void React;
