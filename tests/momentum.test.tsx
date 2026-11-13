// @vitest-environment jsdom
/**
 * Momentum — the ambition axis of the design language (D-187,
 * docs/design-language.md § Momentum).
 *
 * Three things have to stay true and none of them shows up in a screenshot:
 *
 *  1. INSTRUMENT SPEAKS IT. The vocabulary is roles (momentum.css declares the
 *     defaults); Instrument, the one material (D-189), restates every role in
 *     its own idiom in styles/instrument.css. A role it forgets silently falls
 *     back to the default — exactly the drift this guards.
 *  2. IT IS CHEAP. Keyframes move transform and opacity only.
 *  3. IT IS EARNED. Progress advances only when it increases after mount; data
 *     arriving, or an undo, never plays it. And a reduced-motion user (or a
 *     ladder that resolves to nothing) never starts one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaceTrack } from "../src/components/progress/PaceTrack";
import { motionOff, parseTime } from "../src/lib/motion";
import { spanElapsed } from "../src/lib/pace";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const MOMENTUM = read("src/styles/momentum.css");
const INSTRUMENT = read("src/styles/instrument.css");

/** The role tokens a material must restate in its own idiom. Durations are
 *  NOT here on purpose: they derive from each material's own --d-* ladder. */
const ROLE_TOKENS = [
  "--ease-land",
  "--ease-momentum",
  "--hero-weight",
  "--track-h",
  "--pace-tick-w",
  "--pace-tick",
  "--landed",
  "--now-wake-h",
];

describe("Instrument speaks momentum", () => {
  it("momentum.css (the defaults) declares every role and every duration", () => {
    for (const t of [...ROLE_TOKENS, "--d-land", "--d-advance", "--d-commit", "--d-stagger", "--d-task-complete"]) {
      expect(MOMENTUM, t).toMatch(new RegExp(`${t}\\s*:`));
    }
  });

  it("instrument.css restates every role token in its MOMENTUM block", () => {
    const block = INSTRUMENT.slice(INSTRUMENT.indexOf("MOMENTUM (D-187)"));
    expect(block.length, "instrument.css has no MOMENTUM block").toBeGreaterThan(20);
    for (const t of ROLE_TOKENS) expect(block, `instrument is missing ${t}`).toMatch(new RegExp(`${t}\\s*:`));
  });

  it("durations derive from the material's own ladder, never a fixed time", () => {
    for (const t of ["--d-land", "--d-advance", "--d-commit", "--d-stagger"]) {
      const decl = new RegExp(`\\n\\s*${t}:\\s*calc\\(var\\(--d-`).test(MOMENTUM);
      expect(decl, `${t} must be calc(var(--d-…) * k)`).toBe(true);
    }
  });
});

describe("momentum is cheap", () => {
  it("every keyframe in momentum.css moves only transform and opacity", () => {
    const frames = [...MOMENTUM.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)];
    expect(frames.length).toBeGreaterThan(3);
    for (const [, name, body] of frames) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity"], `@keyframes ${name} animates ${p}`).toContain(p);
    }
  });

  it("puts no backdrop-filter or filter in the vocabulary", () => {
    expect(MOMENTUM).not.toMatch(/backdrop-filter|(^|[^-])filter\s*:/m);
  });

  it("reduced motion switches every class-driven momentum motion off", () => {
    const reduced = MOMENTUM.slice(MOMENTUM.lastIndexOf("prefers-reduced-motion"));
    for (const c of [".land-stamp", ".land-strike::after", ".commit-band", ".commit-seal", ".arrive"]) {
      expect(reduced).toContain(c);
    }
  });
});

describe("lib/motion", () => {
  it("parses resolved and unresolved times", () => {
    expect(parseTime("352ms")).toBe(352);
    expect(parseTime("0.5s")).toBe(500);
    expect(parseTime("calc(220ms * 1.6)")).toBeCloseTo(352);
    expect(parseTime("")).toBe(0);
  });

  it("treats a ladder that resolves to nothing as reduced motion", () => {
    // jsdom has no stylesheet: --d-land resolves to nothing.
    expect(motionOff()).toBe(true);
  });
});

