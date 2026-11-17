// Schedule display preferences — client-side, no DB round-trip (same shape as
// usePlannerPrefs: per-device, no migration, reactive across Settings and the
// grid through one window event).

import { useEffect, useState } from "react";

const FADE_PAST_KEY = "nuvo.cal.fadePast";
const EVT = "nuvo-calendar-prefs";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

/**
 * "Fade past days" — the Schedule recedes every day before today so the eye
 * lands on today without hunting. Open work on a past day (a late task, a slot
 * with unticked children) keeps its full ink: the fade quiets what's settled,
 * never what's still owed. Off by default.
 */
export function useFadePastDays(): [boolean, (on: boolean) => void] {
  const [v, setV] = useState(() => readFlag(FADE_PAST_KEY));
  useEffect(() => {
    const sync = () => setV(readFlag(FADE_PAST_KEY));
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [v, (on: boolean) => { writeFlag(FADE_PAST_KEY, on); setV(on); }];
}
