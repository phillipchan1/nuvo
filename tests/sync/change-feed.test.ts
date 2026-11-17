import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The change feed (D-238). On the Worker path nothing pushes, and the client
 * used to keep up by re-downloading every list on every focus and every minute
 * — ~1.5 GB a day of Neon transfer from one open Mac. These pin the new
 * contract: ask what moved, paint only that, refetch only what can't be painted.
 */

const rpc = vi.fn();
// supabase-js's builder: `.rpc(...)` then `.abortSignal(...)` is what's awaited.
vi.mock("../../src/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => ({ abortSignal: () => rpc(...args) }) },
}));

import { resetIdbForTests } from "../../src/lib/sync/idb";
import { enqueue } from "../../src/lib/sync/outbox";
import {
  catchUpAfterOwingKnown,
  pullSyncTables,
  refreshOwing,
  resetOwingForTests,
  syncNow,
} from "../../src/lib/sync/coordinator";
import {
  FEED_STATE_KEY,
  feedHealth,
  feedOwnsFreshness,
  feedStaleTime,
  holdFeedUntilRestored,
  installFeed,
  pollFeed,
  resetFeedForTests,
} from "../../src/lib/sync/feed";
import { isTableLive, resetLiveHealthForTests } from "../../src/lib/sync/liveHealth";
import { resetWorkersEnabledForTests, setWorkersEnabled } from "../../src/lib/backend";

const unsubscribes: (() => void)[] = [];

beforeEach(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetOwingForTests();
  resetLiveHealthForTests();
  resetFeedForTests();
  rpc.mockReset();
  setWorkersEnabled(true);
  await refreshOwing();
});

afterEach(() => {
  while (unsubscribes.length) unsubscribes.pop()!();
  resetWorkersEnabledForTests();
});

function client() {
  const qc = new QueryClient();
  installFeed(qc);
  return qc;
}

/** A mounted list — observed, so refetch and staleness behave as on screen. */
async function mounted(qc: QueryClient, key: readonly unknown[], data: unknown) {
  const fetches = { n: 0 };
  const observer = new QueryObserver(qc, {
    queryKey: key,
    queryFn: async () => {
      fetches.n++;
      return data;
    },
    gcTime: Infinity,
    staleTime: feedStaleTime(0),
  });
  unsubscribes.push(observer.subscribe(() => {}));
  await observer.refetch();
  fetches.n = 0;
  return fetches;
}

const invalidated = (qc: QueryClient) =>
  qc
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.isInvalidated)
    .map((q) => q.queryKey.join("/"))
    .sort();

const answer = (data: unknown) => ({ data, error: null, status: 200 });

const settingsRow = { user_id: "u", theme: "dark" };

