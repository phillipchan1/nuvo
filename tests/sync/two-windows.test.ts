import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { idbAllOps, idbAppendOp, idbDeleteOps, idbPutOp, resetIdbForTests } from "../../src/lib/sync/idb";
import { ack, enqueue, pendingOps, recordFailure } from "../../src/lib/sync/outbox";
import type { Op } from "../../src/lib/sync/ops";

/**
 * The desktop shell runs two WKWebViews — the main window and the ⌥Space panel
 * — over one IndexedDB, so both drain the same queue. Interleaving them is
 * routine, and the outbox has to survive it.
 */

function wipeStorage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
}

function newTask(id: string) {
  return {
    table: "tasks" as const,
    kind: "insert" as const,
    rowId: id,
    payload: { title: id, status: "inbox" },
    ts: new Date(1_700_000_000_000).toISOString(),
  };
}

describe("two windows over one outbox", () => {
  beforeEach(wipeStorage);

  it("does not resurrect an op the other window already acked", async () => {
    const stored = await enqueue(newTask("a"));

    // Window B delivers it and retires it.
    await ack([stored]);
    expect(await pendingOps()).toEqual([]);

    // Window A was mid-send when that happened and now records its blip
    // against the op it read a moment ago.
    await recordFailure(stored, "Failed to fetch", false);

    expect(
      await pendingOps(),
      "a delivered op came back from the dead and will be re-sent forever",
    ).toEqual([]);
  });

  it("still records a failure against an op that is genuinely still queued", async () => {
    const stored = await enqueue(newTask("a"));

    await recordFailure(stored, "Failed to fetch", false);

    const all = await idbAllOps<Op>();
    expect(all).toHaveLength(1);
    expect(all[0].attempts).toBe(1);
    expect(all[0].lastError).toBe("Failed to fetch");
  });

  it("a deleted op stays deleted even when written back directly", async () => {
    const seq = await idbAppendOp({ table: "tasks", rowId: "a", kind: "insert", attempts: 0 });
    await idbDeleteOps([seq]);

    await idbPutOp({ seq, table: "tasks", rowId: "a", kind: "insert", attempts: 3 } as never);

    expect(await idbAllOps()).toEqual([]);
  });
});
