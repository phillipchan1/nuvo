// Your HOME timezone — the stable zone travel is measured against. Device-local
// (localStorage), like useUiScale / weekReveal / usePlannerPrefs: the device zone
// itself is OS-owned and read live, so the only thing worth persisting is which
// zone counts as "home". Defaults to APP_TZ (the app's established home), so the
// travel indicator works out of the box the first time you land somewhere new.

import { useSyncExternalStore } from "react";
import { APP_TZ } from "../lib/dates";

const KEY = "nuvo.tz.home";

function read(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v;
  } catch {
    /* ignore */
  }
  return APP_TZ;
}

let current = read();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function snapshot(): string {
  return current;
}

export function setHomeTimezone(tz: string): void {
  if (!tz || tz === current) return;
  current = tz;
  try {
    localStorage.setItem(KEY, tz);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** `[homeTz, setHomeTz]` — reactive across every consumer in the app. */
export function useHomeTimezone(): [string, (tz: string) => void] {
  const tz = useSyncExternalStore(subscribe, snapshot, snapshot);
  return [tz, setHomeTimezone];
}
