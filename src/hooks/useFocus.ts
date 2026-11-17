// The focus you're in (D-242) — one small store both the rail and the keys
// read, persisted for the day it started on. Not nav history: Back shouldn't
// drop you out of a block. Not the database: a focus is a view (lib/focus).

import { useSyncExternalStore } from "react";
import { todayISO } from "../lib/dates";
import { sameTarget, type FocusTarget } from "../lib/focus";

/** `pick` — focus is open but asking what to focus on (nothing on the clock). */
export type FocusState = { mode: "on"; target: FocusTarget } | { mode: "pick" } | null;

const KEY = "nuvo-focus";
// The old ⌘. "hide the panels" mode's key — retired with it (D-242).
const RETIRED_KEY = "nuvo-focus-mode";

function load(): FocusState {
  try {
    localStorage.removeItem(RETIRED_KEY);
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { day?: string; target?: FocusTarget };
    // A focus belongs to the day it was started on.
    if (v.day !== todayISO() || !v.target) return null;
    return { mode: "on", target: v.target };
  } catch {
    return null;
  }
}

let state: FocusState = load();
const subs = new Set<() => void>();

function set(next: FocusState) {
  if (next?.mode === "on" && state?.mode === "on" && sameTarget(next.target, state.target)) return;
  state = next;
  try {
    if (next?.mode === "on") localStorage.setItem(KEY, JSON.stringify({ day: todayISO(), target: next.target }));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

export const focusStore = {
  get: () => state,
  focus: (target: FocusTarget) => set({ mode: "on", target }),
  pick: () => set({ mode: "pick" }),
  leave: () => set(null),
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

export function useFocus(): FocusState {
  return useSyncExternalStore(focusStore.subscribe, focusStore.get, focusStore.get);
}
