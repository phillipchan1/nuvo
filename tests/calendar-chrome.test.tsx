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
import { CAL_EDGE, CAL_GUTTER, type CalHero } from "../src/components/mobile/CalendarChrome";
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

/** The chrome does not draw the hero any more — it hands it to the app's top
 *  bar (D-125). So the assertions read the handed object, which is also the
 *  thing that would actually be wrong if the wording drifted. */
const seen: { hero: CalHero | null } = { hero: null };

const surface = (initialMode: "month" | "week" | "day" | "schedule" | "year") => {
  seen.hero = null;
  return render(
    <CalendarSurface
      now={NOW}
      ctx={CTX}
      loading={false}
      weekStartsOn={0}
      weatherIndex={null}
      initialMode={initialMode}
      onHero={(h) => {
        if (h) seen.hero = h;
      }}
    />,
  );
};

/** The Today control, which must exist at every horizon and in every span. */
const todayButton = (c: ReturnType<typeof render>) =>
  [...c.container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Today");

describe("the date is stated once", () => {
  it("does not repeat the date beside a hero that already pins the day", () => {
    // `Today` pins a day absolutely, and the week row under it draws the number,
    // so the fact beside it is the day's READ and nothing else. It used to be
    // `Aug 27 · done for today`, under a top bar printing `Thu Aug 27`.
    surface("day");
    expect(seen.hero?.hero).toBe("Today");

    const fact = seen.hero?.fact ?? "";
    expect(fact).not.toMatch(new RegExp(format(NOW, "MMM"))); // no "Aug"
    expect(fact).not.toMatch(new RegExp(`\\b${NOW.getDate()}\\b`)); // no bare "27"
  });

  it("puts the date IN the hero for a day no relative word can pin", () => {
    const c = surface("day");
    // Six days out: past Tomorrow, so "Monday" alone would not say which one.
    for (let i = 0; i < 6; i++) act(() => c.getByLabelText("Next day").click());

    expect(seen.hero?.hero).toBe(format(addDays(today, 6), "MMMM d"));
  });

  it("still uses the relative word for tomorrow and yesterday", () => {
    const c = surface("day");
    act(() => c.getByLabelText("Next day").click());
    expect(seen.hero?.hero).toBe("Tomorrow");
    act(() => c.getByLabelText("Previous day").click());
    act(() => c.getByLabelText("Previous day").click());
    expect(seen.hero?.hero).toBe("Yesterday");
  });

  it("hands the hero up instead of spending a row on it", () => {
    // The Week lens is the case that forced this: its hero said "This week"
    // directly above a crown strip already saying "This week", and the row cost
    // 40px of the phone's most contested screen (D-125). Nothing in the chrome
    // draws a heading now — the top bar does, in the slot every other tab
    // already reserves for a date.
    for (const m of ["month", "week", "day", "schedule", "year"] as const) {
      const c = surface(m);
      expect(seen.hero, `no hero handed up on ${m}`).toBeTruthy();
      expect(c.container.querySelector("h1, h2"), `${m} still draws a heading`).toBeNull();
      c.unmount();
    }
  });

  it("says This week only where the crown is not already saying it", () => {
    surface("week");
    expect(seen.hero?.hero).toBe("This week");
    // …and it is the TOP BAR that gets it, which is the whole point: the two
    // are no longer on the same screen edge stacked one above the other.
  });
});

describe("capture is one door", () => {
  it("has no ＋ in the chrome at any horizon", () => {
    // Two ＋s, forty pixels apart, each making a different KIND of object was
    // the app asking you to classify a thought before typing it. There is one
    // capture now and it floats over every screen (D-125).
    for (const m of ["month", "week", "day", "schedule", "year"] as const) {
      const c = surface(m);
      for (const label of ["New event", "Quick task", "Capture"]) {
        expect(
          c.container.querySelector(`button[aria-label="${label}"]`),
          `a ＋ resurfaced on ${m}`,
        ).toBeNull();
      }
      c.unmount();
    }
  });
});

describe("one seven-column geometry", () => {
  it("starts the week row's cells exactly where the canvas's columns start", () => {
    // The band measured its inset from 0 while the canvas measured from inside
    // `mx-2`, so Sunday's header sat ~7px left of Sunday's column and the error
    // shrank across the row — seven columns and a half. jsdom has no layout, so
    // the assertion is on the numbers both are built from: one edge, one
    // gutter, no classname coincidences (D-125).
    const c = surface("week");
    const band = c.container.querySelector<HTMLElement>(".grid.grid-cols-7")?.parentElement;
    expect(band).toBeTruthy();
    expect(band!.style.paddingLeft).toBe(`${CAL_EDGE}px`);
    expect(band!.style.paddingRight).toBe(`${CAL_EDGE}px`);
    // …and the gutter that offsets those columns is the shared one.
    expect((band!.firstElementChild as HTMLElement).style.width).toBe(`${CAL_GUTTER}px`);

    // The canvas underneath wears the same edge.
    const canvas = [...c.container.querySelectorAll<HTMLElement>("div")].find(
      (d) => d.style.marginLeft === `${CAL_EDGE}px` && d.style.height,
    );
    expect(canvas, "the week canvas does not share the surface's edge").toBeTruthy();
    expect(canvas!.style.marginRight).toBe(`${CAL_EDGE}px`);
  });

  it("labels the axis column instead of leaving it blank", () => {
    // 38px the band cannot give back (the canvas needs it for `9am`) read as a
    // gap. It carries the one thing seven numerals can't say.
    const c = surface("week");
    const band = c.container.querySelector<HTMLElement>(".grid.grid-cols-7")?.parentElement;
    expect(band!.firstElementChild?.textContent).toBe(format(NOW, "MMM"));
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
