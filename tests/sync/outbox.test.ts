import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetIdbForTests } from "../../src/lib/sync/idb";
import {
  ack,
  discard,
  enqueue,
  isParked,
  MAX_ATTEMPTS,
  outboxStatus,
  parkedOps,
  pendingOps,
  recordFailure,
  refreshOutboxStatus,
  unpark,
} from "../../src/lib/sync/outbox";
import { classifyError, drain, type SendResult, type Transport } from "../../src/lib/sync/engine";
import type { Op } from "../../src/lib/sync/ops";

/** A fresh origin — the equivalent of a brand-new device. */
function wipeStorage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
}

/** Keep the module-level IndexedDB handle but drop the in-process caches, the
 *  way a force-quit and relaunch would. */
function simulateRestart() {
  resetIdbForTests();
}

const ts = (n: number) => new Date(1_700_000_000_000 + n * 1000).toISOString();

function newTask(id: string, title: string, at = 1) {
  return {
    table: "tasks" as const,
    kind: "insert" as const,
    rowId: id,
    payload: { title, status: "inbox" },
    ts: ts(at),
  };
}

/** Records what it was asked to send; answers however the test dictates. */
function transportOf(reply: (op: Op) => SendResult | Promise<SendResult>): Transport & { sent: Op[] } {
  const sent: Op[] = [];
  return {
    sent,
    async send(op) {
      sent.push(op);
      return reply(op);
    },
  };
}

const ok: Transport & { sent: Op[] } = transportOf(() => ({ ok: true }));

beforeEach(() => {
  wipeStorage();
  ok.sent.length = 0;
});

