// On Deck planner preferences — client-side, no DB round-trip. Two knobs: how many
// projects you'll allow committed to a single week, and how many initiatives to a
// single quarter, before the planner flags the lane as overloaded (Phil runs a
// focused few at a time). Kept local (not user_settings) so they need no migration;
// reactive across the Settings control and the planners via a custom event.

import { useEffect, useState } from "react";

const WEEK_KEY = "nuvo.ondeck.maxPerWeek";
const QUARTER_KEY = "nuvo.ondeck.maxPerQuarter";
const COVERAGE_HIDDEN_KEY = "nuvo.ondeck.coverageHidden";
const COVERAGE_COLLAPSED_KEY = "nuvo.ondeck.coverageCollapsed";
const EVT = "nuvo-planner-prefs";
export const MAX_PER_WEEK_DEFAULT = 2;
export const MAX_PER_QUARTER_DEFAULT = 3;

// scope-keyed coverage prefs, so projects + initiatives collapse/filter independently
const collapsedKey = (scope: CoverageScope) => (scope === "initiative" ? "nuvo.initiative.coverageCollapsed" : COVERAGE_COLLAPSED_KEY);
const hiddenKey = (scope: CoverageScope) => (scope === "initiative" ? "nuvo.initiative.coverageHidden" : COVERAGE_HIDDEN_KEY);
export type CoverageScope = "ondeck" | "initiative";

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

// ── coverage domain filter — the set of domain ids HIDDEN from the coverage strip.
// Hidden (not shown) so a newly created domain is tracked by default; empty = all.
// Scope-keyed, so projects and initiatives keep independent filters.
function readHidden(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeHidden(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

/** Whether a coverage strip is collapsed to its one-line summary (the deck is the
 *  primary surface, so this reclaims vertical space on demand). Persisted + reactive;
 *  scoped so projects and initiatives collapse independently. */
export function useCoverageCollapsed(scope: CoverageScope = "ondeck"): [boolean, (v: boolean) => void] {
  const key = collapsedKey(scope);
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const sync = () => {
      try {
        setV(localStorage.getItem(key) === "1");
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
  }, [key]);
  return [
    v,
    (next: boolean) => {
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event(EVT));
      setV(next);
    },
  ];
}

/** Reactive read of the hidden-from-coverage domain set + a toggle (scoped). */
export function useCoverageHidden(scope: CoverageScope = "ondeck"): [Set<string>, (id: string) => void] {
  const key = hiddenKey(scope);
  const [v, setV] = useState(() => readHidden(key));
  useEffect(() => {
    const sync = () => setV(readHidden(key));
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [key]);
  return [
    v,
    (id: string) => {
      const next = new Set(readHidden(key));
      next.has(id) ? next.delete(id) : next.add(id);
      writeHidden(key, next);
      setV(next);
    },
  ];
}
