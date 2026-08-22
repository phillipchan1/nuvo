import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { isDurable, resetIdbForTests } from "../../src/lib/sync/idb";
import { enqueue, pendingOps } from "../../src/lib/sync/outbox";

/**
 * The failure this file exists for: IndexedDB is *healthy enough to read* but
 * one write fails. If the append silently falls back to the in-memory store
 * while the readback still comes from IndexedDB, the op is invisible to every
 * drain that follows — the user's capture is gone, with nothing surfaced.
 */

function wipeStorage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
}

function newTask(id: string, title: string) {
  return {
    table: "tasks" as const,
    kind: "insert" as const,
    rowId: id,
    payload: { title, status: "inbox" },
    ts: new Date(1_700_000_000_000).toISOString(),
  };
}

/**
 * Let the DB open and read normally, but make the *next* `ops` write fail the
 * way a transient QuotaExceeded / UnknownError does: the request errors while
 * the database itself stays perfectly usable.
 */
function failNextOpsWrite() {
  const db = globalThis.indexedDB;
  const realOpen = db.open.bind(db);
  let armed = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).open = (...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = (realOpen as any)(...args);
    const origSuccess = Object.getOwnPropertyDescriptor(req, "onsuccess");
    void origSuccess;
    req.addEventListener("success", () => {
      const real = req.result;
      const realTx = real.transaction.bind(real);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (real as any).transaction = (store: string, mode: string) => {
        const t = realTx(store, mode as IDBTransactionMode);
        if (store !== "ops" || mode !== "readwrite" || !armed) return t;
        armed = false;
        const realStore = t.objectStore.bind(t);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (t as any).objectStore = (name: string) => {
          const s = realStore(name);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (s as any).add = () => {
            const fake: Record<string, unknown> = { result: undefined };
            // Error on the next tick, exactly as a rejected request would.
            queueMicrotask(() => {
              (fake.onerror as (() => void) | undefined)?.();
            });
            return fake;
          };
          return s;
        };
        return t;
      };
    });
    return req;
  };
}

describe("outbox durability when a single IndexedDB write fails", () => {
  beforeEach(() => {
    wipeStorage();
  });

  it("does not silently orphan an op whose append failed", async () => {
    failNextOpsWrite();

    // The user captures a task. `enqueue` resolving is the app's promise that
    // the write is safe — it paints the row on that basis and never rolls back.
    await enqueue(newTask("a", "Buy milk"));

    // Everything the device still owes. The append failed, so the op either
    // has to be here (recovered) or the app had to be told it was not durable.
    const pending = await pendingOps();

    expect(
      pending.length > 0 || !isDurable(),
      "an op whose append failed is invisible to the drain AND the app still reports durable storage — the capture is lost with no signal",
    ).toBe(true);
    expect(pending.map((o) => o.rowId)).toContain("a");
  });

  it("keeps a later successful op as well as the recovered one", async () => {
    failNextOpsWrite();

    await enqueue(newTask("a", "First"));
    await enqueue(newTask("b", "Second"));

    const pending = await pendingOps();
    expect(pending.map((o) => o.rowId).sort()).toEqual(["a", "b"]);
  });
});
