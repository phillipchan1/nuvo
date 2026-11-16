// @vitest-environment jsdom
/**
 * The sync layer's lifecycle: what the scheduler does on its own (retry a
 * write that hit a blip, retry parked work on launch and reconnect) and what a
 * change of account does to the caches.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { idbAllOps, idbGet, idbSet, resetIdbForTests } from "../../src/lib/sync/idb";
import { enqueue, parkedOps, pendingOps, resetDeliveryForTests } from "../../src/lib/sync/outbox";
import { resetOwingForTests } from "../../src/lib/sync/coordinator";
import {
  configureSync,
  makeOp,
  noteSessionOwner,
  queueWrite,
  resetSessionOwnerForTests,
  teardownSync,
} from "../../src/lib/sync/index";
import { drain, type SendResult, type Transport } from "../../src/lib/sync/engine";
import type { Op } from "../../src/lib/sync/ops";

// Node's own (flag-less) localStorage global shadows jsdom's; stub it.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  get length() {
    return store.size;
  },
  clear: () => store.clear(),
  getItem: (k: string) => store.get(k) ?? null,
  key: (i: number) => [...store.keys()][i] ?? null,
  removeItem: (k: string) => void store.delete(k),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
});

function server(reply: (op: Op, n: number) => SendResult) {
  const sent: Op[] = [];
  const transport: Transport = {
    async send(op) {
      sent.push(op);
      return reply(op, sent.length);
    },
  };
  return { sent, transport };
}

const until = async (cond: () => Promise<boolean> | boolean, ms = 3_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out waiting");
};

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetOwingForTests();
  resetDeliveryForTests();
  resetSessionOwnerForTests();
  localStorage.clear();
});
afterEach(() => {
  teardownSync();
  vi.useRealTimers();
});

describe("4 · a write whose drain hits a blip is retried by the scheduler", () => {
  it("queueWrite backs off and re-drains, without waiting for focus or reconnect", async () => {
    const srv = server((_op, n) =>
      n === 1 ? { ok: false, retriable: true, error: "Failed to fetch" } : { ok: true },
    );
    configureSync(new QueryClient(), srv.transport);
    await new Promise((r) => setTimeout(r, 30)); // the launch pass, over an empty outbox

    await queueWrite(makeOp("tasks", "insert", "t1", { title: "Capture" }));
    await until(async () => srv.sent.length >= 1);
    expect(await pendingOps()).toHaveLength(1);

    // First backoff step is 2s.
    await until(async () => (await pendingOps()).length === 0, 4_000);
    expect(srv.sent.length).toBe(2);
  });
});

describe("1 · parked work is retried on launch and on reconnect", () => {
  it("a parked op from a previous life is delivered on launch once the server accepts it", async () => {
    await enqueue(makeOp("tasks", "insert", "t1", { title: "Capture" }));
    await drain(server(() => ({ ok: false, retriable: false, error: "PGRST204 missing column" })).transport);
    expect(await parkedOps()).toHaveLength(1);

    // Relaunch after the server-side fix.
    const fixed = server(() => ({ ok: true }));
    configureSync(new QueryClient(), fixed.transport);

    await until(async () => fixed.sent.length > 0 && (await idbAllOps()).length === 0);
    expect(fixed.sent.map((o) => o.rowId)).toEqual(["t1"]);
  });

  it("and again when the network comes back", async () => {
    let fixed = false;
    const srv = server(() => (fixed ? { ok: true } : { ok: false, retriable: false, error: "denied" }));
    configureSync(new QueryClient(), srv.transport);
    await new Promise((r) => setTimeout(r, 30));
    await queueWrite(makeOp("tasks", "insert", "t1", { title: "Capture" }));
    await until(async () => (await parkedOps()).length === 1);

    fixed = true;
    window.dispatchEvent(new Event("online"));
    await until(async () => (await idbAllOps()).length === 0);
    expect(srv.sent.map((o) => o.rowId)).toEqual(["t1", "t1"]);
  });
});

describe("7 · the read caches belong to one account", () => {
  function seeded() {
    const qc = new QueryClient();
    qc.setQueryData(["tasks", "inbox"], [{ id: "t1", title: "A's task" }]);
    return qc;
  }

  it("a sign-out clears the in-memory cache and the persisted one", async () => {
    const qc = seeded();
    await idbSet("query-cache", { clientState: "A's planner" });
    noteSessionOwner(qc, "user-A");
    expect(qc.getQueryData(["tasks", "inbox"])).toBeDefined();

    noteSessionOwner(qc, null);
    await new Promise((r) => setTimeout(r, 10));
    expect(qc.getQueryData(["tasks", "inbox"])).toBeUndefined();
    expect(await idbGet("query-cache")).toBeNull();
  });

  it("a different account than the one the disk cache was written for clears it, across launches", async () => {
    noteSessionOwner(new QueryClient(), "user-A");
    // Relaunch: A's session expired while the app was closed, so no sign-out
    // was ever seen. B signs in on the restored cache.
    resetSessionOwnerForTests();
    const qc = seeded();
    await idbSet("query-cache", { clientState: "A's planner" });
    noteSessionOwner(qc, "user-B");
    await new Promise((r) => setTimeout(r, 10));
    expect(qc.getQueryData(["tasks", "inbox"])).toBeUndefined();
    expect(await idbGet("query-cache")).toBeNull();
  });

  it("the same account re-reading its session keeps the cache", async () => {
    const qc = seeded();
    noteSessionOwner(qc, "user-A");
    noteSessionOwner(qc, "user-A");
    resetSessionOwnerForTests();
    noteSessionOwner(qc, "user-A"); // relaunch, same person
    expect(qc.getQueryData(["tasks", "inbox"])).toBeDefined();
  });

  it("both auth paths report the session to the sync layer", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../../src/hooks/useAuth.ts"), "utf8");
    // Worker path, both branches of applyBa; Supabase path through `apply`.
    expect(src).toContain("noteSessionOwner(qc, null)");
    expect(src).toContain("noteSessionOwner(qc, next.user.id)");
    expect(src).toContain("noteSessionOwner(qc, next?.user?.id ?? null)");
  });
});
