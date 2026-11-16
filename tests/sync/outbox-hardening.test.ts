/**
 * Regressions from the offline write-path audit. Each `describe` is one way a
 * queued write used to be lost, resurrected, stranded or delivered to the wrong
 * place — driven through the real outbox, fold and drain against a fake server.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { idbAllOps, idbAppendOp, isDurable, resetIdbForTests } from "../../src/lib/sync/idb";
import {
  enqueue,
  MAX_ATTEMPTS,
  parkedOps,
  pendingOps,
  resetDeliveryForTests,
  retryParked,
  setOutboxOwner,
  unpark,
} from "../../src/lib/sync/outbox";
import { classifyError, drain, type SendResult, type Transport } from "../../src/lib/sync/engine";
import type { NewOp, Op } from "../../src/lib/sync/ops";

const ts = (n: number) => new Date(1_700_000_000_000 + n * 1000).toISOString();
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetDeliveryForTests();
});

function write(kind: Op["kind"], rowId: string, payload: Record<string, unknown> = {}, at = 1): NewOp {
  return { table: "tasks", kind, rowId, payload, ts: ts(at) };
}

/** A row store that behaves like the transport's server: idempotent insert,
 *  an update or delete matching nothing is still a success. */
function fakeServer(refuse: (op: Op) => SendResult | null = () => null) {
  const rows = new Map<string, Record<string, unknown>>();
  const sent: Op[] = [];
  const transport: Transport = {
    async send(op) {
      sent.push(op);
      const r = refuse(op);
      if (r) return r;
      if (op.kind === "insert") {
        if (!rows.has(op.rowId)) rows.set(op.rowId, { ...op.payload });
      } else if (op.kind === "update") {
        const row = rows.get(op.rowId);
        if (row) Object.assign(row, op.payload);
      } else rows.delete(op.rowId);
      return { ok: true };
    },
  };
  return { rows, sent, transport };
}

describe("1 · a retriable failure does not park a write", () => {
  it("survives far more than MAX_ATTEMPTS failed drains and lands when the network does", async () => {
    let down = true;
    const srv = fakeServer(() => (down ? { ok: false, retriable: true, error: "Failed to fetch" } : null));
    await enqueue(write("insert", "t1", { title: "Capture" }));

    for (let i = 0; i < MAX_ATTEMPTS * 2; i++) await drain(srv.transport);
    expect(await parkedOps()).toEqual([]);

    down = false;
    await drain(srv.transport);
    expect(srv.rows.get("t1")?.title).toBe("Capture");
    expect(await idbAllOps()).toEqual([]);
  });

  it("classifies PostgREST's own codes: schema/request refusals are fatal, unreachable/auth are not", () => {
    // The live case: a client writing a column the server did not have yet.
    // No HTTP status rides on the error body, so it fell through to
    // "retriable", burned eight attempts and parked.
    const missingColumn = { code: "PGRST204", message: "Could not find the 'x' column of 'tasks' in the schema cache" };
    expect(classifyError(missingColumn).retriable).toBe(false);
    expect(classifyError({ code: "PGRST100", message: "bad filter" }).retriable).toBe(false);
    expect(classifyError({ code: "PGRST000", message: "service unavailable" }).retriable).toBe(true);
    expect(classifyError({ code: "PGRST301", message: "not signed in" }).retriable).toBe(true);
  });

  it("a parked op gets an automatic retry, and heals once the server accepts it", async () => {
    let schemaFixed = false;
    const srv = fakeServer((op) =>
      op.kind === "insert" && !schemaFixed ? { ok: false, retriable: false, error: "PGRST204 missing column" } : null,
    );
    await enqueue(write("insert", "t1", { title: "Capture" }));
    await drain(srv.transport);
    expect(await parkedOps()).toHaveLength(1);

    schemaFixed = true;
    expect(await retryParked()).toBe(1);
    await drain(srv.transport);

    expect(srv.rows.get("t1")?.title).toBe("Capture");
    expect(await idbAllOps()).toEqual([]);
  });

  it("the automatic retry is a single try: still refused, it parks again at once", async () => {
    const srv = fakeServer(() => ({ ok: false, retriable: false, error: "denied" }));
    await enqueue(write("insert", "t1", { title: "Capture" }));
    await drain(srv.transport);
    await retryParked();
    expect(await parkedOps()).toEqual([]);

    await drain(srv.transport);
    expect(await parkedOps()).toHaveLength(1);
    expect(srv.sent).toHaveLength(2);
  });
});

