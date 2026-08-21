// @vitest-environment jsdom
/**
 * The integration test that matters most: a capture typed with no network.
 *
 * Before the outbox this scenario lost data. `useTaskMutations` wrote straight
 * to Supabase with an optimistic cache patch, retried a few times, and then
 * `onError` rolled the patch back — the task appeared, sat there for about ten
 * seconds, and vanished. These tests drive the *real* hook and assert the whole
 * path: instant local write, durability across a restart, and delivery on
 * reconnect with the id the client minted.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// A Supabase stand-in that records writes and can be taken offline.
// ---------------------------------------------------------------------------

interface Recorded {
  table: string;
  kind: "upsert" | "update" | "delete" | "insert";
  payload: unknown;
  match?: unknown;
}

const net = {
  online: true,
  recorded: [] as Recorded[],
  rpcCalls: [] as { fn: string; args: unknown }[],
  /** When set, the RPC reports itself undeployed so the fallback path runs. */
  rpcMissing: false,
};

function fail() {
  return { data: null, error: new TypeError("Failed to fetch") };
}

function builder(table: string) {
  const api = {
    upsert(payload: unknown) {
      if (!net.online) return Promise.resolve(fail());
      net.recorded.push({ table, kind: "upsert", payload });
      return Promise.resolve({ data: null, error: null });
    },
    insert(payload: unknown) {
      if (!net.online) return Promise.resolve(fail());
      net.recorded.push({ table, kind: "insert", payload });
      return Promise.resolve({ data: null, error: null });
    },
    update(payload: unknown) {
      return {
        match: (m: unknown) => {
          if (!net.online) return Promise.resolve(fail());
          net.recorded.push({ table, kind: "update", payload, match: m });
          return Promise.resolve({ data: null, error: null });
        },
        eq: () => Promise.resolve({ data: null, error: null }),
      };
    },
    delete() {
      return {
        match: (m: unknown) => {
          if (!net.online) return Promise.resolve(fail());
          net.recorded.push({ table, kind: "delete", payload: null, match: m });
          return Promise.resolve({ data: null, error: null });
        },
        eq: () => Promise.resolve({ data: null, error: null }),
      };
    },
    select: () => api,
  };
  return api;
}

vi.mock("../../src/lib/supabase", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => {
      if (!net.online) return Promise.resolve({ data: null, error: new TypeError("Failed to fetch") });
      if (net.rpcMissing) {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function" },
        });
      }
      net.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: "user-1" } } } }),
    },
    functions: { invoke: () => Promise.resolve({ error: null }) },
  },
  invokeQuiet: () => {},
  // The Google mirror is a server-side echo of a block, not user data — the
  // offline tests are about what the OUTBOX does, so it no-ops here.
  mirrorTask: () => {},
  supabaseConfigured: true,
  supabaseUrl: "http://localhost",
  supabaseAnonKey: "anon",
}));

const { useTaskMutations } = await import("../../src/hooks/useTasks");
const { resetIdbForTests } = await import("../../src/lib/sync/idb");
const { pendingOps, parkedOps, refreshOutboxStatus } = await import("../../src/lib/sync/outbox");
const { drain } = await import("../../src/lib/sync/engine");
const { createSupabaseTransport, resetTransportProbeForTests } = await import(
  "../../src/lib/sync/transport"
);
const { refreshOwing, syncNow, installOwingGuards } = await import("../../src/lib/sync/coordinator");

const transport = createSupabaseTransport(async () => "user-1");

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  installOwingGuards(qc);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setOnline(v: boolean) {
  net.online = v;
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetTransportProbeForTests();
  net.recorded = [];
  net.rpcCalls = [];
  net.rpcMissing = false;
  setOnline(true);
});

afterEach(() => setOnline(true));

