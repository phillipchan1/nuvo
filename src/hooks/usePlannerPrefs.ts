// On Deck planner preferences — client-side, no DB round-trip. Two knobs: how many
// projects you'll allow committed to a single week, and how many initiatives to a
// single quarter, before the planner flags the lane as overloaded (Phil runs a
// focused few at a time). Kept local (not user_settings) so they need no migration;
// reactive across the Settings control and the planners via a custom event.

import { useEffect, useState } from "react";

const WEEK_KEY = "nuvo.ondeck.maxPerWeek";
const QUARTER_KEY = "nuvo.ondeck.maxPerQuarter";
const EVT = "nuvo-planner-prefs";
export const MAX_PER_WEEK_DEFAULT = 2;
export const MAX_PER_QUARTER_DEFAULT = 3;

function readCap(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n >= 1 && n <= 6 ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeCap(key: string, n: number): void {
  try {
    localStorage.setItem(key, String(n));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

/** Reactive read of a planner cap knob + its setter, kept in sync across tabs
 *  and the Settings control via the shared planner-prefs event. */
function useCap(key: string, fallback: number): [number, (n: number) => void] {
  const [v, setV] = useState(() => readCap(key, fallback));
  useEffect(() => {
    const sync = () => setV(readCap(key, fallback));
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [key, fallback]);
  return [v, (n: number) => { writeCap(key, n); setV(n); }];
}

export const getMaxPerWeek = () => readCap(WEEK_KEY, MAX_PER_WEEK_DEFAULT);
export const setMaxPerWeek = (n: number) => writeCap(WEEK_KEY, n);
export const getMaxPerQuarter = () => readCap(QUARTER_KEY, MAX_PER_QUARTER_DEFAULT);
export const setMaxPerQuarter = (n: number) => writeCap(QUARTER_KEY, n);

/** Reactive read of the max-projects-per-week knob + its setter. */
export function useMaxPerWeek(): [number, (n: number) => void] {
  return useCap(WEEK_KEY, MAX_PER_WEEK_DEFAULT);
}

/** Reactive read of the max-initiatives-per-quarter knob + its setter. */
export function useMaxPerQuarter(): [number, (n: number) => void] {
  return useCap(QUARTER_KEY, MAX_PER_QUARTER_DEFAULT);
}
