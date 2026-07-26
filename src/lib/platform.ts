// Runtime platform detection for the Tauri desktop wrapper.
//
// The same dist/ bundle runs on the web (Vercel), as an installed iOS PWA, and
// inside the Tauri macOS app. Desktop-only surfaces — the overlay title-bar
// insets, the ⌥Space spotlight, and the auto-updater — must be gated on these
// checks. Consolidates the `"__TAURI_INTERNALS__" in window` sniff that was
// duplicated across main.tsx / useUpdater.ts / App.tsx.

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True inside the Tauri app on a touch device. Nuvo only ships a macOS desktop
 *  Tauri app today (iOS is a PWA, not a Tauri build), but iPadOS masquerades as
 *  "Macintosh" in the UA, so multi-touch is the tell if that ever changes. */
export function isMobileTauri(): boolean {
  if (!isTauri()) return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
}

/** Tauri on an actual desktop (macOS) — the only place the overlay title bar,
 *  traffic-light insets, and auto-updater exist. */
export function isDesktopTauri(): boolean {
  return isTauri() && !isMobileTauri();
}

/** True on macOS (whether in Tauri or a Mac browser) — used for the wordmark /
 *  traffic-light chrome. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    navigator.userAgent.includes("Mac") ||
    navigator.platform === "MacIntel" ||
    navigator.platform === "MacArm"
  );
}
