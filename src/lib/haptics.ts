// Haptics — one vocabulary for "the OS would tap your finger here".
//
// Native would use UIImpactFeedbackGenerator / UINotificationFeedbackGenerator:
// a light tap when a long-press arms or a swipe crosses its threshold, a
// success notification on complete, a warning on delete, a selection tick on a
// reorder snap. The web has only the Vibration API, and:
//
//   • iOS Safari and WKWebView (the PWA and the Tauri iOS shell) do NOT
//     implement navigator.vibrate — every call is a silent no-op there.
//   • Android Chrome does, and these patterns map onto it.
//
// So this is deliberately honest: it fires where the platform supports it and
// does nothing (never a fake sound or flash) where it doesn't. The call sites
// are what matter — when a native haptics bridge lands (a Tauri iOS plugin),
// it plugs in HERE and every site lights up at once. See
// docs/native-feel/02-ios-audit.md § Haptics.

export type HapticKind = "selection" | "light" | "medium" | "success" | "warning";

const PATTERN: Record<HapticKind, number | number[]> = {
  selection: 6,
  light: 8,
  medium: 12,
  success: [10, 40, 14],
  warning: [16, 50, 16],
};

export function haptic(kind: HapticKind = "light"): void {
  if (typeof navigator === "undefined") return;
  try {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate?.(PATTERN[kind]);
  } catch {
    /* unsupported — a no-op by design */
  }
}
