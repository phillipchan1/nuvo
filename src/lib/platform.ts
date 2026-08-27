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

/** True inside the Tauri iOS shell (TestFlight / native iPhone app). */
export function isTauriIOS(): boolean {
  if (!isTauri()) return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** True inside the native phone/tablet shell (TestFlight / iPhone app).
 *
 *  Do not use `maxTouchPoints` here. A MacBook trackpad reports 1–5 in WKWebView,
 *  which used to flip the *desktop* app onto MobileShell and hide Developer
 *  mode. iPadOS-as-Macintosh is a Safari lie; this function is already gated
 *  on `isTauri()`, and the iOS shell's UA still says iPhone/iPad. */
export function isMobileTauri(): boolean {
  if (!isTauri()) return false;
  return isTauriIOS() || /Android/i.test(navigator.userAgent);
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

/**
 * True inside the ⌥Space spotlight webview (or the DEV `?spotlight` harness).
 *
 * That window is a second, long-lived client on the same origin as main. It
 * must not run its own token refresh — two heaps rotating one refresh token
 * is `refresh_token_already_used`, and GoTrue revokes the session. See
 * `src/lib/supabase.ts`.
 */
export function isSpotlightWindow(): boolean {
  // DEV-only: `?spotlight` renders the global summon in the browser so its
  // Tauri-only surface can be verified against live data. Tree-shaken from
  // production builds.
  if (import.meta.env.DEV && typeof window !== "undefined") {
    try {
      if (new URLSearchParams(window.location.search).has("spotlight")) return true;
    } catch {
      /* ignore */
    }
  }
  // iOS ships one full-screen window — never the desktop ⌥Space panel.
  if (isMobileTauri()) return false;
  if (!isTauri()) return false;
  try {
    const label = (
      globalThis as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }
    ).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    return label === "spotlight";
  } catch {
    return false;
  }
}
