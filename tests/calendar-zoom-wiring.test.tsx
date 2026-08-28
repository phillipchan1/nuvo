// @vitest-environment jsdom
/**
 * The zoom, wired: tapping a rung of the horizon ladder must actually MOVE.
 *
 * `lens-zoom.test.tsx` proves the motion component animates when it is told to.
 * This proves the surface tells it — which is a different claim, and the one
 * that was never true by accident. `LensZoom` can be perfect and the zoom still
 * be a hard swap if `CalendarSurface` hands it a null direction, or a key that
 * doesn't change, or remounts it on every horizon change (a remount resets the
 * component's idea of "the horizon I was showing", so it silently decides
 * nothing happened).
 *
 * None of that is visible in a screenshot: the whole motion is over in 220ms,
 * so the only honest way to see it is to record what the surface asks the
 * browser to animate. Hence a stub over `Element.animate`, and assertions about
 * the ladder rather than about pixels.
 */
import { act } from "react";
import { render } from "@testing-library/react";
import { startOfDay } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CalendarSurface from "../src/components/mobile/CalendarSurface";
import type { DayCtx } from "../src/components/mobile/dayPlan";
import type { ExternalEvent, Slot, Task } from "../src/lib/types";

// ── the environment jsdom doesn't have ──────────────────────────────────────

class FakeAnimation {
  onfinish: (() => void) | null = null;
  cancel() {}
}

let animated: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
const realAnimate = Element.prototype.animate;
const realRO = globalThis.ResizeObserver;

beforeEach(() => {
  animated = [];
  Element.prototype.animate = function (
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    animated.push({
      keyframes: (keyframes ?? []) as Keyframe[],
      options: (options ?? {}) as KeyframeAnimationOptions,
    });
    return new FakeAnimation() as unknown as Animation;
  } as Element["animate"];
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  Element.prototype.animate = realAnimate;
  globalThis.ResizeObserver = realRO;
});

// ── fixtures ────────────────────────────────────────────────────────────────

const today = startOfDay(new Date());
const NOW = new Date(today.getTime() + (10 * 60 + 15) * 60_000);
const iso = (h: number, m = 0) => new Date(today.getTime() + (h * 60 + m) * 60_000).toISOString();

const CTX: DayCtx = {
  visibleEvents: [
    {
      id: "e1",
      account_id: "a1",
      calendar_id: "c1",
      title: "Standup",
      start_at: iso(9),
      end_at: iso(9, 30),
      all_day: false,
      location: null,
      busy: true,
      self_rsvp: null,
    } as ExternalEvent,
  ],
  blocks: [
    { id: "t1", title: "Write launch notes", start_time: iso(13), duration_minutes: 90, status: "ready" } as Task,
  ],
  anytime: [],
  slots: [] as Slot[],
  slotChildren: {},
  slotTitles: new Map(),
  hidden: new Set(),
  workStart: 8 * 60,
  workEnd: 16 * 60 + 30,
  now: NOW,
};

const surface = (initialMode: "month" | "week" | "day" | "schedule" | "year") =>
  render(
    <CalendarSurface
      now={NOW}
      ctx={CTX}
      loading={false}
      weekStartsOn={0}
      weatherIndex={null}
      initialMode={initialMode}
    />,
  );

const scales = () =>
  animated
    .filter((a) => "transform" in (a.keyframes[0] ?? {}))
    .map((a) => (a.keyframes as { transform: string }[]).map((k) => parseFloat(k.transform.replace(/scale\(|\)/g, ""))));

describe("the horizon ladder drives the zoom", () => {
  it("animates when you stand back from the day to the month", () => {
    const { getByLabelText } = surface("day");
    expect(animated).toHaveLength(0);

    act(() => getByLabelText("Month").click());

    // Two layers, each on transform and opacity: the cross-dissolve ran.
    expect(animated).toHaveLength(4);
    expect(scales()).toEqual([
      [1, 0.9], // the day you left shrinks away
      [1.14, 1], // the month arrives over it
    ]);
  });

  it("animates the other way when you lean in from the month", () => {
    const { getByLabelText } = surface("month");
    act(() => getByLabelText("Week").click());

    expect(scales()).toEqual([
      [1, 1.14], // the month rushes past you
      [0.9, 1], // the week rises from under it
    ]);
  });

  it("animates on every rung of a chain, not just the first", () => {
    // Month → Week → Day, the walk that used to stop animating after one step.
    const { getByLabelText } = surface("month");
    act(() => getByLabelText("Week").click());
    expect(scales()).toHaveLength(2);

    animated = [];
    act(() => getByLabelText("Day").click());
    expect(scales()).toHaveLength(2);

    animated = [];
    act(() => getByLabelText("Year").click());
    expect(scales()).toHaveLength(2);
  });

  it("cross-fades between the week and the agenda without a scale", () => {
    const { getByLabelText } = surface("week");
    act(() => getByLabelText("Agenda — the next two weeks").click());

    // Equal rungs: the fade runs, the scale stays at 1 both ways — a scale
    // would claim an altitude change that didn't happen.
    expect(scales()).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it("does nothing when you tap the rung you are already on", () => {
    const { getByLabelText } = surface("week");
    act(() => getByLabelText("Week").click());
    expect(animated).toHaveLength(0);
  });

  it("keeps the chrome mounted across a horizon change", () => {
    // The hero, the ladder and the seven columns are the fixed point the zoom
    // is measured against; if they remount, nothing was persistent.
    const { getByLabelText, container } = surface("day");
    const ladderBefore = getByLabelText("Month");
    const chromeBefore = container.querySelector(".sticky");

    act(() => getByLabelText("Month").click());

    expect(getByLabelText("Month")).toBe(ladderBefore);
    expect(container.querySelector(".sticky")).toBe(chromeBefore);
  });
});