describe("2 · ops behind a parked insert wait with it", () => {
  // Today: the edit goes out alone, apply_patch matches 0 rows, it is acked
  // and gone — and the insert's retry lands the old title.
  it("an edit queued after a parked insert is delivered with it, not lost", async () => {
    let refuse = true;
    const srv = fakeServer((op) =>
      op.kind === "insert" && refuse ? { ok: false, retriable: false, error: "PGRST204 unknown column" } : null,
    );
    await enqueue(write("insert", "t1", { title: "draft" }, 1));
    await drain(srv.transport);
    expect(await parkedOps()).toHaveLength(1);

    await enqueue(write("update", "t1", { title: "final title" }, 2));
    await drain(srv.transport);
    expect(srv.sent.map((o) => o.kind)).toEqual(["insert"]); // held, not sent alone

    refuse = false;
    const [p] = await parkedOps();
    await unpark([p.seq]);
    await drain(srv.transport);

    expect(srv.rows.get("t1")?.title).toBe("final title");
    expect(await idbAllOps()).toEqual([]);
  });

  it("a delete queued after a parked insert does not let the retry resurrect the row", async () => {
    let refuse = true;
    const srv = fakeServer((op) =>
      op.kind === "insert" && refuse ? { ok: false, retriable: false, error: "PGRST204 unknown column" } : null,
    );
    await enqueue(write("insert", "t1", { title: "draft" }, 1));
    await drain(srv.transport);
    await enqueue(write("delete", "t1", {}, 2));
    await drain(srv.transport);

    refuse = false;
    const [p] = await parkedOps();
    await unpark([p.seq]);
    await drain(srv.transport);

    expect(srv.rows.has("t1")).toBe(false);
    expect(await idbAllOps()).toEqual([]);
  });

  it("in one pass, a row's later op is not sent past its insert being refused", async () => {
    const srv = fakeServer((op) =>
      op.kind === "insert" ? { ok: false, retriable: false, error: "denied" } : null,
    );
    // An attempted insert and its delete fold to two ops (see §3).
    await enqueue(write("insert", "t1", { title: "x" }, 1));
    await drain(fakeServer(() => ({ ok: false, retriable: true, error: "Failed to fetch" })).transport);
    await enqueue(write("delete", "t1", {}, 2));

    await drain(srv.transport);

    expect(srv.sent.map((o) => o.kind)).toEqual(["insert"]);
    expect(await idbAllOps()).toHaveLength(2);
  });
});

describe("3 · create-then-delete annihilates only an insert that never went out", () => {
  it("a delete queued while the insert is on the wire is sent after it", async () => {
    const server = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sent: Op[] = [];
    const transport: Transport = {
      async send(op) {
        sent.push(op);
        if (op.kind === "insert") {
          server.add(op.rowId);
          await gate;
        }
        if (op.kind === "delete") server.delete(op.rowId);
        return { ok: true };
      },
    };
    await enqueue({ table: "slots", kind: "insert", rowId: "s1", payload: { title: "x" }, ts: ts(1) });
    const pass = drain(transport);
    await tick(); // the insert is on the wire and the server has it
    await enqueue({ table: "slots", kind: "delete", rowId: "s1", payload: {}, ts: ts(2) });
    await pendingOps(); // what queueWrite's refreshOwing does: fold (and sweep)
    await tick();
    release();
    await pass;
    await drain(transport);

    expect(sent.map((o) => o.kind)).toEqual(["insert", "delete"]);
    expect(server.has("s1")).toBe(false);
    expect(await idbAllOps()).toEqual([]);
  });

  it("an insert whose response was lost, then deleted, is deleted on the server", async () => {
    const server = new Set<string>();
    let first = true;
    const transport: Transport = {
      async send(op) {
        if (op.kind === "insert") {
          server.add(op.rowId);
          if (first) {
            first = false;
            return { ok: false, retriable: true, error: "Request timed out" };
          }
        }
        if (op.kind === "delete") server.delete(op.rowId);
        return { ok: true };
      },
    };
    await enqueue(write("insert", "t1", { title: "x" }, 1));
    await drain(transport); // landed, but the client saw a timeout
    await enqueue(write("delete", "t1", {}, 2));
    await drain(transport);
    await tick();

    expect(server.has("t1")).toBe(false);
    expect(await idbAllOps()).toEqual([]);
  });

  it("still annihilates a pair that never left the device", async () => {
    const srv = fakeServer();
    await enqueue(write("insert", "t1", { title: "Mistake" }, 1));
    await enqueue(write("delete", "t1", {}, 2));
    await drain(srv.transport);
    await tick();
    expect(srv.sent).toEqual([]);
    expect(await idbAllOps()).toEqual([]);
  });
});