describe("spanElapsed — the pace tick", () => {
  const now = new Date("2026-11-11T12:00:00"); // a Wednesday noon
  it("is the share of the committed span gone", () => {
    const v = spanElapsed({ startDate: "2026-11-09", targetDate: "2026-11-13" }, now)!;
    expect(v).toBeGreaterThan(0.45);
    expect(v).toBeLessThan(0.55);
  });
  it("clamps before and after the span", () => {
    expect(spanElapsed({ startDate: "2026-11-16", targetDate: "2026-11-20" }, now)).toBe(0);
    expect(spanElapsed({ startDate: "2026-10-01", targetDate: "2026-10-05" }, now)).toBe(1);
  });
  it("says nothing without a span (P7 — never guess a clock)", () => {
    expect(spanElapsed({ startDate: null, targetDate: "2026-11-13" }, now)).toBeNull();
    expect(spanElapsed({ startDate: "2026-11-13", targetDate: null }, now)).toBeNull();
    expect(spanElapsed({ startDate: "2026-11-13", targetDate: "2026-11-01" }, now)).toBeNull();
  });
});

describe("PaceTrack advances only forward, only after mount", () => {
  const calls: { kf: Keyframe[]; opts: KeyframeAnimationOptions }[] = [];
  const TOKENS: Record<string, string> = {
    "--d-land": "352ms",
    "--d-advance": "680ms",
    "--d-stagger": "72ms",
    "--ease-land": "cubic-bezier(0.3, 1.35, 0.55, 1)",
    "--ease-momentum": "cubic-bezier(0.16, 1, 0.3, 1)",
  };
  beforeEach(() => {
    calls.length = 0;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ getPropertyValue: (n: string) => TOKENS[n] ?? "" }) as unknown as CSSStyleDeclaration,
    );
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
    (Element.prototype as unknown as { animate: unknown }).animate = function (kf: Keyframe[], opts: KeyframeAnimationOptions) {
      calls.push({ kf, opts });
      return {} as Animation;
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the state as it is on first render — loading is not progress", () => {
    render(<PaceTrack done={2} total={5} color="var(--accent)" />);
    expect(calls).toHaveLength(0);
  });

  it("a piece done lands its segment on the material's momentum easing", () => {
    const { rerender } = render(<PaceTrack done={2} total={5} color="var(--accent)" />);
    rerender(<PaceTrack done={3} total={5} color="var(--accent)" />);
    expect(calls).toHaveLength(1);
    expect(calls[0].kf).toEqual([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }]);
    expect(calls[0].opts.easing).toBe(TOKENS["--ease-momentum"]);
    expect(calls[0].opts.duration).toBe(352);
  });

  it("a continuous fill advances from where it was", () => {
    const { rerender } = render(<PaceTrack done={6} total={12} color="var(--accent)" />);
    rerender(<PaceTrack done={9} total={12} color="var(--accent)" />);
    expect(calls).toHaveLength(1);
    expect(calls[0].kf[0]).toEqual({ transform: `scaleX(${6 / 9})` });
    expect(calls[0].opts.duration).toBe(680);
  });

  it("an undo snaps — a reversal is not momentum", () => {
    const { rerender } = render(<PaceTrack done={3} total={5} color="var(--accent)" />);
    rerender(<PaceTrack done={2} total={5} color="var(--accent)" />);
    expect(calls).toHaveLength(0);
  });

  it("reduced motion never starts one", () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q })) as unknown as typeof window.matchMedia;
    const { rerender } = render(<PaceTrack done={2} total={5} color="var(--accent)" />);
    rerender(<PaceTrack done={3} total={5} color="var(--accent)" />);
    expect(calls).toHaveLength(0);
  });

  it("draws the pace tick where the span stands, and none without one", () => {
    const { container, rerender } = render(<PaceTrack done={1} total={4} color="red" elapsed={0.5} />);
    expect((container.querySelector(".pace-now") as HTMLElement).style.left).toBe("50%");
    rerender(<PaceTrack done={1} total={4} color="red" elapsed={null} />);
    expect(container.querySelector(".pace-now")).toBeNull();
  });
});

void React;
