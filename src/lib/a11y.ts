/**
 * Keyboard operability helpers.
 *
 * The app is built out of rows, cards and slots that are `<div>`s for good
 * reasons — a task row carries a drag handle, a context menu, swipe gestures
 * and nested buttons, none of which survive being wrapped in a `<button>`
 * (nested interactive elements are invalid HTML and browsers flatten them).
 *
 * The cost is that a `<div onClick>` is invisible to the keyboard: no tab stop,
 * no Enter, nothing for assistive tech to announce. `pressable()` pays that
 * cost back in one place. It returns the four things a div needs to behave the
 * way a button already does, so the fix is a spread rather than four attributes
 * remembered correctly at every call site.
 *
 * Space is `preventDefault`ed because its default action is to scroll the page,
 * which on a long list means activating a row and losing your place at once.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface PressableOptions {
  /** Accessible name, when the element's own text isn't one (an icon, a blank slot). */
  label?: string;
  /** Not focusable and not activatable, matching a disabled button. */
  disabled?: boolean;
  /** `role`. Override when the element is really a row in a grid, an option in a
   *  listbox, etc. — the role has to match how the surface actually behaves. */
  role?: string;
  /** Skip the tab stop but keep Enter/Space. For rows inside a roving-tabindex
   *  list, where the *list* owns one tab stop and ↑↓ moves within it. */
  noTabStop?: boolean;
}

export function pressable(
  onPress: (e: ReactKeyboardEvent<HTMLElement>) => void,
  opts: PressableOptions = {},
) {
  const { label, disabled, role = "button", noTabStop } = opts;
  return {
    role,
    tabIndex: disabled || noTabStop ? -1 : 0,
    "aria-label": label,
    "aria-disabled": disabled || undefined,
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      if (disabled) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      // A keystroke meant for a control *inside* the row (the ✕, the checkbox,
      // an input) must not also fire the row. Only the row's own tab stop acts.
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      e.stopPropagation();
      onPress(e);
    },
  };
}

/**
 * Is the user typing? Single-letter shortcuts (`c`, `p`, `e`, `x`…) have to
 * stand down inside a field, or they eat the character instead of the key.
 *
 * Checks `isContentEditable` as well as tag name because the record spine's
 * inline title editors are contenteditable spans, not inputs — the tag-name-only
 * version of this test let `x` delete the task you were renaming.
 */
export function isTypingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable === true
  );
}
