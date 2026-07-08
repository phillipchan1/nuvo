// Whole-UI zoom (⌘= / ⌘- / ⌘0) — device-local, like useSkin.ts. Modeled on
// VS Code/Cursor's zoom, not a "bigger font" toggle: the CSS `zoom` property
// scales the entire rendered page (text, icons, padding, tap targets) together,
// which is the only lever that works here since the type scale (index.css) is
// hardcoded px, not rem — a root font-size multiplier wouldn't cascade into it.

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
  // dismiss timer) instead of stacking — the standard OS volume/brightness-OSD pattern.
  toast(`Zoom ${Math.round(scale * 100)}%`, { id: "zoom-level", duration: 1200 });
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

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Read + control the whole-UI zoom level (1 = 100%). */
export function useUiScale(): { scale: number; zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } {
  const s = useSyncExternalStore(subscribe, () => scale, () => scale);
  return { scale: s, zoomIn, zoomOut, zoomReset };
}
