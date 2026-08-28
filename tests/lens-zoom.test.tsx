// @vitest-environment jsdom
/**
 * `LensZoom` — the phone Calendar's ZOOM axis (same date, next horizon).
 *
 * This is the motion that exists because standing back to the month and leaning
 * into a day used to be a hard swap: the act that changes the most on screen was
 * the only one with no transition at all, which is most of why changing horizon
 * read as "losing your place". So what has to stay true is simply that the
 * motion RUNS — and that is exactly the part no screenshot can prove, because
 * the whole thing is over in 220ms. Twice now a version of this component has
 * looked correct, typechecked, and animated nothing at all:
 *
 *   · the outgoing layer is a brand-new element every zoom, and a CSS
 *     transition on a just-inserted node needs a painted starting frame React
 *     never gives it — so it sat frozen at scale 1 while the arriving layer
 *     moved: a cross-fade with only one half;
 *   · and two zooms the same way in a row (month → week → day) would not
 *     restart a CSS animation, because nothing about the class had changed.
 *
 * `Element.animate()` has neither problem, and unlike a CSS transition it is
 * *observable*: the component tells the browser exactly what to do, so a test
 * can record the instruction. That is what this file does — it asserts on the
 * keyframes handed to WAAPI, which is the closest a headless DOM gets to
 * asserting on the motion itself.
 */
import { act } from "react";
import { render } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LensZoom, zoomDir, type CalHorizon } from "../src/components/mobile/CalendarChrome";

// ── recording what the component asks the browser for ───────────────────────

class FakeAnimation {
  onfinish: (() => void) | null = null;
  cancelled = false;
  cancel() {
    this.cancelled = true;
  }
}

interface Call {
  el: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  anim: FakeAnimation;
}

let calls: Call[] = [];
const realAnimate = Element.prototype.animate;

beforeEach(() => {
  calls = [];
  Element.prototype.animate = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const anim = new FakeAnimation();
    calls.push({
      el: this,
      keyframes: (keyframes ?? []) as Keyframe[],
      options: (options ?? {}) as KeyframeAnimationOptions,
      anim,
    });
    return anim as unknown as Animation;
  } as Element["animate"];
});

afterEach(() => {
  Element.prototype.animate = realAnimate;
});

/** The keyframe pairs, split by the property each animation drives. */
const scaleCalls = () => calls.filter((c) => "transform" in (c.keyframes[0] ?? {}));
const fadeCalls = () => calls.filter((c) => "opacity" in (c.keyframes[0] ?? {}));

const scaleOf = (c: Call) =>
  (c.keyframes as { transform: string }[]).map((k) =>
    parseFloat(k.transform.replace(/scale\(|\)/g, "")),
  );
const fadeOf = (c: Call) => (c.keyframes as { opacity: number }[]).map((k) => k.opacity);

/** A body per horizon, so the layers are distinguishable in the tree. */
function Harness({ start }: { start: CalHorizon }) {
  const [h, setH] = useState<CalHorizon>(start);
  const [dir, setDir] = useState<ReturnType<typeof zoomDir>>(null);
  return (
    <>
      <button
        data-testid="go"
        onClick={() => {
          // The real surface decides direction as the horizon changes; mirror
          // that ordering so the test exercises the same sequence.
          const next: CalHorizon = h === "month" ? "week" : h === "week" ? "day" : "month";
          setDir(zoomDir(h, next));
          setH(next);
        }}
      />
      <LensZoom zoomKey={h} dir={dir} origin="50% 0%">
        <div data-testid={`body-${h}`}>{h}</div>
      </LensZoom>
    </>
  );
}

/** Finish every animation in flight, the way the browser would. */
function settle() {
  act(() => {
    for (const c of calls) c.anim.onfinish?.();
  });
}