describe("creating a task offline", () => {
  it("shows it immediately and keeps it — no rollback", async () => {
    setOnline(false);
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    let created: { id: string; title: string } | undefined;
    await act(async () => {
      created = await result.current.create({ title: "Call David" });
    });

    expect(created?.title).toBe("Call David");

    // The old behaviour: retries exhaust, then the optimistic row is removed.
    // Give it far longer than that window and assert the task is still queued.
    await new Promise((r) => setTimeout(r, 50));

    const queued = await pendingOps();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ title: "Call David" });
    expect(queued[0].rowId).toBe(created!.id);
    expect(net.recorded).toEqual([]);
  });

  it("a stale refetch cannot drop a task just created on this device", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    installOwingGuards(qc);
    const existing = [{ id: "old", title: "Already there", status: "inbox" }];
    qc.setQueryData(["tasks", "inbox"], existing);
    qc.setQueryData(["tasks", "all"], existing);

    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    setOnline(false);
    const { result } = renderHook(() => useTaskMutations(), { wrapper: localWrapper });

    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.create({ title: "Typed on the Mac" });
    });

    act(() => {
      qc.setQueryData(["tasks", "inbox"], [{ id: "old", title: "Already there", status: "inbox" }]);
      qc.setQueryData(["tasks", "all"], [{ id: "old", title: "Already there", status: "inbox" }]);
    });

    const inbox = qc.getQueryData<{ id: string }[]>(["tasks", "inbox"]);
    const all = qc.getQueryData<{ id: string }[]>(["tasks", "all"]);
    expect(inbox?.some((t) => t.id === created!.id)).toBe(true);
    expect(all?.some((t) => t.id === created!.id)).toBe(true);
  });

  it("delivers it on reconnect under the id the client minted", async () => {
    setOnline(false);
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.create({ title: "Ship the thing" });
    });

    setOnline(true);
    await drain(transport);

    const insert = net.recorded.find((r) => r.table === "tasks");
    expect(insert?.kind).toBe("upsert");
    expect(insert?.payload).toMatchObject({ id: created!.id, title: "Ship the thing" });
    expect(await pendingOps()).toEqual([]);
  });

  it("survives a force-quit before the network returns", async () => {
    setOnline(false);
    const { result, unmount } = renderHook(() => useTaskMutations(), { wrapper });

    await act(async () => {
      await result.current.create({ title: "Survive the crash" });
    });

    // Kill the app: unmount everything and drop the in-process IDB handle.
    unmount();
    resetIdbForTests();

    setOnline(true);
    await drain(transport);

    expect(net.recorded.find((r) => r.table === "tasks")?.payload).toMatchObject({
      title: "Survive the crash",
    });
  });

  it("sends one insert for a task created and edited many times offline", async () => {
    setOnline(false);
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.create({ title: "Draft" });
    });
    await act(async () => {
      result.current.patchTask(created!.id, { title: "Draft 2" });
      result.current.patchTask(created!.id, { priority: "high" });
      result.current.patchTask(created!.id, { title: "Final" });
      await Promise.resolve();
    });

    setOnline(true);
    await drain(transport);

    const taskWrites = net.recorded.filter((r) => r.table === "tasks");
    expect(taskWrites).toHaveLength(1);
    expect(taskWrites[0].kind).toBe("upsert");
    expect(taskWrites[0].payload).toMatchObject({
      id: created!.id,
      title: "Final",
      priority: "high",
    });
  });

  it("never sends a task created and trashed before reconnecting", async () => {
    setOnline(false);
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.create({ title: "Mistake" });
    });
    // `trash` is a status patch, so the row still has to reach the server —
    // but a create followed by a hard delete must not.
    await act(async () => {
      const { queueWrite, makeOp } = await import("../../src/lib/sync");
      await queueWrite(makeOp("tasks", "delete", created!.id));
    });

    setOnline(true);
    await drain(transport);

    expect(net.recorded.filter((r) => r.table === "tasks")).toEqual([]);
  });
});

