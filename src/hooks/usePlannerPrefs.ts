// On Deck planner preferences — client-side, no DB round-trip. The one knob so
// far: how many projects you'll allow committed to a single week before the
// planner flags it as overloaded (Phil runs a focused 1–2 at a time). Kept local
// (not user_settings) so it needs no migration; reactive across the Settings
// control and the planner via a custom event.

import { useEffect, useState } from "react";

const KEY = "nuvo.ondeck.maxPerWeek";
const EVT = "nuvo-planner-prefs";
export const MAX_PER_WEEK_DEFAULT = 2;

export function getMaxPerWeek(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= 1 && n <= 6 ? n : MAX_PER_WEEK_DEFAULT;
  } catch {
    return MAX_PER_WEEK_DEFAULT;
  }
}

export function setMaxPerWeek(n: number): void {
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

/** Reactive read of the max-projects-per-week knob + its setter. */
export function useMaxPerWeek(): [number, (n: number) => void] {
  const [v, setV] = useState(getMaxPerWeek);
  useEffect(() => {
    const sync = () => setV(getMaxPerWeek());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [v, (n: number) => { setMaxPerWeek(n); setV(n); }];
}
