import { useEffect, useRef } from "react";
import { isTypingIn } from "../../lib/a11y";

// [ and ] — a list's own tabs, previous and next (D-223).
//
// Two kinds of tabs, two keys, one rule each:
//   1…N    the PAGE's views, in the PageBar (pageTabKeys, D-221)
//   [  ]   the tabs INSIDE a part of the page — the rail's Today · Inbox · Trash,
//          the Table's Upcoming · Completed · Everything
// So a digit never has to mean two things (D-221 took the rail's 1/2/3 back for
// exactly that), and the tray still has keys. The cycle wraps.
//
// A bare key, so it stands down while you type and under a floating surface,
// and a host gates it to the part that's on screen (`enabled`, read at the
// keystroke). Every tab says it in its hover title: "Today ([ ])", the same
// shape as "Week (1)".

/** The keycap a list's tabs carry. */
export const LIST_TAB_KEYS = "[ ]";

/** "Today ([ ])" — a list tab's hover title. */
export const listTabTitle = (label: string) => `${label} (${LIST_TAB_KEYS})`;

/** The next value in `values` from `current` — ] forward, [ back, wrapping. */
export function stepTab<T>(values: readonly T[], current: T, by: 1 | -1): T | null {
  if (!values.length) return null;
  const i = values.indexOf(current);
  const at = i < 0 ? 0 : (i + by + values.length) % values.length;
  return values[at];
}

/** Binds [ and ] to step through a list's tabs. */
export function useListTabKeys<T>(
  values: readonly T[],
  current: T,
  onChange: (v: T) => void,
  enabled: boolean | (() => boolean) = true,
) {
  const live = useRef({ values, current, onChange, enabled });
  live.current = { values, current, onChange, enabled };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" && e.key !== "]") return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const { values, current, onChange, enabled } = live.current;
      if (!(typeof enabled === "function" ? enabled() : enabled)) return;
      if (isTypingIn(e.target) || document.querySelector("[data-nested-surface]")) return;
      const next = stepTab(values, current, e.key === "]" ? 1 : -1);
      if (next == null) return;
      e.preventDefault();
      onChange(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
