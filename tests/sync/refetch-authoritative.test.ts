import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";

import { resetIdbForTests } from "../../src/lib/sync/idb";
import { enqueue } from "../../src/lib/sync/outbox";
import {
  installOwingGuards,
  preserveOwingRows,
  refreshOwing,
  resetOwingForTests,
} from "../../src/lib/sync/coordinator";
import type { NewOp } from "../../src/lib/sync/ops";
import { queueWrite } from "../../src/lib/sync";

/**
 * A refetch is the server's word on its window. While this device owes a write,
 * `preserveOwingRows` has to hold the rows that write is about — a create the
 * server has not seen yet, a row this device just moved into the list — and
 * nothing else.
 *
 * It used to hold *every* cached id the refetch lacked whenever the table owed
 * anything at all. "Owes anything" is most of a launch: recurrence occurrences
 * materialize on open, a drag queues an update. So a row another device (or the
 * trash purge, or the agent) had deleted came back as a "local-only extra" in
 * whichever fragments happened to refetch in that window, went to disk with the
 * dehydrated cache, and was defended again on the next launch. Seen on the local
 * stack: a re-seed under an open Schedule left every block twice — the deleted
 * ids beside their replacements — through a full reload.
 */

const WEEK = ["tasks", "scheduled", "2026-10-12T07:00:00.000Z", "2026-10-19T07:00:00.000Z"] as const;

function wipe() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetOwingForTests();
}

function op(over: Partial<NewOp> & Pick<NewOp, "rowId">): NewOp {
  return {
    table: "tasks",
    kind: "insert",
    payload: { title: "Shutdown review", status: "planned" },
    ts: new Date(1_700_000_000_000).toISOString(),
    ...over,
  };
}

const block = (id: string, title: string) => ({
  id,
  title,
  status: "planned",
  start_time: "2026-10-15T16:00:00.000Z",
  updated_at: "2026-10-15T19:00:00.000Z",
});

beforeEach(async () => {
  wipe();
  await refreshOwing();
});

describe("a refetch is authoritative for rows this device does not owe", () => {
  it("drops a server-deleted row even while an unrelated write is queued", async () => {
    // An occurrence materialized on launch — the write that makes `tasks` owe.
    await enqueue(op({ rowId: "occurrence-1" }));
    await refreshOwing();

    const previous = [block("deleted-on-phone", "Write case study")];
    const incoming = [block("still-here", "Review billing cutover")];

    const merged = preserveOwingRows("tasks", previous, incoming);

    expect(
      merged.map((r) => r.id),
      "a row the server no longer has was kept because the table owed some other write",
    ).toEqual(["still-here"]);
  });

  it("still keeps a local create the refetch predates", async () => {
    await enqueue(op({ rowId: "typed-on-the-mac" }));
    await refreshOwing();

    const previous = [block("server-a", "Already saved"), block("typed-on-the-mac", "Call David")];
    const incoming = [block("server-a", "Already saved")];

    expect(preserveOwingRows("tasks", previous, incoming).map((r) => r.id)).toEqual([
      "server-a",
      "typed-on-the-mac",
    ]);
  });

  it("still keeps a row this device moved into the window while the move is queued", async () => {
    await enqueue(
      op({
        kind: "update",
        rowId: "dragged-in",
        payload: { start_time: "2026-10-15T16:00:00.000Z", do_date: "2026-10-15" },
      }),
    );
    await refreshOwing();

    const previous = [block("dragged-in", "Pick up kids")];

    expect(preserveOwingRows("tasks", previous, []).map((r) => r.id)).toEqual(["dragged-in"]);
  });

  it("drops a row another device moved out of the window", async () => {
    await enqueue(op({ rowId: "occurrence-1" }));
    await refreshOwing();

    // Rescheduled to next week on the phone: still a row, just not in this window.
    const previous = [block("moved-on-phone", "Haul boxes to donation")];

    expect(preserveOwingRows("tasks", previous, [])).toEqual([]);
  });

  it("holds a week review by its week, the key its ops are addressed by", async () => {
    await enqueue(op({ table: "week_reviews", rowId: "2026-10-12", payload: { report: {} } }));
    await refreshOwing();

    const previous = [
      { id: "server-uuid-1", week_start: "2026-10-12", report: { emblem: "x" } },
      { id: "server-uuid-0", week_start: "2026-10-05", report: { emblem: "y" } },
    ];

    expect(preserveOwingRows("week_reviews", previous, []).map((r) => r.id)).toEqual([
      "server-uuid-1",
    ]);
  });
});

describe("queueWrite names the row it owes", () => {
  it("protects a create from a stale refetch before the op reaches IndexedDB", async () => {
    const qc = new QueryClient();
    installOwingGuards(qc);
    qc.setQueryData(WEEK, [block("deleted-elsewhere", "Vendor demo"), block("typed-now", "Call David")]);

    // Not awaited — the standard optimistic shape. The refetch below lands in
    // the same tick, before the enqueue has committed.
    const queued = queueWrite(op({ rowId: "typed-now" }));
    qc.setQueryData(WEEK, [] as ReturnType<typeof block>[]);

    expect((qc.getQueryData<{ id: string }[]>(WEEK) ?? []).map((r) => r.id)).toEqual(["typed-now"]);
    await queued;
  });
});

describe("the reported case — re-seeded under an open Schedule, then reloaded", () => {
  it("does not carry deleted blocks through a reload while a write is queued", async () => {
    // Before: the open app's week, persisted to disk.
    const before = new QueryClient();
    installOwingGuards(before);
    before.setQueryData(WEEK, [block("old-1", "Write case study"), block("old-2", "Lunch w/ Sam")]);
    const onDisk = JSON.parse(JSON.stringify(dehydrate(before)));

    // The server's rows were hard-deleted and re-inserted under new ids.
    const server = [block("new-1", "Write case study"), block("new-2", "Lunch w/ Sam")];

    // Reload: the cache rehydrates from disk, and launch queues a write (an
    // occurrence materializing) before the week's refetch lands.
    const after = new QueryClient();
    installOwingGuards(after);
    hydrate(after, onDisk);
    await enqueue(op({ rowId: "occurrence-1" }));
    await refreshOwing();

    await after.fetchQuery({ queryKey: WEEK, queryFn: async () => server, staleTime: 0 });

    const week = after.getQueryData<{ id: string }[]>(WEEK) ?? [];
    expect(
      week.map((r) => r.id).sort(),
      "each block shows twice: the deleted ids beside their replacements",
    ).toEqual(["new-1", "new-2"]);
  });
});
