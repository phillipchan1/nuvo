// The regression net for "I opened the domain and couldn't scroll down."
//
// A Sheet freezes the page behind it by class, not by DOM position:
// `body.sheet-open .mobile-scroll { overflow: hidden !important }`. But a
// sheet's OWN body wears `.mobile-scroll` as well — it wants the same momentum
// scrolling and overscroll containment — so the lock froze the sheet it was
// protecting. Every tall sheet (the open domain, a long task, an event) opened
// fine and then refused to move, and nothing caught it: the markup is right, the
// content overflows, and a programmatic `scrollTop = n` still works on an
// `overflow: hidden` box, so a harness that scrolls by script sees nothing wrong.
// Only a finger does.
//
// This asserts the shape of the cascade in the deployed stylesheet, never a
// copy: the lock exists, the unlock exists, the unlock is scoped INSIDE a
// dialog, it comes after the lock, and it out-specifies it. It also holds every
// sheet's own scroller to the two classes the unlock keys on, since a sheet that
// quietly drops `overflow-y-auto` would re-open the same hole.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/index.css"), "utf8");

const LOCK = "body.sheet-open .mobile-scroll";
const UNLOCK = 'body.sheet-open [role="dialog"] .mobile-scroll.overflow-y-auto';

describe("sheet scrolling — the background lock must not freeze the sheet", () => {
  it("still freezes the scrollers behind an open sheet", () => {
    expect(css).toContain(LOCK);
    expect(css).toContain("body.sheet-open main");
  });

  it("hands scrolling back to a scroller inside the open dialog", () => {
    expect(css).toContain(UNLOCK);
  });

  it("orders the unlock after the lock, so the cascade resolves in its favour", () => {
    // Same !important weight, so the later + more specific rule has to win:
    // the unlock adds [role="dialog"] and .overflow-y-auto over the lock's
    // single class. Order is the tie-breaker we don't want silently reversed.
    expect(css.indexOf(UNLOCK)).toBeGreaterThan(css.indexOf(LOCK));
  });

  it("keeps every sheet's own scroller matching what the unlock keys on", () => {
    // A sheet body that carries `.mobile-scroll` but loses `overflow-y-auto`
    // would be frozen again with no test failing anywhere else.
    const surfaces = [
      "src/components/mobile/detail/MobileDetailSheet.tsx",
      "src/components/mobile/MobileTaskSheet.tsx",
      "src/components/mobile/MobileEventSheet.tsx",
      "src/components/mobile/MobileSearch.tsx",
    ];
    for (const rel of surfaces) {
      const src = readFileSync(join(root, rel), "utf8");
      const scrollers = src.match(/mobile-scroll[^"`]*/g) ?? [];
      expect(scrollers.length, `${rel} has no .mobile-scroll scroller`).toBeGreaterThan(0);
      // Every vertical one must declare the class the unlock matches.
      for (const cls of scrollers) {
        if (!cls.includes("overflow-y-auto") && !cls.includes("overflow-x-auto")) {
          throw new Error(
            `${rel}: a .mobile-scroll ("${cls.trim()}") declares no overflow axis — ` +
              "inside a Sheet the background lock will freeze it.",
          );
        }
      }
    }
  });
});