describe("enqueue", () => {
  it("assigns a monotonic sequence", async () => {
    const a = await enqueue(newTask("a", "A"));
    const b = await enqueue(newTask("b", "B"));
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it("stamps every payload field with the op's timestamp", async () => {
    const op = await enqueue(newTask("a", "A", 7));
    expect(op.fieldTs).toEqual({ title: ts(7), status: ts(7) });
  });

  it("gives each op a distinct idempotency key", async () => {
    const a = await enqueue(newTask("a", "A"));
    const b = await enqueue(newTask("b", "B"));
    expect(a.opId).not.toBe(b.opId);
  });
});

describe("durability", () => {
  it("a queued write survives a force-quit and relaunch", async () => {
    await enqueue(newTask("a", "Survive me"));
    await enqueue({
      table: "tasks",
      kind: "update",
      rowId: "a",
      payload: { status: "planned" },
      ts: ts(2),
    });

    simulateRestart();

    const pending = await pendingOps();
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe("insert");
    expect(pending[0].payload).toMatchObject({ title: "Survive me", status: "planned" });
  });

  it("replays a restart-recovered queue to the server in order", async () => {
    await enqueue({ table: "projects", kind: "insert", rowId: "p", payload: { title: "P" }, ts: ts(1) });
    await enqueue({ table: "tasks", kind: "insert", rowId: "t", payload: { project_id: "p" }, ts: ts(2) });

    simulateRestart();
    await drain(ok);

    expect(ok.sent.map((o) => o.table)).toEqual(["projects", "tasks"]);
  });

  it("reports the queue empty once delivered — and stays empty across a restart", async () => {
    await enqueue(newTask("a", "A"));
    await drain(ok);

    simulateRestart();
    expect(await pendingOps()).toEqual([]);
  });
});

describe("drain ordering", () => {
  it("stops at a network failure and keeps the tail for later", async () => {
    await enqueue(newTask("a", "A", 1));
    await enqueue(newTask("b", "B", 2));
    await enqueue(newTask("c", "C", 3));

    let calls = 0;
    const flaky = transportOf(() => {
      calls++;
      return calls === 2
        ? { ok: false, retriable: true, error: "Failed to fetch" }
        : { ok: true };
    });

    const report = await drain(flaky);

    expect(report.sent).toBe(1);
    expect(report.interrupted).toBe(true);
    // "c" was never attempted — order is preserved across a retriable failure.
    expect(flaky.sent.map((o) => o.rowId)).toEqual(["a", "b"]);

    // The delivered head is retired; b and c remain owed.
    const left = await pendingOps();
    expect(left.map((o) => o.rowId)).toEqual(["b", "c"]);
  });

  it("resumes from where it stopped on the next drain", async () => {
    await enqueue(newTask("a", "A", 1));
    await enqueue(newTask("b", "B", 2));

    let offline = true;
    const t = transportOf(() =>
      offline ? { ok: false, retriable: true, error: "offline" } : { ok: true },
    );

    await drain(t);
    expect(await pendingOps()).toHaveLength(2);

    offline = false;
    await drain(t);

    expect(await pendingOps()).toEqual([]);
  });

  it("parks a fatally rejected op and keeps draining past it", async () => {
    await enqueue(newTask("bad", "Rejected", 1));
    await enqueue(newTask("good", "Fine", 2));

    const t = transportOf((op) =>
      op.rowId === "bad"
        ? { ok: false, retriable: false, error: "new row violates row-level security policy" }
        : { ok: true },
    );

    const report = await drain(t);

    expect(report.parked).toBe(1);
    expect(report.sent).toBe(1);
    // The healthy write is NOT stuck behind the poisoned one.
    expect(t.sent.map((o) => o.rowId)).toEqual(["bad", "good"]);
    expect(await pendingOps()).toEqual([]);
  });

  it("keeps a parked op — a rejected write is never silently discarded", async () => {
    await enqueue(newTask("bad", "Rejected"));
    await drain(transportOf(() => ({ ok: false, retriable: false, error: "denied" })));

    const parked = await parkedOps();
    expect(parked).toHaveLength(1);
    expect(parked[0].payload).toMatchObject({ title: "Rejected" });
    expect(parked[0].lastError).toBe("denied");
  });

  it("treats a throwing transport as retriable rather than losing the write", async () => {
    await enqueue(newTask("a", "A"));
    await drain({
      async send() {
        throw new Error("boom");
      },
    });

    expect(await pendingOps()).toHaveLength(1);
    expect(await parkedOps()).toEqual([]);
  });

  it("runs one pass even when two drains are kicked off at once", async () => {
    await enqueue(newTask("a", "A"));

    let inFlight = 0;
    let overlap = false;
    const t = transportOf(async () => {
      inFlight++;
      if (inFlight > 1) overlap = true;
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true };
    });

    await Promise.all([drain(t), drain(t)]);

    expect(overlap).toBe(false);
    expect(t.sent).toHaveLength(1);
  });

  it("sends one request for a row edited many times offline", async () => {
    await enqueue(newTask("a", "Draft", 1));
    for (let i = 2; i <= 20; i++) {
      await enqueue({
        table: "tasks",
        kind: "update",
        rowId: "a",
        payload: { title: `Draft ${i}` },
        ts: ts(i),
      });
    }

    await drain(ok);

    expect(ok.sent).toHaveLength(1);
    expect(ok.sent[0].payload).toMatchObject({ title: "Draft 20" });
  });

  it("never sends a row the user created and deleted while offline", async () => {
    await enqueue(newTask("a", "Mistake", 1));
    await enqueue({ table: "tasks", kind: "delete", rowId: "a", payload: {}, ts: ts(2) });

    await drain(ok);

    expect(ok.sent).toEqual([]);
    expect(await pendingOps()).toEqual([]);
  });
});

describe("attempt budget", () => {
  it("parks an op after MAX_ATTEMPTS retriable failures rather than retrying forever", async () => {
    const op = await enqueue(newTask("a", "A"));

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await recordFailure({ ...op, seq: op.seq }, "offline", false);
    }

    expect(await pendingOps()).toEqual([]);
    expect(await parkedOps()).toHaveLength(1);
  });

  it("unpark returns an op to the queue", async () => {
    await enqueue(newTask("a", "A"));
    await drain(transportOf(() => ({ ok: false, retriable: false, error: "denied" })));

    const [parked] = await parkedOps();
    await unpark([parked.seq]);

    expect(await pendingOps()).toHaveLength(1);
    expect(await parkedOps()).toEqual([]);
  });

  it("discard is the only path that drops user intent", async () => {
    await enqueue(newTask("a", "A"));
    await drain(transportOf(() => ({ ok: false, retriable: false, error: "denied" })));

    const [parked] = await parkedOps();
    await discard([parked.seq]);

    expect(await parkedOps()).toEqual([]);
    expect(await pendingOps()).toEqual([]);
  });

  it("isParked is the single definition of exhausted", () => {
    const base = { attempts: MAX_ATTEMPTS } as Op;
    expect(isParked(base)).toBe(true);
    expect(isParked({ ...base, attempts: MAX_ATTEMPTS - 1 })).toBe(false);
  });
});