describe("6 · a slow IndexedDB open is adopted, not written off for the session", () => {
  afterEach(() => vi.useRealTimers());

  it("an open that settles after the 3s give-up becomes the store", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const real = new IDBFactory();
    let release!: () => void;
    // An `open` that hangs until released — Safari restoring a tab.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = {
      open(name: string, version: number) {
        const fake = {} as Record<string, unknown> & {
          onupgradeneeded?: (e: unknown) => void;
          onsuccess?: (e: unknown) => void;
          onerror?: (e: unknown) => void;
        };
        release = () => {
          const r = real.open(name, version);
          r.onupgradeneeded = (e) => {
            fake.result = r.result;
            fake.onupgradeneeded?.(e);
          };
          r.onsuccess = (e) => {
            fake.result = r.result;
            fake.onsuccess?.(e);
          };
          r.onerror = (e) => fake.onerror?.(e);
        };
        return fake;
      },
    };
    resetIdbForTests();

    const first = idbAppendOp({ table: "tasks", kind: "insert", rowId: "a", payload: {} });
    await vi.advanceTimersByTimeAsync(3_100);
    await first; // fell back to memory
    expect(isDurable()).toBe(false);

    release();
    vi.useRealTimers();
    await tick();
    // Late but alive: adopted, and the memory-held op moves back on the next read.
    const all = await idbAllOps<{ rowId: string }>();
    expect(all.map((o) => o.rowId)).toEqual(["a"]);
    expect(isDurable()).toBe(true);
    await idbAppendOp({ table: "tasks", kind: "insert", rowId: "b", payload: {} });
    expect(isDurable()).toBe(true);
  });
});

describe("8 · a queued op belongs to the account that queued it", () => {
  function ownedServer(uid: () => string | null) {
    const srv = fakeServer();
    const transport: Transport = { send: srv.transport.send, owner: async () => uid() };
    return { ...srv, transport };
  }

  it("user A's offline queue is not delivered into user B's account", async () => {
    setOutboxOwner("A");
    await enqueue(write("insert", "a-task", { title: "A's private note" }));
    // A signs out; the outbox is deliberately kept.
    setOutboxOwner(null);
    let who: string | null = null;
    const srv = ownedServer(() => who);

    await drain(srv.transport);
    expect(srv.sent).toEqual([]); // never without a session

    // B signs in on the same device (useAuth → noteSessionOwner) and writes.
    who = "B";
    setOutboxOwner("B");
    await enqueue(write("insert", "b-task", { title: "B's own" }, 2));
    await drain(srv.transport);
    expect(srv.sent.map((o) => o.rowId)).toEqual(["b-task"]);

    // A signs back in on this device: A's work goes out, under A.
    who = "A";
    await drain(srv.transport);
    expect(srv.sent.map((o) => o.rowId)).toContain("a-task");
    expect(await pendingOps()).toEqual([]);
  });

  it("B's parked ops view never lists A's writes", async () => {
    setOutboxOwner("A");
    await enqueue(write("insert", "a-task", { title: "A's private note" }));
    await drain(fakeServer(() => ({ ok: false, retriable: false, error: "denied" })).transport);
    expect(await parkedOps()).toHaveLength(1);
    setOutboxOwner("B");
    expect(await parkedOps()).toEqual([]);
  });

  it("an op queued before stamping existed drains under whoever signs in (nothing lost on upgrade)", async () => {
    await enqueue(write("insert", "legacy", { title: "old build" })); // no owner known → unstamped
    const srv = ownedServer(() => "B");
    await drain(srv.transport);
    expect(srv.sent.map((o) => o.rowId)).toEqual(["legacy"]);
  });
});