describe("the change feed — delta", () => {
  it("paints a changed row into the lists that hold it, and refetches nothing", async () => {
    const qc = client();
    qc.setQueryData(FEED_STATE_KEY, { cursor: "10" });
    const fetches = await mounted(qc, ["settings"], { user_id: "u", theme: "light" });
    rpc.mockResolvedValueOnce(
      answer({ mode: "delta", cursor: "12", reset: false, changes: [{ table: "user_settings", eventType: "UPDATE", new: settingsRow, old: null }] }),
    );

    await pollFeed(qc);

    // A launch's first question always reaches Postgres (D-245).
    expect(rpc).toHaveBeenCalledWith("sync_changes", { p_since: "10", p_fresh: true });
    expect(qc.getQueryData<{ theme: string }>(["settings"])?.theme).toBe("dark");
    expect(invalidated(qc)).toEqual([]);
    expect(fetches.n).toBe(0);
    expect(qc.getQueryData(FEED_STATE_KEY)).toEqual({ cursor: "12" });
  });

  it("only the launch and a poll after this device's own write ask past the change marker (D-245)", async () => {
    const qc = client();
    qc.setQueryData(FEED_STATE_KEY, { cursor: "10" });
    rpc.mockResolvedValue(answer({ mode: "delta", cursor: "10", reset: false, changes: [] }));

    await pollFeed(qc);
    expect(rpc).toHaveBeenLastCalledWith("sync_changes", { p_since: "10", p_fresh: true });

    await pollFeed(qc, { force: true });
    expect(rpc).toHaveBeenLastCalledWith("sync_changes", { p_since: "10", p_fresh: true });

    // A plain minute poll: the marker may answer it.
    const later = Date.now() + 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      await pollFeed(qc);
    } finally {
      clock.mockRestore();
    }
    expect(rpc).toHaveBeenLastCalledWith("sync_changes", { p_since: "10" });
  });

  it("removes a row the server deleted", async () => {
    const qc = client();
    qc.setQueryData(FEED_STATE_KEY, { cursor: "1" });
    await mounted(qc, ["labels"], [{ id: "l1", name: "a" }, { id: "l2", name: "b" }]);
    rpc.mockResolvedValueOnce(
      answer({ mode: "delta", cursor: "2", reset: false, changes: [{ table: "labels", eventType: "DELETE", new: null, old: { id: "l1" } }] }),
    );

    await pollFeed(qc);

    expect(qc.getQueryData<{ id: string }[]>(["labels"])?.map((l) => l.id)).toEqual(["l2"]);
  });

  it("marks the synced tables live, so a write settles from the feed instead of a refetch", async () => {
    const qc = client();
    rpc.mockResolvedValueOnce(answer({ mode: "delta", cursor: "5", reset: true, changes: [] }));
    await pollFeed(qc);
    expect(feedHealth()).toBe("delta");
    expect(isTableLive("tasks")).toBe(true);
  });

  it("refetches every covered list once when the cursor is unknown (reset)", async () => {
    const qc = client();
    await mounted(qc, ["tasks", "inbox"], []);
    await mounted(qc, ["external_events", "a", "b"], []);
    rpc.mockResolvedValueOnce(answer({ mode: "delta", cursor: "7", reset: true, changes: [] }));

    await pollFeed(qc);

    expect(rpc).toHaveBeenCalledWith("sync_changes", { p_since: null, p_fresh: true });
    expect(qc.getQueryData(FEED_STATE_KEY)).toEqual({ cursor: "7" });
    // The refetch already ran (active queries refetch on invalidate).
    expect(invalidated(qc)).toEqual([]);
  });

  it("holds the cursor when a change could only refetch behind the outbox", async () => {
    const qc = client();
    qc.setQueryData(FEED_STATE_KEY, { cursor: "3" });
    await enqueue({ table: "key_results", kind: "update", rowId: "kr", payload: { name: "x" }, ts: new Date().toISOString() });
    await refreshOwing();
    // key_results has no paint path — it refetches the vertical — and is owed.
    rpc.mockResolvedValueOnce(
      answer({ mode: "delta", cursor: "9", reset: false, changes: [{ table: "key_results", eventType: "UPDATE", new: { id: "kr" }, old: null }] }),
    );

    await pollFeed(qc);

    expect(qc.getQueryData(FEED_STATE_KEY)).toEqual({ cursor: "3" });
  });
});

describe("the change feed — fingerprints (no change log on this Neon yet)", () => {
  it("refetches only the tables whose fingerprint moved", async () => {
    const qc = client();
    const tasks = await mounted(qc, ["tasks", "inbox"], []);
    const labels = await mounted(qc, ["labels"], []);
    rpc.mockResolvedValueOnce(answer({ mode: "version", versions: { tasks: "1.1", labels: "1.1" } }));
    await pollFeed(qc, { force: true });
    expect(tasks.n).toBe(1); // first answer: nothing to compare against
    expect(labels.n).toBe(1);

    rpc.mockResolvedValueOnce(answer({ mode: "version", versions: { tasks: "2.9", labels: "1.1" } }));
    await pollFeed(qc, { force: true });
    expect(tasks.n).toBe(2);
    expect(labels.n).toBe(1);

    rpc.mockResolvedValueOnce(answer({ mode: "version", versions: { tasks: "2.9", labels: "1.1" } }));
    await pollFeed(qc, { force: true });
    expect(tasks.n).toBe(2);
    expect(labels.n).toBe(1);
    expect(isTableLive("tasks")).toBe(false);
  });

  it("keeps an owed table's old fingerprint, so it is asked for again after the drain", async () => {
    const qc = client();
    qc.setQueryData(FEED_STATE_KEY, { versions: { tasks: "1.1" } });
    await enqueue({ table: "tasks", kind: "update", rowId: "t", payload: { title: "x" }, ts: new Date().toISOString() });
    await refreshOwing();
    rpc.mockResolvedValueOnce(answer({ mode: "version", versions: { tasks: "2.2" } }));

    await pollFeed(qc);

    expect(qc.getQueryData(FEED_STATE_KEY)).toEqual({ versions: { tasks: "1.1" } });
  });
});