describe("ack", () => {
  it("retires the stored ops a coalesced send stood for", async () => {
    await enqueue(newTask("a", "A", 1));
    await enqueue({ table: "tasks", kind: "update", rowId: "a", payload: { status: "planned" }, ts: ts(2) });

    const [folded] = await pendingOps();
    await ack([folded]);

    expect(await pendingOps()).toEqual([]);
  });

  // Regression: coalesce parks a merged op at its *earliest* seq, so acking by
  // `seq` left every later edit that folded into it in the store. The queue
  // never emptied and re-sent the same patch on every drain, forever.
  it("empties the queue after a coalesced send instead of re-sending forever", async () => {
    await enqueue(newTask("a", "A", 1));
    await enqueue({ table: "tasks", kind: "update", rowId: "a", payload: { status: "planned" }, ts: ts(2) });
    await enqueue({ table: "tasks", kind: "update", rowId: "a", payload: { title: "A2" }, ts: ts(3) });

    await drain(ok);
    expect(ok.sent).toHaveLength(1);
    expect(await pendingOps()).toEqual([]);

    // A second drain must find nothing left to do.
    ok.sent.length = 0;
    await drain(ok);
    expect(ok.sent).toEqual([]);
  });

  // Regression: an annihilated create/delete pair emits no op, so nothing ever
  // acked the two stored rows — they accumulated in IndexedDB for the life of
  // the install and were re-folded on every drain.
  it("sweeps the stored ops of an annihilated create/delete pair", async () => {
    await enqueue(newTask("a", "Mistake", 1));
    await enqueue({ table: "tasks", kind: "delete", rowId: "a", payload: {}, ts: ts(2) });

    await pendingOps(); // the fold reports the dead span
    await new Promise((r) => setTimeout(r, 0)); // sweep is fire-and-forget

    const { idbAllOps } = await import("../../src/lib/sync/idb");
    expect(await idbAllOps()).toEqual([]);
  });

  it("does not bloat storage across repeated create/delete sync cycles", async () => {
    const { idbAllOps } = await import("../../src/lib/sync/idb");

    for (let i = 0; i < 25; i++) {
      await enqueue(newTask(`row-${i}`, `T${i}`, i * 2));
      await enqueue({
        table: "tasks",
        kind: "update",
        rowId: `row-${i}`,
        payload: { status: "planned" },
        ts: ts(i * 2 + 1),
      });
      await drain(ok);
    }

    expect(await idbAllOps()).toEqual([]);
    expect(outboxStatus().pending).toBe(0);
  });

  it("keeps an edit the user made *during* the drain", async () => {
    await enqueue(newTask("a", "A", 1));
    const [snapshot] = await pendingOps();

    // The user types while the request is in flight.
    await enqueue({ table: "tasks", kind: "update", rowId: "a", payload: { title: "typed later" }, ts: ts(9) });

    await ack([snapshot]);

    const left = await pendingOps();
    expect(left).toHaveLength(1);
    expect(left[0].payload).toMatchObject({ title: "typed later" });
  });
});

