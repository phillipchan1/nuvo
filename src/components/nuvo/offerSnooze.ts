/**
 * "Not now" for Nuvo's row offers (D-205) — per device, two weeks
 * (`lib/railOffers.isSnoozed`). The same storage the retired panel used
 * (D-198), so a Not now said there still holds.
 */

import { useSyncExternalStore } from "react";
import { toast } from "sonner";

const SNOOZED = "nuvo.offers.snoozed";

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SNOOZED);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

let snoozed: Record<string, string> = read();
const subs = new Set<() => void>();
const set = (next: Record<string, string>) => {
  snoozed = next;
  try {
    localStorage.setItem(SNOOZED, JSON.stringify(snoozed));
  } catch {
    /* private window — Not now lasts the session */
  }
  subs.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
const snapshot = () => snoozed;

export function snoozeOffer(key: string) {
  set({ ...snoozed, [key]: new Date().toISOString() });
}

export function unsnoozeOffer(key: string) {
  const next = { ...snoozed };
  delete next[key];
  set(next);
}

/** Not now, said once, with its way back. */
export function notNow(key: string) {
  snoozeOffer(key);
  toast("Hidden for two weeks.", { action: { label: "Undo", onClick: () => unsnoozeOffer(key) } });
}

/** The snoozed set — re-renders when a Not now is said anywhere. */
export function useSnoozed(): Record<string, string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
