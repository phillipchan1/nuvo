import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";

import { resetIdbForTests } from "../../src/lib/sync/idb";
import { enqueue } from "../../src/lib/sync/outbox";
import {
  pullSyncTables,
  refreshOwing,
  resetOwingForTests,
} from "../../src/lib/sync/coordinator";

/**
 * The desktop has no pull of its own.
 *
 * `refetchOnWindowFocus` rides TanStack's focus manager, which listens for
 * `visibilitychange` — a Tauri window that never leaves the foreground never
 * fires it. `refetchOnMount` has already decided. Pull-to-refresh is mobile
 * only. So a task moved on the phone reached the Mac through exactly one
 * channel, the Realtime socket, and a socket that dies takes the whole app
 * stale with it. This is the timer that makes staleness bounded instead.
 */

function setup() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetOwingForTests();
  while (unsubscribes.length) unsubscribes.pop()!();
}

/**
 * A loaded, mounted, stale query — the state a surface the user is looking at
 * is in a few seconds after it last fetched. It has to be *observed*: TanStack
 * only consults `staleTime` for queries with observers, and reports an
 * unobserved one as fresh forever.
 */
const unsubscribes: (() => void)[] = [];

async function seedStale(qc: QueryClient, key: readonly unknown[], data: unknown) {
  const observer = new QueryObserver(qc, {
    queryKey: key,
    queryFn: async () => data,
    staleTime: 0,
    gcTime: Infinity,
  });
  unsubscribes.push(observer.subscribe(() => {}));
  await observer.refetch();
}

const invalidatedKeys = (qc: QueryClient) =>
  qc
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.isInvalidated)
    .map((q) => q.queryKey.join("/"))
    .sort();

function newTask(id: string) {
  return {
    table: "tasks" as const,
    kind: "insert" as const,
    rowId: id,
    payload: { title: id, status: "inbox" },
    ts: new Date(1_700_000_000_000).toISOString(),
  };
}

describe("pullSyncTables", () => {
  beforeEach(setup);

  it("marks the surfaces another device could have changed", async () => {
    await refreshOwing();
    const qc = new QueryClient();
    await seedStale(qc, ["tasks", "inbox"], []);
    await seedStale(qc, ["tasks", "day", "2026-08-21"], []);
    await seedStale(qc, ["slots", "a", "b"], []);

    pullSyncTables(qc);

    expect(invalidatedKeys(qc)).toEqual([
      "slots/a/b",
      "tasks/day/2026-08-21",
      "tasks/inbox",
    ]);
  });

  it("leaves the expensive unfiltered pool and the trash to focus refreshes", async () => {
    await refreshOwing();
    const qc = new QueryClient();
    await seedStale(qc, ["tasks", "all"], []);
    await seedStale(qc, ["tasks", "trashed"], []);

    pullSyncTables(qc);

    expect(invalidatedKeys(qc)).toEqual([]);
  });

  it("never pulls a table this device still owes a write to", async () => {
    await enqueue(newTask("unsent"));
    await refreshOwing();
    const qc = new QueryClient();
    await seedStale(qc, ["tasks", "inbox"], []);
    await seedStale(qc, ["slots", "a", "b"], []);

    pullSyncTables(qc);

    // Slots owe nothing and refresh; tasks wait for the drain.
    expect(invalidatedKeys(qc)).toEqual(["slots/a/b"]);
  });

  it("does nothing before the outbox has been read", async () => {
    const qc = new QueryClient();
    await seedStale(qc, ["tasks", "inbox"], []);

    pullSyncTables(qc);

    expect(invalidatedKeys(qc)).toEqual([]);
  });

  it("leaves queries outside the outbox's tables alone", async () => {
    await refreshOwing();
    const qc = new QueryClient();
    await seedStale(qc, ["external_events", "a", "b"], []);
    await seedStale(qc, ["weather"], {});

    pullSyncTables(qc);

    expect(invalidatedKeys(qc)).toEqual([]);
  });
});