describe("invalidateWhenSafe", () => {
  // Regression: `useRealtime` invalidated unconditionally, so a Realtime echo
  // arriving while writes were queued refetched server state over the top of
  // them. Nuvo has server-side writers (calendar sync, the rollover cron), so
  // this wiped pending local edits off the screen in normal use.
  it("defers a refetch for a table that still owes the server", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { invalidateWhenSafe, refreshOwing } = await import("../../src/lib/sync/coordinator");

    const qc = new QueryClient();
    const invalidated: unknown[] = [];
    qc.invalidateQueries = ((args: { queryKey: unknown }) => {
      invalidated.push(args.queryKey);
      return Promise.resolve();
    }) as typeof qc.invalidateQueries;

    // Nothing owed → refetch immediately, exactly as before.
    await refreshOwing();
    invalidateWhenSafe(qc, "tasks", ["tasks"]);
    expect(invalidated).toHaveLength(1);

    // Now the device owes a write.
    await enqueue(newTask("a", "queued"));
    await refreshOwing();
    invalidateWhenSafe(qc, "tasks", ["tasks"]);
    expect(invalidated).toHaveLength(1); // held back, not fired

    // Delivering it releases the held invalidation. `syncNow` owns the whole
    // cycle — draining first by hand would leave it with nothing owed at entry
    // and therefore nothing to release.
    const { syncNow } = await import("../../src/lib/sync/coordinator");
    await syncNow({ qc, transport: ok });
    expect(invalidated.length).toBeGreaterThan(1);
    expect(invalidated).toContainEqual(["tasks"]);
  });

  it("never defers a table with no local queue", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { invalidateWhenSafe, refreshOwing } = await import("../../src/lib/sync/coordinator");

    const qc = new QueryClient();
    const invalidated: unknown[] = [];
    qc.invalidateQueries = ((args: { queryKey: unknown }) => {
      invalidated.push(args.queryKey);
      return Promise.resolve();
    }) as typeof qc.invalidateQueries;

    await enqueue(newTask("a", "queued"));
    await refreshOwing();
    // `slots` owes nothing even though `tasks` does — it must not be held.
    invalidateWhenSafe(qc, "slots", ["slots"]);
    expect(invalidated).toEqual([["slots"]]);
  });

  /**
   * The settings-revert regression: a mutation hook fires `void queueWrite(...)`
   * (deliberately not awaited — see index.ts's own doc comment) and calls
   * `invalidateWhenSafe` on the very next line. `refreshOwing` used to be the
   * only thing that marked a table as owing, and it only runs after
   * `queueWrite`'s IndexedDB write resolves — a tick that hasn't happened yet
   * when the very next synchronous line runs. So the immediate-refetch branch
   * fired against a table that (as far as the synchronous check could tell)
   * owed nothing, fetched the pre-write row, and stomped the just-applied
   * optimistic value with it — a Settings toggle visibly snapping back to its
   * old value the instant you changed it. `queueWrite` must mark its table as
   * owing before it does anything async, not after.
   */
  it("marks a table as owing before queueWrite's first await, not after", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { invalidateWhenSafe } = await import("../../src/lib/sync/coordinator");
    const { queueWrite } = await import("../../src/lib/sync/index");

    const qc = new QueryClient();
    const invalidated: unknown[] = [];
    qc.invalidateQueries = ((args: { queryKey: unknown }) => {
      invalidated.push(args.queryKey);
      return Promise.resolve();
    }) as typeof qc.invalidateQueries;

    // The exact shape of the vulnerable call sites: fire-and-forget, then
    // invalidate on the next synchronous line — no `await` in between.
    void queueWrite(newTask("a", "queued"));
    invalidateWhenSafe(qc, "tasks", ["tasks"]);
    expect(invalidated).toHaveLength(0);
  });
});

describe("status", () => {
  it("counts pending work and clears once delivered", async () => {
    await enqueue(newTask("a", "A"));
    await enqueue(newTask("b", "B"));
    await refreshOutboxStatus();
    expect(outboxStatus().pending).toBe(2);

    await drain(ok);
    expect(outboxStatus().pending).toBe(0);
    expect(outboxStatus().syncing).toBe(false);
  });

  it("surfaces the failure that stopped a drain", async () => {
    await enqueue(newTask("a", "A"));
    await drain(transportOf(() => ({ ok: false, retriable: true, error: "Failed to fetch" })));

    expect(outboxStatus().lastError).toBe("Failed to fetch");
    expect(outboxStatus().syncing).toBe(false);
  });
});

