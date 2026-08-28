// @vitest-environment jsdom
/**
 * What the phone Calendar's chrome is allowed to say, and what it must never do
 * to itself while you use it.
 *
 * All three of these were reported from a real phone rather than caught here,
 * and all three are the kind of thing a screenshot of a *good* state hides: the
 * date printed three times looks fine if you only read one row, and a control
 * that appears mid-gesture is invisible in any single frame. So they get
 * assertions.
 */
import { act } from "react";
import { render } from "@testing-library/react";
import { addDays, format, startOfDay } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CalendarSurface from "../src/components/mobile/CalendarSurface";
import type { DayCtx } from "../src/components/mobile/dayPlan";
import type { Slot, Task } from "../src/lib/types";

class FakeAnimation {
  onfinish: (() => void) | null = null;
  cancel() {}
}
const realAnimate = Element.prototype.animate;
const realRO = globalThis.ResizeObserver;

beforeEach(() => {
  Element.prototype.animate = (() => new FakeAnimation() as unknown as Animation) as Element["animate"];
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

const today = startOfDay(new Date());
const NOW = new Date(today.getTime() + (10 * 60 + 15) * 60_000);
const iso = (h: number, m = 0) => new Date(today.getTime() + (h * 60 + m) * 60_000).toISOString();

const CTX: DayCtx = {
  visibleEvents: [],
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

/** The Today control, which must exist at every horizon and in every span. */
const todayButton = (c: ReturnType<typeof render>) =>
  [...c.container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Today");

describe("the date is stated once", () => {
  it("does not repeat the date beside a hero that already pins the day", () => {
    // `Today` pins a day absolutely, and the week row under it draws the number,
    // so the fact beside it is the day's READ and nothing else. It used to be
    // `Aug 27 · done for today`, under a top bar printing `Thu Aug 27`.
    const c = surface("day");
    const hero = c.container.querySelector("h2");
    expect(hero?.textContent).toBe("Today");

    const fact = hero?.nextElementSibling?.textContent ?? "";
    expect(fact).not.toMatch(new RegExp(format(NOW, "MMM"))); // no "Aug"
    expect(fact).not.toMatch(new RegExp(`\\b${NOW.getDate()}\\b`)); // no bare "27"
  });

  it("puts the date IN the hero for a day no relative word can pin", () => {
    const c = surface("day");
    // Six days out: past Tomorrow, so "Monday" alone would not say which one.
    for (let i = 0; i < 6; i++) act(() => c.getByLabelText("Next day").click());

    const target = addDays(today, 6);
    expect(c.container.querySelector("h2")?.textContent).toBe(format(target, "MMMM d"));
  });

  it("still uses the relative word for tomorrow and yesterday", () => {
    const c = surface("day");
    act(() => c.getByLabelText("Next day").click());
    expect(c.container.querySelector("h2")?.textContent).toBe("Tomorrow");
    act(() => c.getByLabelText("Previous day").click());
    act(() => c.getByLabelText("Previous day").click());
    expect(c.container.querySelector("h2")?.textContent).toBe("Yesterday");
  });
});

describe("Today is permanent", () => {
  it("is mounted on the current span, where it used to be absent", () => {
    const c = surface("day");
    const btn = todayButton(c);
    expect(btn).toBeTruthy();
    // Not a dead control: it re-parks on now.
    expect(btn?.getAttribute("aria-label")).toBe("Back to now");
  });

  it("does not appear or move when you travel off today", () => {
    const c = surface("day");
    const before = todayButton(c)!;
    const beforeClasses = before.className;

    act(() => c.getByLabelText("Next day").click());

    const after = todayButton(c)!;
    // The very same DOM node — not unmounted and rebuilt beside the arrows.
    expect(after).toBe(before);
    expect(after.getAttribute("aria-label")).toBe("Back to today");
    // Both states carry a border (one transparent), so the box cannot change.
    expect(beforeClasses).toContain("border");
    expect(after.className).toContain("border");
  });

  it("is mounted at every horizon", () => {
    for (const m of ["month", "week", "day", "schedule", "year"] as const) {
      const c = surface(m);
      expect(todayButton(c), `Today missing on ${m}`).toBeTruthy();
      c.unmount();
    }
  });
});

describe("recurring upkeep is not in the calendar's chrome", () => {
  it("has no upkeep control at any horizon", () => {
    for (const m of ["month", "week", "day", "schedule", "year"] as const) {
      const c = surface(m);
      expect(
        c.container.querySelector('button[aria-label="Recurring upkeep"]'),
        `upkeep resurfaced on ${m}`,
      ).toBeNull();
      c.unmount();
    }
  });
});
