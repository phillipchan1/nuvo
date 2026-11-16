/**
 * The Supabase/Worker transport under the audit's failure modes: a hung fetch,
 * a schema refusal, and a device that changed hands.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: { table: string; row?: Record<string, unknown>; rpc?: Record<string, unknown> }[] = [];
let upsertReply: () => Promise<{ error: unknown }> = () => Promise.resolve({ error: null });

vi.mock("../../src/lib/maintenance", () => ({
  writeFrozen: async () => false,
  WRITE_FROZEN_MESSAGE: "frozen",
}));
vi.mock("../../src/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        calls.push({ table, row });
        return upsertReply();
      },
    }),
    rpc: (_fn: string, args: Record<string, unknown>) => {
      calls.push({ table: String(args.p_table), rpc: args });
      return Promise.resolve({ error: null });
    },
  },
}));

const { createSupabaseTransport, SEND_TIMEOUT_MS } = await import("../../src/lib/sync/transport");
const { resetIdbForTests } = await import("../../src/lib/sync/idb");
const { enqueue, parkedOps, pendingOps, resetDeliveryForTests, setOutboxOwner } = await import(
  "../../src/lib/sync/outbox"
);
const { drain } = await import("../../src/lib/sync/engine");
const { makeOp, OWNER_ROW } = await import("../../src/lib/sync/index");

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetDeliveryForTests();
  calls.length = 0;
  upsertReply = () => Promise.resolve({ error: null });
});
afterEach(() => vi.useRealTimers());

describe("5 · a hung request cannot hold the drain", () => {
  it("gives up after SEND_TIMEOUT_MS, retriably", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    upsertReply = () => new Promise(() => {}); // a fetch that never settles
    const transport = createSupabaseTransport(async () => "user-1");
    const result = transport.send({
      ...makeOp("tasks", "insert", "t1", { title: "x" }),
      seq: 1,
      opId: "o1",
      attempts: 0,
      fieldTs: {},
    });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1);
    await expect(result).resolves.toMatchObject({ ok: false, retriable: true });
  });
});

describe("1 · the live PGRST204 case", () => {
  it("parks at once instead of holding the queue for eight attempts, and other writes still land", async () => {
    upsertReply = () =>
      Promise.resolve({
        error: { code: "PGRST204", message: "Could not find the 'flag' column of 'tasks' in the schema cache" },
      });
    const transport = createSupabaseTransport(async () => "user-1");
    await enqueue(makeOp("tasks", "insert", "t1", { title: "x", flag: true }));
    await enqueue(makeOp("user_settings", "update", OWNER_ROW, { theme: "dark" }));

    await drain(transport);

    expect(await parkedOps()).toHaveLength(1);
    expect(calls.some((c) => c.rpc)).toBe(true); // the settings write was not stuck behind it
    expect(await pendingOps()).toEqual([]);
  });
});

describe("8 · cross-account delivery through the real transport", () => {
  it("A's queued task and settings patch never reach B's account", async () => {
    setOutboxOwner("user-A");
    await enqueue(makeOp("tasks", "insert", "task-of-A", { title: "A's private note", status: "inbox" }));
    await enqueue(makeOp("user_settings", "update", OWNER_ROW, { theme: "dark" }));
    setOutboxOwner(null); // A signs out, outbox kept

    await drain(createSupabaseTransport(async () => "user-B"));
    expect(calls).toEqual([]);

    await drain(createSupabaseTransport(async () => "user-A"));
    expect(calls[0].row?.user_id).toBe("user-A");
    expect(calls[1].rpc?.p_match).toEqual({ user_id: "user-A" });
    expect(await pendingOps()).toEqual([]);
  });

  it("does not drain at all without a session", async () => {
    await enqueue(makeOp("tasks", "insert", "t1", { title: "x" }));
    await drain(createSupabaseTransport(async () => null));
    expect(calls).toEqual([]);
    expect(await pendingOps()).toHaveLength(1);
  });
});
