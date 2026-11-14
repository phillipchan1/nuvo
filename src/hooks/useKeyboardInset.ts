import { useEffect, useState } from "react";

// How much of the layout viewport the on-screen keyboard is covering, in px.
//
// The mobile shell is `fixed inset-0`, and iOS does not resize the layout
// viewport for the keyboard — it only shrinks the *visual* viewport. So a
// bottom sheet's composer or submit button ends up underneath the keys unless
// something reads visualViewport and pads for it. Apply the returned inset as
// `padding-bottom` on the covered panel (Sheet does this for every sheet).
//
// Returns 0 when visualViewport is unavailable (SSR, very old engines) and on
// platforms whose keyboard already resizes the layout viewport (Android with
// `interactive-widget=resizes-content`), where the difference is ~0.
/**
 * The strip of the layout viewport the person can actually see — the visual
 * viewport. `top` is how far iOS has panned it down the page (it pans to bring a
 * focused field into view), `height` is what the keyboard has left of it.
 *
 * `useKeyboardInset` pads a panel *up* from the bottom, which only works while
 * the panel is shorter than what's left. A panel sized to the screen (search's
 * `tall` sheet) has nothing to give: the padding ate its whole body and the
 * field slid off the top. A panel that is simply *laid out inside this box*
 * can't lose its field however iOS pans or whatever the keyboard's height is.
 *
 * `null` while the keyboard is down (or there's no visualViewport): the box is
 * then the layout viewport and the panel needs no help.
 */
export type ViewportBox = { top: number; height: number };

export function useVisibleViewport(enabled = true): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    const update = () => {
      const covered = window.innerHeight - (vv.height + vv.offsetTop);
      // Under ~80px it is a toolbar settling, not a keyboard.
      const next =
        covered > 80 || vv.offsetTop > 0
          ? { top: Math.round(vv.offsetTop), height: Math.round(vv.height) }
          : null;
      setBox((prev) =>
        prev === next || (prev && next && prev.top === next.top && prev.height === next.height) ? prev : next,
      );
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return box;
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const next = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
      setInset((prev) => (prev === next ? prev : next));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Once the inset settles (keyboard fully risen), nudge the focused field into
  // view above it — iOS only auto-scrolls the visual viewport, not our fixed
  // panels.
  useEffect(() => {
    if (!inset) return;
    const t = window.setTimeout(() => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        el.matches("input, textarea, select, [contenteditable='true']")
      ) {
        el.scrollIntoView({ block: "nearest" });
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [inset]);

  return inset;
}
