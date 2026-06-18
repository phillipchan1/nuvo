import { useSyncExternalStore } from "react";

// The warmth axis of the Daybook design language — orthogonal to light/dark.
// A device-local *mood* preference (not synced to the settings row), so it
// needs no migration and switches instantly.
export type Palette = "daybreak" | "fog" | "dusk";

export const PALETTE_LABELS: Record<Palette, { name: string; hint: string }> = {
  daybreak: { name: "Daybreak", hint: "Warm paper" },
  dusk: { name: "Dusk", hint: "Balanced" },
  fog: { name: "Fog", hint: "Cool grey" },
};

const KEY = "nuvo.palette";
const PALETTES: Palette[] = ["daybreak", "fog", "dusk"];

function read(): Palette {
  try {
    const v = localStorage.getItem(KEY) as Palette | null;
    if (v && PALETTES.includes(v)) return v;
  } catch { /* ignore */ }
  return "daybreak";
}

let current: Palette = read();
const listeners = new Set<() => void>();

function apply(p: Palette) {
  if (typeof document !== "undefined") document.documentElement.dataset.palette = p;
}

// Paint the right mood on first load, before React mounts (no flash).
apply(current);

export function setPalette(p: Palette) {
  if (p === current) return;
  current = p;
  try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
  apply(p);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Read + set the active palette. Re-renders all consumers on change. */
export function usePalette(): [Palette, (p: Palette) => void] {
  const palette = useSyncExternalStore(subscribe, () => current, () => current);
  return [palette, setPalette];
}
