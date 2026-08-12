/**
 * Making the app openable offline.
 *
 * The outbox keeps unsent *writes* safe. This keeps the *reads* — without it,
 * launching Nuvo with no network showed an empty planner, because every query
 * cache lived in memory and died with the process. For a planner that is close
 * to useless: the whole point of the phone in your pocket on a plane is seeing
 * what you committed to this week.
 *
 * The dehydrated cache goes in the same IndexedDB as the outbox, so a storage
 * failure degrades both together rather than leaving the app half-persistent.
 *
 * Two things are deliberately *not* persisted:
 *
 *  • **Anything auth-scoped that outlives a sign-out.** `clearPersistedCache`
 *    runs on sign-out; leaving one tenant's tasks on disk for the next person to
 *    sign in on that device would be a cross-account data leak in an app that
 *    is explicitly multi-tenant.
 *
 *  • **Failed or fetching queries.** Rehydrating an error state makes the app
 *    open broken; rehydrating a half-fetched one makes it open stale-and-lying.
 */

import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { idbDelete, idbGet, idbSet } from "./idb";

const CACHE_KEY = "query-cache";

/** Older than this and we prefer an empty app to a misleading one. */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Trailing-edge gap between disk writes. Every cache change used to
 *  re-serialize the whole client (hundreds of tasks + a thousand events) into
 *  IndexedDB on the main thread — 130ms frames during a *cancelled* drag. The
 *  cache is a read replica, not the write path (the outbox is), so losing the
 *  last few seconds of it costs nothing but a refetch. */
const PERSIST_THROTTLE_MS = 5_000;

// Module scope, not closure scope: `clearPersistedCache` (sign-out) must be
// able to cancel a queued write too, or a throttled persist landing after the
// wipe puts the signed-out account's cache back on disk.
let latest: PersistedClient | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWrite = 0;

const write = async () => {
  if (latest === null) return;
  const client = latest;
  latest = null;
  lastWrite = Date.now();
  await idbSet(CACHE_KEY, client);
};

// Fire after the throttle gap, and even then wait for an idle slice so the
// serialize+clone never lands inside an interaction frame. The timeout keeps
// a busy tab from deferring the write forever.
const scheduleWrite = () => {
  if (timer) return;
  const wait = Math.max(0, PERSIST_THROTTLE_MS - (Date.now() - lastWrite));
  timer = setTimeout(() => {
    timer = null;
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => void write(), { timeout: 2_000 });
    } else {
      void write();
    }
  }, wait);
};

const cancelPending = () => {
  latest = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};

// A backgrounded PWA can be frozen or killed before the throttle fires —
// flush what's pending the moment the tab goes hidden.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void write();
  });
}

export function createIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      latest = client;
      scheduleWrite();
    },
    restoreClient: async () => {
      const client = await idbGet<PersistedClient>(CACHE_KEY);
      return client ?? undefined;
    },
    removeClient: async () => {
      // Drop anything queued first — a throttled write landing after this
      // delete would put a signed-out account's cache back on disk.
      cancelPending();
      await idbDelete(CACHE_KEY);
    },
  };
}

/** Wipe the offline read cache. Called on sign-out — see the header. */
export async function clearPersistedCache(): Promise<void> {
  cancelPending();
  await idbDelete(CACHE_KEY);
}

/**
 * Which queries are worth keeping on disk.
 *
 * Only settled, successful ones — and never the decorative or credential-shaped
 * caches. Weather is pointless to restore, and `calendar_accounts` carries
 * provider identity we would rather re-fetch than store.
 */
export const shouldDehydrateQuery = (query: {
  state: { status: string; data: unknown };
  queryKey: readonly unknown[];
  meta?: Record<string, unknown>;
}): boolean => {
  if (query.state.status !== "success" || query.state.data === undefined) return false;
  const root = String(query.queryKey[0] ?? "");
  if (query.meta?.silent) return false;
  return !NEVER_PERSIST.has(root);
};

const NEVER_PERSIST = new Set(["weather", "calendar_accounts", "subscription", "connections"]);
