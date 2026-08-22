import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { resetIdbForTests } from "../../src/lib/sync/idb";
import { enqueue, refreshOutboxStatus } from "../../src/lib/sync/outbox";
import { drain, type SendResult, type Transport } from "../../src/lib/sync/engine";
import {
  preserveOwingRows,
  refreshOwing,
  resetOwingForTests,
} from "../../src/lib/sync/coordinator";

/**
 * A write Postgres refuses is *parked* — kept, surfaced, retriable by hand.
 * The row it describes is still the user's work and is still on screen, so a
 * refetch must not quietly delete it. Before this, `owing` was computed from
 * pending ops alone: the moment an op parked, its table stopped being
 * protected and the very next refetch dropped the row from every cache. The
 * task vanished; only a toast in a settings pane said why.
 */

function wipeStorage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetOwingForTests();
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

const rejecting: Transport = {
  async send(): Promise<SendResult> {
    // A considered refusal — a check constraint, an RLS denial. Never retriable.
    return { ok: false, retriable: false, error: "violates row-level security" };
  },
};

describe("a parked write keeps its row on screen", () => {
  beforeEach(() => {
    wipeStorage();
  });

  it("preserves the parked row through a refetch that does not know about it", async () => {
    await enqueue(newTask("parked-1", "Draft the offsite agenda"));
    await drain(rejecting);
    const status = await refreshOutboxStatus();
    expect(status.parked).toBeGreaterThan(0);
    expect(status.pending).toBe(0); // nothing left to send — the queue is "clean"

    await refreshOwing();

    // What the UI is holding, and what a refetch of the inbox returns. The
    // server never accepted the row, so it is simply absent.
    const previous = [
      { id: "server-a", title: "Already saved" },
      { id: "parked-1", title: "Draft the offsite agenda" },
    ];
    const incoming = [{ id: "server-a", title: "Already saved" }];

    const merged = preserveOwingRows("tasks", previous, incoming);

    expect(
      merged.map((r) => r.id),
      "the parked row was dropped from the cache — the user's task disappeared",
    ).toContain("parked-1");
  });

  it("still lets a genuinely deleted row leave the cache", async () => {
    await enqueue(newTask("parked-1", "Draft the offsite agenda"));
    await drain(rejecting);
    await refreshOwing();

    // "server-b" was deleted on another device. Nothing local owes anything
    // about it, so the refetch is the truth and it must go.
    const previous = [
      { id: "server-b", title: "Deleted on the phone" },
      { id: "parked-1", title: "Draft the offsite agenda" },
    ];
    const incoming: { id: string; title: string }[] = [];

    const merged = preserveOwingRows("tasks", previous, incoming);

    expect(merged.map((r) => r.id)).toEqual(["parked-1"]);
  });

  it("leaves an unrelated table alone", async () => {
    await enqueue(newTask("parked-1", "Draft the offsite agenda"));
    await drain(rejecting);
    await refreshOwing();

    const previous = [{ id: "slot-1", title: "Deep work" }];
    const merged = preserveOwingRows("slots", previous, []);
    expect(merged).toEqual([]);
  });
});
