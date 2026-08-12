import { useEffect } from "react";

/**
 * Escape closes it.
 *
 * Every menu, popover and picker in the app can be dismissed by clicking the
 * scrim behind it. That is a mouse-only exit: with the keyboard there was
 * nothing to click, so a popover you tabbed into was a popover you could not
 * leave (WCAG 2.1.2, no keyboard trap). This is the other half of that scrim.
 *
 * Capture phase, so a nested popover closes before the surface behind it does —
 * a date picker inside a modal should take one Escape to close the picker and a
 * second to close the modal, not lose both at once. `stopPropagation` is what
 * enforces that: the innermost listener registered wins and the event goes no
 * further.
 */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onEscape();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, onEscape]);
}
