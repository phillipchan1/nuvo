// Whole-UI zoom (⌘= / ⌘- / ⌘0) — device-local, like useSkin.ts. Modeled on
// VS Code/Cursor's zoom, not a "bigger font" toggle: the CSS `zoom` property
// scales the entire rendered page (text, icons, padding, tap targets) together,
// which is the only lever that works here since the type scale (index.css) is
// hardcoded px, not rem — a root font-size multiplier wouldn't cascade into it.
//
// FullCalendar cannot resolve pointer → date under document zoom (upstream
// #2492/#6825). The schedule host counters it with `zoom: 1/var(--ui-scale)` so
// select/create/drag stay accurate; fixed drag ghosts on `document.body` use
// `.fc-event-dragging { zoom: 1/var(--ui-scale) }` + `fixedCssPx()` for the same
// reason.

import { useSyncExternalStore } from "react";
import { toast } from "sonner";

const KEY = "nuvo.uiScale";
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.6;
export const UI_SCALE_STEP = 0.1;
export const UI_SCALE_DEFAULT = 1;

function clamp(n: number): number {
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(n * 100) / 100));
}

function readScale(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    if (Number.isFinite(n)) return clamp(n);
  } catch { /* ignore */ }
  return UI_SCALE_DEFAULT;
}

let scale = readScale();
const listeners = new Set<() => void>();

function apply() {
  if (typeof document === "undefined") return;
  // `--ui-scale` lets position:fixed ghosts (FullCalendar drag mirrors, etc.)
  // counteract document zoom — clientX/getBoundingClientRect are post-zoom,
  // while fixed left/top are pre-zoom layout coords.
  document.documentElement.style.setProperty("--ui-scale", String(scale));
  document.documentElement.style.setProperty("zoom", String(scale));
}

// First paint before React mounts (no flash — default 1 is a no-op anyway).
apply();

function notify() {
  listeners.forEach((l) => l());
}

export function setUiScale(next: number) {
  const clamped = clamp(next);
  if (clamped === scale) return;
  scale = clamped;
  try { localStorage.setItem(KEY, String(scale)); } catch { /* ignore */ }
  apply();
  notify();
  // A stable id so rapid ⌘+/⌘− presses update one toast in place (extending its
  // dismiss timer) instead of stacking — the standard OS volume/brightness-OSD
  // pattern. `unstyled` drops sonner's default 356px card chrome so this can be
  // a small pill instead of a full-size toast.
  toast(`${Math.round(scale * 100)}%`, {
    id: "zoom-level",
    duration: 1200,
    closeButton: false,
    unstyled: true,
    className:
      "glass-card mono inline-flex items-center justify-center rounded-full border border-line px-3 py-1 text-caption text-ink shadow-sm",
  });
}

export function zoomIn() {
  setUiScale(scale + UI_SCALE_STEP);
}

export function zoomOut() {
  setUiScale(scale - UI_SCALE_STEP);
}

export function zoomReset() {
  setUiScale(UI_SCALE_DEFAULT);
}

/** Current whole-UI zoom factor (1 = 100%). */
export function getUiScale(): number {
  return scale;
}

/**
 * Convert a viewport/client coordinate into a CSS `position:fixed` left/top
 * value under the current UI zoom. Without this, fixed elements drift off the
 * cursor whenever zoom ≠ 100%.
 */
export function fixedCssPx(clientPx: number): number {
  return scale === 0 ? clientPx : clientPx / scale;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Read + control the whole-UI zoom level (1 = 100%). */
export function useUiScale(): { scale: number; zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } {
  const s = useSyncExternalStore(subscribe, () => scale, () => scale);
  return { scale: s, zoomIn, zoomOut, zoomReset };
}
