// On Deck planner preferences — client-side, no DB round-trip. Two knobs: how many
// projects you'll allow committed to a single week, and how many initiatives to a
// single quarter, before the planner flags the lane as overloaded (Phil runs a
// focused few at a time). Kept local (not user_settings) so they need no migration;
// reactive across the Settings control and the planners via a custom event.

import { useEffect, useState } from "react";

const WEEK_KEY = "nuvo.ondeck.maxPerWeek";
const QUARTER_KEY = "nuvo.ondeck.maxPerQuarter";
const WEEKS_SHOWN_KEY = "nuvo.ondeck.weeksShown";
const COVERAGE_HIDDEN_KEY = "nuvo.ondeck.coverageHidden";
const COVERAGE_COLLAPSED_KEY = "nuvo.ondeck.coverageCollapsed";
const EVT = "nuvo-planner-prefs";
export const MAX_PER_WEEK_DEFAULT = 2;
export const MAX_PER_QUARTER_DEFAULT = 3;
export const WEEKS_SHOWN_DEFAULT = 4;
/** The window lengths offered for the deck + coverage (whole weeks). */
export const WEEKS_SHOWN_OPTIONS = [4, 6, 8] as const;

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

/** How many whole weeks the On Deck planner (deck columns + aligned coverage) shows
 *  at once. A near-term default; expandable when you want more runway. */
export function useWeeksShown(): [number, (n: number) => void] {
  const [v, setV] = useState(() => {
    const n = readCap(WEEKS_SHOWN_KEY, WEEKS_SHOWN_DEFAULT);
    return (WEEKS_SHOWN_OPTIONS as readonly number[]).includes(n) ? n : WEEKS_SHOWN_DEFAULT;
  });
  useEffect(() => {
    const sync = () => setV(readCap(WEEKS_SHOWN_KEY, WEEKS_SHOWN_DEFAULT));
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [v, (n: number) => { writeCap(WEEKS_SHOWN_KEY, n); setV(n); }];
}

// ── coverage domain filter — the set of domain ids HIDDEN from the coverage strip.
// Hidden (not shown) so a newly created domain is tracked by default; empty = all.
function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(COVERAGE_HIDDEN_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeHidden(ids: Set<string>): void {
  try {
    localStorage.setItem(COVERAGE_HIDDEN_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

/** Whether the coverage strip is collapsed to its one-line summary (the deck is the
 *  primary surface, so this reclaims vertical space on demand). Persisted + reactive. */
export function useCoverageCollapsed(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(COVERAGE_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const sync = () => {
      try {
        setV(localStorage.getItem(COVERAGE_COLLAPSED_KEY) === "1");
      } catch {
        /* ignore */
      }
    };
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [
    v,
    (next: boolean) => {
      try {
        localStorage.setItem(COVERAGE_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event(EVT));
      setV(next);
    },
  ];
}

/** Reactive read of the hidden-from-coverage domain set + a toggle. */
export function useCoverageHidden(): [Set<string>, (id: string) => void] {
  const [v, setV] = useState(readHidden);
  useEffect(() => {
    const sync = () => setV(readHidden());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [
    v,
    (id: string) => {
      const next = new Set(v);
      next.has(id) ? next.delete(id) : next.add(id);
      writeHidden(next);
      setV(next);
    },
  ];
}
