// The rule a detail popover's position rests on: centred on its anchor once,
// then it follows the anchor and is only nudged to stay on screen. The bug this
// guards is specific — an event popover whose guests and description land a
// round-trip after it opens grew, re-centred, and visibly jumped (D-100).

import { describe, expect, it } from "vitest";
import { ANCHORED_MARGIN, anchoredTop } from "../src/lib/anchoredTop";

const VH = 900;
const anchor = { anchorTop: 400, anchorHeight: 40 };

describe("anchoredTop", () => {
  it("centres on the anchor the first time", () => {
    expect(anchoredTop({ align: "center", ...anchor, height: 200, viewportHeight: VH })).toBe(320);
  });

  it("hugs the anchor's top edge in 'top' align", () => {
    expect(anchoredTop({ align: "top", ...anchor, height: 200, viewportHeight: VH })).toBe(400);
  });

  it("does NOT move when the card grows in place — the whole point", () => {
    const first = anchoredTop({ align: "center", ...anchor, height: 200, viewportHeight: VH });
    // Details land: the card nearly triples in height, anchor hasn't moved.
    const after = anchoredTop({
      align: "center",
      ...anchor,
      height: 560,
      viewportHeight: VH,
      previous: { top: first, anchorTop: anchor.anchorTop },
    });
    expect(after).toBe(first);
  });

  it("follows the anchor's own movement (the grid scrolling under it)", () => {
    const first = anchoredTop({ align: "center", ...anchor, height: 200, viewportHeight: VH });
    const scrolled = anchoredTop({
      align: "center",
      anchorTop: anchor.anchorTop - 120,
      anchorHeight: anchor.anchorHeight,
      height: 200,
      viewportHeight: VH,
      previous: { top: first, anchorTop: anchor.anchorTop },
    });
    expect(scrolled).toBe(first - 120);
  });

  it("lifts by exactly the overflow when growth would run off the bottom", () => {
    const first = anchoredTop({ align: "center", ...anchor, height: 200, viewportHeight: VH });
    expect(first).toBe(320);
    const grown = anchoredTop({
      align: "center",
      ...anchor,
      height: 700,
      viewportHeight: VH,
      previous: { top: first, anchorTop: anchor.anchorTop },
    });
    // 320 + 700 = 1020 > 900 - 8, so it sits at the last position that fits.
    expect(grown).toBe(VH - 700 - ANCHORED_MARGIN);
  });

  it("never goes above the top margin, however tall it gets", () => {
    const top = anchoredTop({
      align: "center",
      anchorTop: 20,
      anchorHeight: 20,
      height: 1200,
      viewportHeight: VH,
    });
    expect(top).toBe(ANCHORED_MARGIN);
  });

  it("re-centres when the anchor changes (a different block was clicked)", () => {
    // No `previous` — that is how the hook signals a new anchor.
    const other = anchoredTop({
      align: "center",
      anchorTop: 700,
      anchorHeight: 40,
      height: 200,
      viewportHeight: VH,
    });
    expect(other).toBe(620);
  });
});
