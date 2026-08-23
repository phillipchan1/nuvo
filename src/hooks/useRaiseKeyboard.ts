import { useLayoutEffect, type RefObject } from "react";

// 120ms is inside iOS's user-activation window after an in-app tap, and after
// the sheet has started its rise (`--d-base` is 220ms). A focus() called in
// the same turn as mount can still lose to the sheet animation or to
// useDialogFocus; this delay is the original "same gesture" retry.
const GESTURE_FOCUS_MS = 120;

/**
 * Land the caret in a composer and raise the keyboard.
 *
 * Three moments, then stop:
 *   1. Immediately (`useLayoutEffect`) so the field is active before
 *      `useDialogFocus` looks — otherwise the sheet's ✕ wins the race.
 *   2. 120ms later, still inside a real tap's activation window.
 *   3. Once more on the next time the page becomes visible / the window
 *      focuses (`visibilitychange`, `pageshow`, `focus`). A lock-screen
 *      widget tap resumes the app; the 120ms timer can fire while the
 *      webview is not yet first responder, and never retry.
 *
 * The resume retry is once-only so a later tap on a day chip is not stolen
 * back. The keyboard itself still needs a webview user gesture on stock
 * iOS — the native shell turns that off for widget launches (D-115).
 */
export function useRaiseKeyboard<T extends HTMLElement>(ref: RefObject<T>) {
  useLayoutEffect(() => {
    const focus = () => ref.current?.focus();
    focus();
    const t = window.setTimeout(focus, GESTURE_FOCUS_MS);

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
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [ref]);
}