describe("editing offline", () => {
  it("queues a patch and sends it through the field-LWW RPC", async () => {
    setOnline(false);
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    await act(async () => {
      result.current.patchTask("existing-id", { title: "Renamed" });
      await Promise.resolve();
    });

    expect(await pendingOps()).toHaveLength(1);

    setOnline(true);
    await drain(transport);

    expect(net.rpcCalls).toHaveLength(1);
    expect(net.rpcCalls[0].fn).toBe("apply_patch");
    expect(net.rpcCalls[0].args).toMatchObject({
      p_table: "tasks",
      p_match: { id: "existing-id" },
      p_patch: { title: "Renamed" },
    });
    // Every field carries a stamp — that is what makes the merge resolvable.
    const args = net.rpcCalls[0].args as { p_field_ts: Record<string, string> };
    expect(args.p_field_ts.title).toBeTruthy();
  });

  it("falls back to a plain update when apply_patch is not deployed", async () => {
    net.rpcMissing = true;
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    await act(async () => {
      result.current.patchTask("existing-id", { title: "Renamed" });
      await Promise.resolve();
    });

    await drain(transport);

    const update = net.recorded.find((r) => r.kind === "update");
    expect(update).toMatchObject({
      table: "tasks",
      payload: { title: "Renamed" },
      match: { id: "existing-id" },
    });
    expect(await pendingOps()).toEqual([]);
  });

  it("a patch fired immediately after a create targets the same row", async () => {
    setOnline(false);
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    // No await between them — this is the race the old temp-id machinery existed
    // to paper over.
    let id = "";
    await act(async () => {
      const p = result.current.create({ title: "Fast" });
      const t = await p;
      id = t.id;
      result.current.patchTask(id, { status: "done" });
      await Promise.resolve();
    });

    setOnline(true);
    await drain(transport);

    const writes = net.recorded.filter((r) => r.table === "tasks");
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ id, title: "Fast", status: "done" });
  });

  /**
   * The drag-jank regression: dragging a task (block / assignToSlot / resize —
   * all `patchTask` underneath) used to fire `invalidateWhenSafe` synchronously,
   * one tick before `queueWrite`'s own awaits had a chance to mark the table as
   * owing. That refetch landed the server's pre-drag row on top of the
   * optimistic one — a task that just picked up a `start_time` briefly failed
   * the scheduled-tasks membership filter and blinked off the calendar, and the
   * grid reflowed around it. `patchTask` must not let `invalidateQueries` run
   * ahead of the write that's supposed to make it safe.
   */
  it("does not invalidate the tasks query before its own write is durably queued", async () => {
    await refreshOwing(); // a clean starting mirror — IDB was reset, this test's isn't queued yet
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useTaskMutations(), { wrapper: localWrapper });

    act(() => {
      result.current.patchTask("existing-id", { start_time: "2026-08-10T15:00:00.000Z" });
    });

    // Still mid-flight: `queueWrite`'s IndexedDB write hasn't resolved, so the
    // table doesn't yet owe anything as far as a synchronous check can tell.
    // An invalidate fired here is the bug — it can only see the stale row.
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Once the write is actually queued, syncNow's drain settles it and the
    // deferred invalidate is released — the refetch happens, just no longer
    // ahead of the change it's supposed to reflect.
    await act(async () => {
      await syncNow({ qc, transport });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] });
  });

  /**
   * The fast-toggle-reverts regression: checking a task done and then, before
   * that write has landed, unchecking it again. A drain snapshots its ops
   * *before* it starts sending, so the second toggle — queued while the first
   * is still in flight — can't be part of that pass and is still owed once it
   * finishes. `syncNow` used to invalidate `["tasks"]` unconditionally whenever
   * it had sent *anything*, so that refetch pulled the server's "done" row
   * over the optimistic "not done" patch and the checkbox visibly flipped back.
   */
  it("does not let a completed drain refetch tasks while a fast second toggle is still queued", async () => {
    await refreshOwing();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { queueWrite, makeOp } = await import("../../src/lib/sync");

    let resolveSend: ((r: { ok: true }) => void) | null = null;
    const stallingTransport = {
      send: () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveSend = resolve;
        }),
    };

    // First toggle: mark the task done.
    await queueWrite(
      makeOp("tasks", "update", "task-1", { status: "done", completed_at: "2026-08-11T00:00:00.000Z" }),
    );

    const firstDrain = syncNow({ qc, transport: stallingTransport });
    // Let the drain reach `transport.send` and start waiting on it.
    await new Promise((r) => setTimeout(r, 0));

    // The user unchecks it again while the first write is still in flight —
    // this can't be in the snapshot the in-progress drain already took.
    await queueWrite(makeOp("tasks", "update", "task-1", { status: "planned", completed_at: null }));

    resolveSend!({ ok: true });
    await firstDrain;

    // "tasks" still owes the second write. Refetching now would show the
    // server's stale "done" row and clobber the still-queued "planned" patch.
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["tasks"] });

    // Once the second write actually drains, the table is genuinely settled
    // and the refetch is safe again.
    const secondDrain = syncNow({ qc, transport: stallingTransport });
    await new Promise((r) => setTimeout(r, 0));
    resolveSend!({ ok: true });
    await secondDrain;

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] });
  });
});

