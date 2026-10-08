// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetIdbForTests } from "../../src/lib/sync/idb";
import { enqueue, pendingOps } from "../../src/lib/sync/outbox";
import { resetOwingForTests } from "../../src/lib/sync/coordinator";
import { adoptForeignWrites, configureSync, teardownSync } from "../../src/lib/sync/index";
import type { SendResult, Transport } from "../../src/lib/sync/engine";
import type { Op } from "../../src/lib/sync/ops";

/**
 * A capture from the ⌥Space panel lands in the outbox both windows share, and
 * the panel is hidden 900ms later. The main window used to learn nothing until
 * Realtime echoed the row — so when the panel's one send attempt hitched, the
 * task took seconds to reach an inbox the user was looking at. Main now
 * delivers what the panel queued and refreshes the lists it lands in.
 */

function newTask(id: string) {
  return {
    table: "tasks" as const,
    kind: "insert" as const,
    rowId: id,
    payload: { title: id, status: "inbox" },
    ts: new Date(1_700_000_000_000).toISOString(),
  };
}

function setup(reply: () => SendResult) {
  const sent: Op[] = [];
  const transport: Transport = {
    async send(op) {
      sent.push(op);
      return reply();
    },
  };
  const qc = new QueryClient();
  const invalidated: unknown[] = [];
  qc.invalidateQueries = ((args: { queryKey?: unknown }) => {
    if (args.queryKey) invalidated.push(args.queryKey);
    return Promise.resolve();
  }) as typeof qc.invalidateQueries;
  configureSync(qc, transport);
  return { sent, invalidated };
}

describe("the main window adopts what the panel queued", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    resetIdbForTests();
    resetOwingForTests();
  });
  afterEach(() => teardownSync());

  it("delivers an op it never queued itself, then refreshes its lists", async () => {
    const { sent, invalidated } = setup(() => ({ ok: true }));
    // The panel's write: straight into the shared store, behind main's back.
    await enqueue(newTask("from-panel"));

    await adoptForeignWrites([{ table: "tasks", keys: [["tasks"]] }]);

    expect(sent.map((o) => o.rowId)).toContain("from-panel");
    expect(await pendingOps()).toEqual([]);
    expect(invalidated).toContainEqual(["tasks"]);
  });

  it("still refreshes when the panel already delivered it", async () => {
    const { sent, invalidated } = setup(() => ({ ok: true }));

    await adoptForeignWrites([{ table: "tasks", keys: [["tasks"]] }]);

    expect(sent).toEqual([]);
    expect(invalidated).toContainEqual(["tasks"]);
  });

  it("holds the refresh while the write is still undelivered", async () => {
    const { invalidated } = setup(() => ({ ok: false, retriable: true, error: "Failed to fetch" }));
    await enqueue(newTask("from-panel"));

    await adoptForeignWrites([{ table: "tasks", keys: [["tasks"]] }]);

    expect(await pendingOps()).toHaveLength(1);
    expect(invalidated, "a refetch here would paint a list without the capture").not.toContainEqual(["tasks"]);
  });
});
