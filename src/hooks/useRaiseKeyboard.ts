import { useLayoutEffect, type RefObject } from "react";

// 120ms is inside iOS's user-activation window after an in-app tap, and after
// the sheet has started its rise (`--d-base` is 220ms). A focus() called in
// the same turn as mount can still lose to the sheet animation or to
// useDialogFocus; this delay is the original "same gesture" retry.
const GESTURE_FOCUS_MS = 120;

// A lock-screen resume can take longer than 120ms for the webview to become
// first responder. Keep trying for a beat, then stop so a tap on a day chip
// is not stolen back.
const LINGER_AT_MS = [400, 800, 1500] as const;

/**
 * Land the caret in a composer and raise the keyboard.
 *
 * Moments, then stop:
 *   1. Immediately (`useLayoutEffect`) so the field is active before
 *      `useDialogFocus` looks — otherwise the sheet's ✕ wins the race.
 *   2. 120ms later, still inside a real tap's activation window.
 *   3. A few more times over ~1.5s — a widget resume can fire the first
 *      two while the webview is not yet first responder.
 *   4. Once more on the next time the page becomes visible / the window
 *      focuses. Then the resume listener is spent.
 *
 * Linger and resume both refuse to steal focus the user has already moved
 * (a day chip, the close button). The keyboard itself still needs the
 * native WKContentView assist swizzle (D-115) after a widget tap.
 */
export function useRaiseKeyboard<T extends HTMLElement>(ref: RefObject<T>) {
  useLayoutEffect(() => {
    const fieldOwnsFocus = () => {
      const el = ref.current;
      if (!el) return false;
      const active = document.activeElement;
      if (!active || active === el || active === document.body) return true;
      // Something else inside the same dialog already has it — a chip, ✕.
      const dialog = el.closest('[role="dialog"]') ?? el.parentElement;
      return !dialog?.contains(active);
    };

    const focus = () => {
      if (!fieldOwnsFocus()) return;
      ref.current?.focus();
    };

    focus();
    const timers = [GESTURE_FOCUS_MS, ...LINGER_AT_MS].map((ms) => window.setTimeout(focus, ms));

    let resumeUsed = false;
    const onResume = () => {
      if (resumeUsed) return;
      if (document.visibilityState !== "visible") return;
      resumeUsed = true;
      focus();
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("focus", onResume);
    return () => {
      for (const t of timers) window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [ref]);
}
