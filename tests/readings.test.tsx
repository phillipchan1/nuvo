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
import { weekSignificance, type SignificanceTask } from "../supabase/functions/_shared/planningRules";
import { PaceTrack } from "../src/components/progress/PaceTrack";
import { SignificanceLine } from "../src/components/progress/Significance";
import { crownTarget, reachMark, reachToCrown } from "../src/lib/motion";

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

// ── SignificanceLine ────────────────────────────────────────────────────────

describe("SignificanceLine", () => {
  it("says hours, never a percent", () => {
    const { container } = render(<SignificanceLine value={{ initiativeMins: 390, otherMins: 150 }} />);
    expect(container.textContent).toBe("6.5h of 9h toward an initiative");
    expect(container.textContent).not.toContain("%");
  });
  it("stays unsaid below two finished hours, and with no initiatives", () => {
    expect(render(<SignificanceLine value={{ initiativeMins: 60, otherMins: 50 }} />).container.textContent).toBe("");
    expect(render(<SignificanceLine value={null} />).container.textContent).toBe("");
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
