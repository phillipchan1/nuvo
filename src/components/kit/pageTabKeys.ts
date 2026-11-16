import { useEffect } from "react";
import { isTypingIn } from "../../lib/a11y";
import type { Choice } from "./Choice";

// 1…9 — the page's own views, one plain digit each.
//
// One rule everywhere: **the number is the tab's place in the bar, and 1 is the
// page's home view.** Schedule's Week · Day · Month · Year · Spread and a Build
// rung's On Deck · Groom · Table · Shipped answer the same keys, and each tab
// carries its digit in its hover title. The sidebar takes ⌘N (which page); the
// page under it takes N (which of its views). Nothing else on a page may spend a
// bare digit — priority and the rail's tabs used to, and that is why it moved.
//
// A bare key, so it stands down while you type, and under a floating surface
// (a menu's own keys come first). A surface that already spent a digit says so
// with preventDefault.

/** The keycap a page's Nth view carries, for its title. */
export const pageTabChord = (n: number) => String(n);

/** Stamps each view's title with its key (unless it already has one). */
export function withPageTabKeys<T extends string>(tabs: readonly Choice<T>[]): Choice<T>[] {
  return tabs.map((t, i) => ({ ...t, title: t.title ?? `${typeof t.label === "string" ? t.label : t.value} (${pageTabChord(i + 1)})` }));
}

/** Binds 1…N to the page's views, in the order the bar draws them. */
export function usePageTabKeys<T extends string>(
  tabs: readonly Choice<T>[],
  onChange: ((v: T) => void) | undefined,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || !onChange) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const tab = tabs[Number(e.key) - 1];
      if (!tab) return;
      if (isTypingIn(e.target) || document.querySelector("[data-nested-surface]")) return;
      e.preventDefault();
      onChange(tab.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, onChange, enabled]);
}
