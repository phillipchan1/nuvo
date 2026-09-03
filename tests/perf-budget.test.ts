import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Performance guards that `npm test` can actually enforce.
 *
 * Every perf regression found in the 2026-09-03 audits was invisible to
 * typecheck and to the test suite, and each one shipped inside a change that
 * looked purely visual:
 *
 *  - `c557404` ("Aurora") added `backdrop-filter` to `.app-shell` and
 *    `.app-canvas` — two nested FULL-WINDOW blurs that rendered nothing (their
 *    backdrop is flat) and cost 2.4M px² of blur per frame.
 *  - `cf2cc32` put a blur on `.fc-event`, which is one compositing layer per
 *    event — 87 of them on a lived-in week.
 *  - `.fc-event` was transitioning `box-shadow`, contradicting the design law
 *    that says the Schedule's lift is instant, so every click animated a
 *    60px-blur shadow.
 *
 * These are cheap, deterministic checks for exactly those classes of mistake.
 * The expensive, whole-app measurement lives in `npm run perf`.
 *
 * See docs/performance.md and docs/perf-audit-2026-09-03-schedule.md.
 */

const CSS = readFileSync(resolve(__dirname, "../src/index.css"), "utf8");

/** Declarations as [selector, value], with comments stripped so prose about a
 *  property is never mistaken for the property. */
function declarations(prop: string): { selector: string; value: string }[] {
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; value: string }[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(clean))) {
    const selector = m[1].replace(/\s+/g, " ").trim();
    const body = m[2];
    const decl = new RegExp(`(?<!-)\\b${prop}\\s*:\\s*([^;]+)`, "g");
    let d: RegExpExecArray | null;
    while ((d = decl.exec(body))) out.push({ selector, value: d[1].trim() });
  }
  return out;
}

const blurs = () => declarations("backdrop-filter").filter((d) => !d.value.startsWith("none"));

describe("compositing budget", () => {
  /**
   * A `backdrop-filter` costs a compositing layer and a blur of everything
   * beneath it, recomputed whenever that backdrop changes. On a calendar that is
   * every frame of a drag, and WebKit (what Nuvo.app runs) pays far more for it
   * than Chromium does.
   */
  it("never puts a backdrop-filter on a full-bleed structural container", () => {
    // These fill the window. Their backdrop is flat or a linear ramp, so a blur
    // over them is mathematically a no-op — full cost, zero pixels.
    const structural = ["app-shell", "app-canvas", "app-ground", "atmosphere", "nuvo-cal-host"];
    for (const { selector, value } of blurs()) {
      for (const s of structural) {
        expect(
          selector.includes(`.${s}`),
          `\`.${s}\` is a full-bleed container; a backdrop-filter there blurs a flat backdrop — full cost, no visible change (got \`${value}\`)`,
        ).toBe(false);
      }
    }
  });

  it("never puts a backdrop-filter on the calendar's event blocks", () => {
    // One layer per event; a lived-in week is ~87 of them. `.evt-focused` is
    // exempt: it matches one block at a time and earns its keep.
    for (const { selector, value } of blurs()) {
      if (selector.includes("evt-focused")) continue;
      expect(
        /\.fc-event(?![\w-])/.test(selector),
        `\`${selector}\` blurs every calendar event — that is one compositing layer per block (got \`${value}\`)`,
      ).toBe(false);
    }
  });

  it("keeps the number of blurred surfaces inside its budget", () => {
    // Not a ban — a speed bump. Adding a glass surface should be deliberate and
    // should move this number on purpose.
    const found = blurs();
    expect(
      found.length,
      `blurred surfaces: ${found.length}. If this is intentional, raise the budget and say why in the commit:\n` +
        found.map((d) => `  ${d.value}  ${d.selector}`).join("\n"),
    ).toBeLessThanOrEqual(16);
  });
});

describe("the design law is actually what the CSS does", () => {
  /**
   * `docs/design-language.md`: "On the Schedule, the lift is instant.
   * `.fc-event` only transitions `filter` (the hover brightness); shadow +
   * transform apply with no delay." The CSS had drifted from this and was
   * animating --shadow-lift (a 60px blur) up from nothing on every click.
   */
  it("transitions only `filter` on calendar event blocks", () => {
    const evt = declarations("transition").filter((d) => /\.fc\s+\.fc-event(?![\w-])/.test(d.selector));
    expect(evt.length, "expected a transition on `.fc .fc-event`").toBeGreaterThan(0);
    for (const { value } of evt) {
      const props = value
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean);
      expect(
        props,
        "design-language.md says the Schedule's lift is instant — shadow and transform must apply with no delay",
      ).toEqual(["filter"]);
    }
  });
});

describe("the calendar reconcile stays batched", () => {
  /**
   * Each addEvent/setDates/setProp is its own FullCalendar action that
   * re-renders and re-measures the grid. Paging a week re-adds ~80 events:
   * unbatched that measured 24,184 forced layouts and a 1,467ms frame.
   */
  it("wraps the reconcile in batchRendering", () => {
    const src = readFileSync(resolve(__dirname, "../src/lib/syncCalendarEvents.ts"), "utf8");
    expect(src).toMatch(/batchRendering/);
    // the mutations must live in the helper the batch wraps, not in the entry point
    const entry = src.slice(src.indexOf("export function syncCalendarEvents"), src.indexOf("function reconcile"));
    expect(entry, "syncCalendarEvents must delegate, so every mutation is inside the batch").not.toMatch(/\.addEvent\(|\.setProp\(|\.setDates\(/);
  });
});
