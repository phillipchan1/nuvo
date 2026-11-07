// Native menu keyboard + focus behaviour, for menus that are drawn as a list of
// `role="menuitem"` buttons:
//
//   • on open, focus moves to the menu (first item) — VoiceOver and Tab users
//     land IN it instead of on the row behind it;
//   • ↑/↓ (and Home/End) walk the enabled items, wrapping, like NSMenu;
//   • type-ahead: printable keys jump to the next item whose label starts with
//     what you typed (buffer resets after 600ms);
//   • on close, focus returns to whatever had it before the menu opened.
//
// It never runs an item — Enter/Space on a focused <button> already clicks it.

import { useEffect, useRef, type RefObject } from "react";

const ITEM = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

export function menuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(ITEM)];
}

/** Pure: next index for a ↑/↓/Home/End key, wrapping. */
export function stepIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Pure: index of the next label (after `from`, wrapping) starting with `prefix`. */
export function typeaheadIndex(labels: readonly string[], prefix: string, from: number): number {
  const p = prefix.toLowerCase();
  const n = labels.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k + n) % n;
    if (labels[i].trim().toLowerCase().startsWith(p)) return i;
  }
  return -1;
}

export function useMenuFocus(menuRef: RefObject<HTMLElement | null>, active = true, opts: { typeahead?: boolean } = {}) {
  const { typeahead = true } = opts;
  const buffer = useRef({ text: "", at: 0 });

  useEffect(() => {
    if (!active) return;
    const menu = menuRef.current;
    if (!menu) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the menu itself, not the first item: a pointer-opened menu should
    // not show a lit row until a key is pressed (NSMenu behaves this way).
    if (!menu.hasAttribute("tabindex")) menu.setAttribute("tabindex", "-1");
    menu.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const items = menuItems(menu);
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = stepIndex(e.key, current, items.length);
      if (next != null) {
        e.preventDefault();
        e.stopPropagation();
        items[next]?.focus({ preventScroll: false });
        return;
      }
      if (typeahead && e.key.length === 1 && /\S/.test(e.key)) {
        const now = e.timeStamp || Date.now();
        const b = buffer.current;
        b.text = now - b.at > 600 ? e.key : b.text + e.key;
        b.at = now;
        const labels = items.map((el) => el.dataset.label ?? el.textContent ?? "");
        const hit = typeaheadIndex(labels, b.text, b.text.length > 1 ? current - 1 : current);
        if (hit >= 0) {
          e.preventDefault();
          e.stopPropagation();
          items[hit].focus();
        }
      }
    };
    menu.addEventListener("keydown", onKey);
    return () => {
      menu.removeEventListener("keydown", onKey);
      // Only hand focus back if it is still inside the (closing) menu or lost
      // to <body> — never steal it from something the action focused on purpose.
      const now = document.activeElement;
      if (!now || now === document.body || menu.contains(now)) trigger?.focus?.({ preventScroll: true });
    };
  }, [menuRef, active, typeahead]);
}
