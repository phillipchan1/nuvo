import { useEffect } from "react";
import type { Choice } from "./Choice";

// ⌥⌘1…9 — the page's own views, one chord below the sidebar's ⌘1–4.
//
// The sidebar takes ⌘N (the altitude), so the page under it takes ⌥⌘N (which of
// its views): Schedule's Spread · Day · Week · Month · Year and a Build rung's
// On Deck · Groom · Table · Shipped answer the same chord. It's a chord, not a
// character, so like ⌘N it needs no text-field guard. Matched on `e.code`
// because ⌥ turns the digit into a symbol on a Mac keyboard ("¡", "™", …).
// A surface that already spent the chord says so with preventDefault.

/** The keycap a page's Nth view carries, for its title. */
export const pageTabChord = (n: number) => `⌥⌘${n}`;

/** Stamps each view's title with its chord (unless it already has one). */
export function withPageTabKeys<T extends string>(tabs: readonly Choice<T>[]): Choice<T>[] {
  return tabs.map((t, i) => ({ ...t, title: t.title ?? `${typeof t.label === "string" ? t.label : t.value} (${pageTabChord(i + 1)})` }));
}

/** Binds ⌥⌘1…N to the page's views, in the order the bar draws them. */
export function usePageTabKeys<T extends string>(
  tabs: readonly Choice<T>[],
  onChange: ((v: T) => void) | undefined,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || !onChange) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      const tab = m ? tabs[Number(m[1]) - 1] : undefined;
      if (!tab) return;
      e.preventDefault();
      onChange(tab.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, onChange, enabled]);
}