describe("recurring series domain cascade", () => {
  /**
   * Domain is a series-level attribute (see cascadeDomainToSeries in
   * useTasks.ts): re-homing one occurrence must re-home every sibling row and
   * the recurrences template, not just the row that was edited.
   */
  function seedSeries(qc: QueryClient) {
    qc.setQueryData(["tasks", "all"], [
      { id: "a", recurrence_id: "rec-1", domain_id: "domain-old" },
      { id: "b", recurrence_id: "rec-1", domain_id: "domain-old", status: "done" },
      { id: "c", recurrence_id: "rec-2", domain_id: "domain-old" },
      { id: "d", recurrence_id: null, domain_id: "domain-old" },
    ]);
    qc.setQueryData(["recurrences"], [
      { id: "rec-1", domain_id: "domain-old" },
      { id: "rec-2", domain_id: "domain-old" },
    ]);
  }

  it("re-homes every sibling occurrence and the series template, but not other series or loose tasks", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    seedSeries(qc);
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useTaskMutations(), { wrapper: localWrapper });

    act(() => {
      result.current.patchTask("a", { domain_id: "domain-new" });
    });

    // Optimistic: the sibling (even a done one — this feeds the domain time
    // ledger) picks it up immediately; a different series and a loose task do not.
    const tasks = qc.getQueryData<{ id: string; domain_id: string | null }[]>(["tasks", "all"]);
    expect(tasks?.find((t) => t.id === "b")?.domain_id).toBe("domain-new");
    expect(tasks?.find((t) => t.id === "c")?.domain_id).toBe("domain-old");
    expect(tasks?.find((t) => t.id === "d")?.domain_id).toBe("domain-old");

    const recs = qc.getQueryData<{ id: string; domain_id: string | null }[]>(["recurrences"]);
    expect(recs?.find((r) => r.id === "rec-1")?.domain_id).toBe("domain-new");
    expect(recs?.find((r) => r.id === "rec-2")?.domain_id).toBe("domain-old");

    // And it actually lands server-side, for the edited row, the cascaded
    // sibling, and the template — not for the unrelated series or loose task.
    await drain(transport);
    const patched = (table: string, id: string) =>
      net.rpcCalls.find(
        (c) =>
          c.fn === "apply_patch" &&
          (c.args as { p_table: string; p_match: { id: string } }).p_table === table &&
          (c.args as { p_match: { id: string } }).p_match.id === id,
      )?.args as { p_patch: { domain_id?: string } } | undefined;

    expect(patched("tasks", "a")?.p_patch.domain_id).toBe("domain-new");
    expect(patched("tasks", "b")?.p_patch.domain_id).toBe("domain-new");
    expect(patched("recurrences", "rec-1")?.p_patch.domain_id).toBe("domain-new");
    expect(patched("tasks", "c")).toBeUndefined();
    expect(patched("tasks", "d")).toBeUndefined();
    expect(patched("recurrences", "rec-2")).toBeUndefined();
  });

  it("does nothing when the task has no recurrence_id", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    seedSeries(qc);
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useTaskMutations(), { wrapper: localWrapper });

    act(() => {
      result.current.patchTask("d", { domain_id: "domain-new" });
    });

    const tasks = qc.getQueryData<{ id: string; domain_id: string | null }[]>(["tasks", "all"]);
    expect(tasks?.find((t) => t.id === "a")?.domain_id).toBe("domain-old");
    const recs = qc.getQueryData<{ id: string; domain_id: string | null }[]>(["recurrences"]);
    expect(recs?.find((r) => r.id === "rec-1")?.domain_id).toBe("domain-old");
  });
});

describe("labels", () => {
  it("queues only the labels that actually changed", async () => {
    setOnline(false);
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    await act(async () => {
      await result.current.setLabels("task-1", ["label-a", "label-b"]);
    });

    const ops = await pendingOps();
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.table === "task_labels")).toBe(true);
    expect(ops.map((o) => o.rowId).sort()).toEqual(["task-1|label-a", "task-1|label-b"]);
  });

  it("writes the join row's composite key on delivery", async () => {
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    await act(async () => {
      await result.current.setLabels("task-1", ["label-a"]);
    });
    await drain(transport);

    const write = net.recorded.find((r) => r.table === "task_labels");
    expect(write?.payload).toMatchObject({ task_id: "task-1", label_id: "label-a" });
  });
});

describe("rejected writes", () => {
  it("parks an RLS refusal instead of dropping it", async () => {
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    await act(async () => {
      await result.current.create({ title: "Not allowed" });
    });

    await drain({
      async send() {
        return { ok: false, retriable: false, error: "row-level security policy" };
      },
    });

    const parked = await parkedOps();
    expect(parked).toHaveLength(1);
    expect(parked[0].payload).toMatchObject({ title: "Not allowed" });

    const status = await refreshOutboxStatus();
    expect(status.parked).toBe(1);
    expect(status.pending).toBe(0);
  });
});

describe("the queue is visible to the shell", () => {
  it("reports what is owed while offline", async () => {
    setOnline(false);
    const { result } = renderHook(() => useTaskMutations(), { wrapper });

    await act(async () => {
      await result.current.create({ title: "One" });
      await result.current.create({ title: "Two" });
    });

    await refreshOwing();
    const status = await refreshOutboxStatus();

    await waitFor(() => expect(status.pending).toBe(2));
  });
});