describe("classifyError", () => {
  const retriable = [
    ["a fetch that never left", new TypeError("Failed to fetch")],
    ["a dropped connection", { message: "network request failed" }],
    ["an expired token", { status: 401, message: "JWT expired" }],
    ["PostgREST auth expiry", { code: "PGRST301", message: "jwt expired" }],
    ["a 500", { status: 500, message: "internal" }],
    ["a rate limit", { status: 429, message: "too many requests" }],
    ["a serialization failure", { code: "40001", message: "could not serialize" }],
    ["something unrecognised", { message: "who knows" }],
  ] as const;

  it.each(retriable)("treats %s as retriable", (_label, err) => {
    expect(classifyError(err).retriable).toBe(true);
  });

  const fatal = [
    ["an RLS denial", { status: 403, message: "row-level security" }],
    ["a bad payload", { status: 400, message: "invalid input syntax" }],
    ["a unique violation", { code: "23505", message: "duplicate key" }],
    ["a check violation", { code: "23514", message: "violates check constraint" }],
    ["a bad column", { code: "42703", message: "column does not exist" }],
  ] as const;

  it.each(fatal)("treats %s as fatal", (_label, err) => {
    expect(classifyError(err).retriable).toBe(false);
  });

  it("keeps the message for the recovery UI", () => {
    expect(classifyError({ status: 403, message: "denied" }).message).toContain("denied");
  });
});

describe("durability reporting", () => {
  // Regression: the open-timeout guarded on `durable` rather than on whether
  // the open had settled, so it fired 3s after every successful open and
  // reported a working IndexedDB as blocked. The app then told the user their
  // unsent work wouldn't survive a restart while it was persisting it fine.
  it("stays durable after a successful open, even past the open timeout", async () => {
    const { isDurable } = await import("../../src/lib/sync/idb");

    await enqueue(newTask("a", "A"));
    expect(isDurable()).toBe(true);

    await vi.waitFor(async () => {
      expect(await pendingOps()).toHaveLength(1);
    });

    // Past the 3s safety timeout.
    await new Promise((r) => setTimeout(r, 3_200));

    expect(isDurable()).toBe(true);
    await refreshOutboxStatus();
    expect(outboxStatus().durable).toBe(true);
  }, 15_000);
});

describe("no-storage fallback", () => {
  it("still queues and drains when IndexedDB is unavailable", async () => {
    const real = globalThis.indexedDB;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = undefined;
    resetIdbForTests();
    vi.useRealTimers();

    try {
      await enqueue(newTask("a", "A"));
      const pending = await pendingOps();
      expect(pending).toHaveLength(1);

      const t = transportOf(() => ({ ok: true }));
      await drain(t);
      expect(t.sent).toHaveLength(1);
      expect(outboxStatus().durable).toBe(false);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).indexedDB = real;
      resetIdbForTests();
    }
  }, 15_000);

  // Regression: a Safari transaction that never fires onsuccess used to leave
  // `queueWrite` pending forever, which froze CreateRecord on "Creating…".
  it("enqueue still resolves when a transaction never settles", async () => {
    const hangingDb = {
      objectStoreNames: { contains: () => true },
      close() {},
      transaction() {
        return {
          objectStore() {
            return {
              add() {
                return {};
              },
              put() {
                return {};
              },
              get() {
                return {};
              },
              getAll() {
                return {};
              },
              delete() {
                return {};
              },
            };
          },
        };
      },
    };
    const origOpen = indexedDB.open.bind(indexedDB);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (indexedDB as any).open = () => {
      const req: { result?: typeof hangingDb; onsuccess?: () => void } = {};
      queueMicrotask(() => {
        req.result = hangingDb;
        req.onsuccess?.();
      });
      return req;
    };
    resetIdbForTests();

    try {
      const stored = await enqueue(newTask("hang", "Hung write"));
      expect(stored.rowId).toBe("hang");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (indexedDB as any).open = origOpen;
      resetIdbForTests();
    }
  }, 15_000);
});