describe("LensZoom", () => {
  it("animates BOTH layers when the horizon changes — the cross-fade has two halves", () => {
    const { getByTestId } = render(<Harness start="month" />);
    expect(calls).toHaveLength(0); // nothing on mount

    act(() => getByTestId("go").click());

    // Two elements, each driven on two properties.
    expect(scaleCalls()).toHaveLength(2);
    expect(fadeCalls()).toHaveLength(2);
    const els = new Set(calls.map((c) => c.el));
    expect(els.size).toBe(2);
  });

  it("sends the outgoing horizon one way and brings the new one the other", () => {
    const { getByTestId } = render(<Harness start="month" />);
    act(() => getByTestId("go").click()); // month → week: leaning IN

    const [leaving, arriving] = scaleCalls();
    // Leaning in, the horizon you left rushes PAST you and the new one rises
    // from under it. Both end where the eye is: the arriving layer lands at 1.
    expect(scaleOf(leaving)).toEqual([1, 1.14]);
    expect(scaleOf(arriving)).toEqual([0.9, 1]);

    const [out, into] = fadeCalls();
    expect(fadeOf(out)).toEqual([1, 0]);
    expect(fadeOf(into)).toEqual([0, 1]);
  });

  it("reverses the scale when you stand back instead of leaning in", () => {
    const { getByTestId } = render(<Harness start="day" />);
    act(() => getByTestId("go").click()); // day → month: standing BACK

    const [leaving, arriving] = scaleCalls();
    expect(scaleOf(leaving)).toEqual([1, 0.9]);
    expect(scaleOf(arriving)).toEqual([1.14, 1]);
  });

  it("eases the scale but runs the fade LINEAR, so the two layers sum to one", () => {
    const { getByTestId } = render(<Harness start="month" />);
    act(() => getByTestId("go").click());

    for (const c of fadeCalls()) expect(c.options.easing).toBe("linear");
    // `--ease-out` is a quint: right for something arriving, and on a
    // cross-dissolve it would put the outgoing horizon at 15% before the eye
    // had found it — the hard swap again, wearing 220ms.
    for (const c of scaleCalls()) expect(c.options.easing).not.toBe("linear");
    for (const c of calls) {
      expect(c.options.duration).toBeGreaterThan(0);
      expect(c.options.fill).toBe("both");
    }
  });

  it("still animates on a SECOND zoom the same way — the CSS-class bug", () => {
    // month → week → day. A CSS animation would not restart here, because
    // nothing about the class changed; this is half of why WAAPI drives it.
    const { getByTestId } = render(<Harness start="month" />);
    act(() => getByTestId("go").click());
    expect(scaleCalls()).toHaveLength(2);
    settle();

    calls = [];
    act(() => getByTestId("go").click());
    expect(scaleCalls()).toHaveLength(2);
    expect(fadeCalls()).toHaveLength(2);
  });

  it("keeps the horizon you left on screen during the zoom, and drops it after", () => {
    const { getByTestId, queryByTestId } = render(<Harness start="month" />);
    act(() => getByTestId("go").click());

    // Both are mounted mid-zoom — that IS the cross-dissolve.
    expect(queryByTestId("body-month")).not.toBeNull();
    expect(queryByTestId("body-week")).not.toBeNull();

    settle();
    expect(queryByTestId("body-month")).toBeNull();
    expect(queryByTestId("body-week")).not.toBeNull();
  });

  it("does not animate a no-op, and never strands the outgoing layer", () => {
    function Static() {
      const [n, setN] = useState(0);
      return (
        <>
          <button data-testid="bump" onClick={() => setN(n + 1)} />
          <LensZoom zoomKey="week" dir={null} origin="50% 0%">
            <div>{n}</div>
          </LensZoom>
        </>
      );
    }
    const { getByTestId } = render(<Static />);
    act(() => getByTestId("bump").click());
    expect(calls).toHaveLength(0);
  });
});

describe("zoomDir", () => {
  it("reads the ladder as a zoom axis, tight to wide", () => {
    expect(zoomDir("day", "month")).toBe("out");
    expect(zoomDir("month", "day")).toBe("in");
    expect(zoomDir("week", "year")).toBe("out");
    expect(zoomDir("year", "week")).toBe("in");
  });

  it("cross-dissolves equal rungs instead of claiming an altitude change", () => {
    // The agenda and the week are both a fortnight's worth of one question.
    expect(zoomDir("week", "schedule")).toBe("lateral");
    expect(zoomDir("schedule", "week")).toBe("lateral");
  });

  it("is silent when nothing changed", () => {
    expect(zoomDir("month", "month")).toBeNull();
  });
});
