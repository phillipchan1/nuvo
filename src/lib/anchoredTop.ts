/**
 * Where an anchored popover's top edge goes.
 *
 * Split out of `useAnchoredPosition` (SlideOver.tsx) because it encodes one
 * rule that is easy to undo by accident and expensive when it is:
 *
 *   **A card is centred on its anchor ONCE. After that it follows the anchor's
 *   own movement, and is only ever nudged to stay on screen.**
 *
 * The popover's height is not knowable when it opens — a detail card's guests
 * and description arrive a round-trip later, and a confirm row opens under the
 * footer. Re-deriving the position from the current height on every placement
 * therefore re-centred the card every time it grew, which read as the whole
 * popover jumping a beat after you opened it (D-101). Growth extends a card
 * downward; it does not move it.
 */
export const ANCHORED_MARGIN = 8;

export function anchoredTop({
  align,
  anchorTop,
  anchorHeight,
  height,
  viewportHeight,
  previous,
}: {
  /** "center" sits on the anchor's middle; "top" hugs its top edge. */
  align: "center" | "top";
  anchorTop: number;
  anchorHeight: number;
  /** The height to budget for — the card's own, or a held one. */
  height: number;
  viewportHeight: number;
  /** Where this same anchor was last placed, and where it was then. Absent on
   *  the first placement, or when the anchor itself changed. */
  previous?: { top: number; anchorTop: number };
}): number {
  const fresh = align === "top" ? anchorTop : anchorTop + anchorHeight / 2 - height / 2;
  // Following the anchor by its delta — not re-deriving from it — is what makes
  // a scroll move the card with its block while a re-render moves it by nothing.
  const top = previous ? previous.top + (anchorTop - previous.anchorTop) : fresh;
  return Math.max(
    ANCHORED_MARGIN,
    Math.min(top, viewportHeight - height - ANCHORED_MARGIN),
  );
}