describe("the change feed — when it can't answer", () => {
  it("stands down on a Worker without the RPC, and the clock takes over again", async () => {
    const qc = client();
    expect(feedOwnsFreshness()).toBe(true);
    expect(feedStaleTime(15_000)()).toBe(Infinity);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "no such function" }, status: 404 });

    await pollFeed(qc);

    expect(feedHealth()).toBe("down");
    expect(feedOwnsFreshness()).toBe(false);
    expect(feedStaleTime(15_000)()).toBe(15_000);
  });

  it("treats a network failure as no answer, and stays in charge", async () => {
    const qc = client();
    rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await pollFeed(qc);
    expect(feedOwnsFreshness()).toBe(true);
  });

  it("is off on the Supabase path", async () => {
    resetWorkersEnabledForTests();
    const qc = client();
    await pollFeed(qc);
    expect(rpc).not.toHaveBeenCalled();
    expect(feedStaleTime(60_000)()).toBe(60_000);
  });

  it("waits for the persisted cache before it asks", async () => {
    const qc = client();
    const release = holdFeedUntilRestored(60_000);
    rpc.mockResolvedValue(answer({ mode: "delta", cursor: "1", reset: true, changes: [] }));
    const polled = pollFeed(qc);
    await new Promise((r) => setTimeout(r, 10));
    expect(rpc).not.toHaveBeenCalled();
    release();
    await polled;
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("asks once when focus and visibility fire together", async () => {
    const qc = client();
    rpc.mockResolvedValue(answer({ mode: "delta", cursor: "1", reset: false, changes: [] }));
    await pollFeed(qc);
    await pollFeed(qc);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("the coordinator asks the feed instead of refetching", () => {
  it("the minute's pull refetches nothing", async () => {
    const qc = client();
    const fetches = await mounted(qc, ["tasks", "inbox"], []);
    rpc.mockResolvedValue(answer({ mode: "delta", cursor: "1", reset: false, changes: [] }));

    pullSyncTables(qc);
    await new Promise((r) => setTimeout(r, 0));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fetches.n).toBe(0);
    expect(invalidated(qc)).toEqual([]);
  });

  it("the focus catch-up leaves covered lists to the feed and refreshes the rest", async () => {
    const qc = client();
    await mounted(qc, ["tasks", "inbox"], []);
    const other = new QueryObserver(qc, { queryKey: ["weather"], queryFn: async () => ({}), staleTime: 0 });
    unsubscribes.push(other.subscribe(() => {}));
    await other.refetch();
    let weatherFetches = 0;
    other.setOptions({ queryKey: ["weather"], queryFn: async () => (weatherFetches++, {}), staleTime: 0 });
    rpc.mockResolvedValue(answer({ mode: "delta", cursor: "1", reset: false, changes: [] }));

    catchUpAfterOwingKnown(qc);
    await new Promise((r) => setTimeout(r, 0));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(weatherFetches).toBe(1);
  });

  it("a delivered write on a live table is settled by a forced poll, not a refetch of every list", async () => {
    const qc = client();
    rpc.mockResolvedValueOnce(answer({ mode: "delta", cursor: "1", reset: true, changes: [] }));
    await pollFeed(qc);
    const fetches = await mounted(qc, ["tasks", "inbox"], []);
    await enqueue({ table: "tasks", kind: "update", rowId: "t", payload: { title: "x" }, ts: new Date().toISOString() });
    await refreshOwing();
    rpc.mockResolvedValue(answer({ mode: "delta", cursor: "2", reset: false, changes: [] }));

    await syncNow({ qc, transport: { send: async () => ({ ok: true as const }) } });
    await new Promise((r) => setTimeout(r, 0));

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(fetches.n).toBe(0);
  });
});
