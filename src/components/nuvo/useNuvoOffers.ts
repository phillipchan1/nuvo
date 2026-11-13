/**
 * The Nuvo panel's offers for the page beside it (D-198) — the live half of
 * `lib/nuvoOffers`. Reads the two sources it serves (thin paths, D-196; Memory's
 * sure questions, D-194) and remembers, per device, what you've seen (the dot)
 * and what you said "Not now" to (two weeks).
 *
 * Memory is passed in, not read here: the surfaces that mount this already hold
 * the one `useMemory` they render from, and a second copy would run the
 * detectors twice (the same reason Memory reaches the Schedule as a prop).
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useThinPaths } from "../../hooks/useThinPaths";
import type { MemoryItem } from "../../hooks/useMemory";
import { composeOffers, hasUnseen, type Offer } from "../../lib/nuvoOffers";

/** What the offers need from Memory — the live hook satisfies it. */
export interface OfferMemorySource {
  items: MemoryItem[];
  learning: boolean;
  available: boolean;
  keep: (item: MemoryItem) => Promise<void> | void;
  refuse: (item: MemoryItem) => void;
  markSeen: () => void;
}

// ── per-device memory of the door: seen keys and "Not now" ─────────────────────

const SEEN = "nuvo.offers.seen";
const SNOOZED = "nuvo.offers.snoozed";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window — the dot simply doesn't remember */
  }
}

let seen: string[] = read<string[]>(SEEN, []);
let snoozed: Record<string, string> = read<Record<string, string>>(SNOOZED, {});
let version = 0;
const subs = new Set<() => void>();
const bump = () => {
  version++;
  subs.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
const snapshot = () => version;

export function snoozeOffer(key: string) {
  snoozed = { ...snoozed, [key]: new Date().toISOString() };
  write(SNOOZED, snoozed);
  bump();
}
export function unsnoozeOffer(key: string) {
  const next = { ...snoozed };
  delete next[key];
  snoozed = next;
  write(SNOOZED, snoozed);
  bump();
}

export function useNuvoOffers({ memory, projectId }: { memory: OfferMemorySource | null; projectId?: string | null }) {
  const thin = useThinPaths();
  const v = useSyncExternalStore(subscribe, snapshot, snapshot);

  const fresh = useMemo(
    () => (memory && memory.learning && memory.available ? memory.items.filter((i) => i.section === "new" && i.observation) : []),
    [memory],
  );

  const offers: Offer[] = useMemo(
    () =>
      composeOffers({
        thin: [...thin.values()],
        memory: fresh.map((i) => ({ key: i.key, statement: i.described.statement, evidence: i.described.evidence, keep: i.described.keep })),
        projectId: projectId || null,
        snoozed,
      }),
    // `v` re-reads the module's snoozed set after a Not now
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thin, fresh, projectId, v],
  );

  const unseen = useMemo(() => hasUnseen(offers, seen), [offers, v]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Looking spends the dot — the panel's and Memory's alike. */
  const markSeen = useCallback(() => {
    if (!offers.length) return;
    const next = [...new Set([...seen, ...offers.map((o) => o.key)])].slice(-200);
    if (next.length !== seen.length) {
      seen = next;
      write(SEEN, seen);
      bump();
    }
    if (offers.some((o) => o.kind === "memory")) memory?.markSeen();
  }, [offers, memory]);

  const memoryItem = useCallback((o: Offer) => fresh.find((i) => i.key === o.memoryKey) ?? null, [fresh]);

  return { offers, unseen, markSeen, memoryItem };
}

export type NuvoOffersState = ReturnType<typeof useNuvoOffers>;
