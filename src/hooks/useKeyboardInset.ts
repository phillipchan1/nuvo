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
