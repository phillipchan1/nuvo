/**
 * The write races the 2026-10-15 Schedule audit found by reading the code
 * (docs/schedule-ux-audit-2026-10-15.md, P0 #6 and the mirror half of the
 * follow-up). Each test replays the interleaving that lost the user's newest
 * edit; each failed before its fix.
 *
 *  • A late echo of op1 arriving after op2 was ACKED repainted op1 — only ops
 *    still pending were merged into an echo.
 *  • A refetch already in flight when the user dragged landed on top of the
 *    drag — `patchTask` never cancelled it, and once the write was acked
 *    nothing defended against it. The same response put a task dragged out of
 *    the inbox straight back into it.
 *  • The Google mirror was asked to read the task before the edit reached
 *    Postgres, so it mirrored the row as it was.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoked: { fn: string; body: unknown }[] = [];

// The real `src/lib/supabase.ts` runs (so the real `mirrorTask` is under test);
// only the client it builds is a stand-in.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    functions: {
      invoke: (fn: string, opts: { body: unknown }) => {
        invoked.push({ fn, body: opts.body });
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
    from: () => {
      throw new Error("no table reads in this suite");
    },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}));

const { resetIdbForTests } = await import("../../src/lib/sync/idb");
const { ack, enqueue, recordFailure, recentlyAcked, resetDeliveryForTests, whenDelivered, RECENT_ACK_MS } =
  await import("../../src/lib/sync/outbox");
const { applyLiveChange } = await import("../../src/lib/sync/liveApply");
const coordinator = await import("../../src/lib/sync/coordinator");
const { queueWrite, whenRowDelivered, makeOp } = await import("../../src/lib/sync");
const { patchCaches } = await import("../../src/hooks/useTasks");
const { mirrorTask } = await import("../../src/lib/supabase");
import type { Op } from "../../src/lib/sync/ops";
import type { Task } from "../../src/lib/types";

const RANGE_START = "2026-10-12T07:00:00.000Z";
const RANGE_END = "2026-10-19T07:00:00.000Z";
const NINE = "2026-10-15T16:00:00.000Z";
const TEN = "2026-10-15T17:00:00.000Z";

function task(over: Partial<Task> & Pick<Task, "id">): Task {
  return {
    user_id: "u",
    created_at: "2026-10-10T20:00:00.000Z",
    updated_at: "2026-10-15T15:00:00.000Z",
    title: "Write the brief",
    notes: "",
    status: "planned",
    do_date: "2026-10-15",
    start_time: NINE,
    duration_minutes: 60,
    deadline: null,
    priority: "none",
    roll_count: 0,
    completed_at: null,
    trashed_at: null,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    key_result_id: null,
    sprint_id: null,
    big_rock_id: null,
    energy: null,
    assignee: "me",
    prework: "",
    prework_at: null,
    suggestion: null,
    suggested_at: null,
    google_event_id: null,
    sort_order: 0,
    slot_id: null,
    parent_task_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    ...over,
  };
}

const scheduledKey = ["tasks", "scheduled", RANGE_START, RANGE_END];

function startedAt(qc: QueryClient, id: string): string | null | undefined {
  return qc.getQueryData<Task[]>(scheduledKey)?.find((t) => t.id === id)?.start_time;
}

beforeEach(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory();
  resetIdbForTests();
  resetDeliveryForTests();
  coordinator.resetOwingForTests();
  await coordinator.refreshOwing();
  invoked.length = 0;
});

describe("a late echo of a delivered op does not repaint it", () => {
  async function dragTwiceAndDeliver() {
    const op1 = await enqueue({
      table: "tasks",
      kind: "update",
      rowId: "brief",
      payload: { start_time: NINE },
      ts: "2026-10-15T15:30:00.000Z",
    });
    const op2 = await enqueue({
      table: "tasks",
      kind: "update",
      rowId: "brief",
      payload: { start_time: TEN },
      ts: "2026-10-15T15:30:01.000Z",
    });
    await ack([op1]);
    await ack([op2]);
    return { op1, op2 };
  }

  it("folds ops acked a moment ago into the merge, so op1's echo keeps op2 on screen", async () => {
    const qc = new QueryClient();
    qc.setQueryData(scheduledKey, [task({ id: "brief", start_time: TEN })]);
    await dragTwiceAndDeliver();

    // Both landed; the outbox owes nothing. Now the echo of the FIRST drag.
    const painted = applyLiveChange(
      qc,
      {
        table: "tasks",
        eventType: "UPDATE",
        old: { id: "brief" },
        new: {
          ...task({ id: "brief", start_time: NINE }),
          field_ts: { start_time: "2026-10-15T15:30:00.000Z" },
        },
      },
      [],
      recentlyAcked(),
    );

    expect(painted).toBe(true);
    expect(startedAt(qc, "brief")).toBe(TEN);
  });

  it("still paints a genuinely newer write from elsewhere", async () => {
    const qc = new QueryClient();
    qc.setQueryData(scheduledKey, [task({ id: "brief", start_time: TEN })]);
    await dragTwiceAndDeliver();
    const ELEVEN = "2026-10-15T18:00:00.000Z";

    applyLiveChange(
      qc,
      {
        table: "tasks",
        eventType: "UPDATE",
        old: { id: "brief" },
        new: {
          ...task({ id: "brief", start_time: ELEVEN }),
          // The phone moved it after both of ours.
          field_ts: { start_time: "2026-10-15T15:31:00.000Z" },
        },
      },
      [],
      recentlyAcked(),
    );

    expect(startedAt(qc, "brief")).toBe(ELEVEN);
  });

  it("forgets delivered ops after the window", async () => {
    await dragTwiceAndDeliver();
    expect(recentlyAcked()).toHaveLength(2);
    expect(recentlyAcked(Date.now() + RECENT_ACK_MS + 1)).toHaveLength(0);
  });

  it("a delivered op never holds back a DELETE", async () => {
    const qc = new QueryClient();
    qc.setQueryData(scheduledKey, [task({ id: "brief", start_time: TEN })]);
    await dragTwiceAndDeliver();

    const painted = applyLiveChange(
      qc,
      { table: "tasks", eventType: "DELETE", old: { id: "brief" }, new: null },
      [],
      recentlyAcked(),
    );

    expect(painted).toBe(true);
    expect(qc.getQueryData<Task[]>(scheduledKey)).toEqual([]);
  });
});

describe("a refetch in flight when the user acts does not land over the act", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it("a task dragged out of the inbox stays out when the inbox read from before the drag returns", async () => {
    const qc = new QueryClient();
    coordinator.installOwingGuards(qc);
    const inbox = task({ id: "brief", status: "inbox", do_date: null, start_time: null });
    qc.setQueryData(["tasks", "inbox"], [inbox]);
    qc.setQueryData(scheduledKey, []);

    // The focus catch-up reads the inbox…
    const server = deferred<Task[]>();
    const catchUp = qc.fetchQuery({ queryKey: ["tasks", "inbox"], queryFn: () => server.promise, staleTime: 0 });

    // …the user drags the task onto Thursday 9am before it answers.
    patchCaches(qc, "brief", { status: "planned", do_date: "2026-10-15", start_time: NINE });
    expect(qc.getQueryData<Task[]>(["tasks", "inbox"])).toEqual([]);

    // The write is delivered before the read comes back: nothing is owed.
    expect(coordinator.tablesOwing().has("tasks")).toBe(false);

    server.resolve([inbox]);
    await catchUp;

    expect(qc.getQueryData<Task[]>(["tasks", "inbox"])).toEqual([]);
    expect(startedAt(qc, "brief")).toBe(NINE);
  });

  it("the cancelled read runs again once the drain has delivered", async () => {
    const qc = new QueryClient();
    coordinator.installOwingGuards(qc);
    const inbox = task({ id: "brief", status: "inbox", do_date: null, start_time: null });
    qc.setQueryData(["tasks", "inbox"], [inbox]);

    const server = deferred<Task[]>();
    const catchUp = qc.fetchQuery({ queryKey: ["tasks", "inbox"], queryFn: () => server.promise, staleTime: 0 });
    patchCaches(qc, "brief", { status: "planned", do_date: "2026-10-15" });
    server.resolve([inbox]);
    await catchUp;
    expect(qc.getQueryState(["tasks", "inbox"])?.isInvalidated).toBe(false);

    await coordinator.syncNow({ qc, transport: { send: async () => ({ ok: true }) } });

    expect(qc.getQueryState(["tasks", "inbox"])?.isInvalidated).toBe(true);
  });

  it("a first load is never cancelled — it would sit empty with nothing to fetch it", async () => {
    const qc = new QueryClient();
    coordinator.installOwingGuards(qc);
    qc.setQueryData(scheduledKey, [task({ id: "brief" })]);
    const server = deferred<Task[]>();
    const firstLoad = qc.fetchQuery({ queryKey: ["tasks", "day", "2026-10-16"], queryFn: () => server.promise });

    patchCaches(qc, "brief", { start_time: TEN });
    server.resolve([task({ id: "other", do_date: "2026-10-16" })]);
    await firstLoad;

    expect(qc.getQueryData<Task[]>(["tasks", "day", "2026-10-16"])?.map((t) => t.id)).toEqual(["other"]);
  });

  it("a refetch that slips past the gates still cannot override a row with a write queued", () => {
    coordinator.markOwing("tasks", "brief");
    const local = task({ id: "brief", start_time: TEN, updated_at: "2026-10-15T15:00:00.000Z" });
    // Read after an earlier op landed (newer updated_at) but before this one.
    const stale = task({ id: "brief", start_time: NINE, updated_at: "2026-10-15T15:30:00.000Z" });
    const other = task({ id: "other", title: "Someone else's row" });

    const kept = coordinator.withholdOwedRows<Task>("tasks", [local], [stale, other]);
    expect(kept.map((t) => [t.id, t.start_time])).toEqual([
      ["brief", TEN],
      ["other", NINE],
    ]);

    // …and cannot put it back in a list the drag took it out of.
    const inboxCopy = task({ id: "brief", status: "inbox" });
    expect(coordinator.withholdOwedRows<Task>("tasks", [], [inboxCopy, other]).map((t) => t.id)).toEqual(["other"]);
  });

  it("a local cache write is not second-guessed", () => {
    coordinator.markOwing("tasks", "brief");
    const before = task({ id: "brief", start_time: NINE });
    const after = task({ id: "brief", start_time: TEN });
    const written = coordinator.runWithoutOwingPreserve(() =>
      coordinator.withholdOwedRows<Task>("tasks", [before], [after]),
    );
    expect(written[0].start_time).toBe(TEN);
  });
});

describe("work that reads a row back waits for the row's write to land", () => {
  const brief = (start: string) => makeOp("tasks", "update", "brief", { start_time: start });

  // Node's `navigator` has no `onLine`, which mirrorTask reads as offline.
  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
  });

  it("whenDelivered settles on ack — and false on a refusal", async () => {
    const delivered = await enqueue(brief(NINE));
    const refused = await enqueue(makeOp("tasks", "update", "other", { title: "x" }));
    const outcomes: boolean[] = [];
    void whenDelivered(delivered).then((v) => outcomes.push(v));
    void whenDelivered(refused).then((v) => outcomes.push(v));

    await ack([delivered]);
    await recordFailure(refused, "rls", true);
    await Promise.resolve();

    expect(outcomes).toEqual([true, false]);
  });

  it("whenRowDelivered waits for the NEWEST write queued for the row", async () => {
    const first = queueWrite(brief(NINE));
    const second = queueWrite(brief(TEN));
    let landed: boolean | undefined;
    void whenRowDelivered("tasks", "brief").then((v) => (landed = v));

    await ack([await first]);
    await new Promise((r) => setTimeout(r, 0));
    expect(landed).toBeUndefined();

    await ack([await second]);
    await new Promise((r) => setTimeout(r, 0));
    expect(landed).toBe(true);
  });

  it("the Google mirror is asked only after the edit reaches Postgres", async () => {
    const queued = queueWrite(brief(TEN));
    mirrorTask("brief");

    await queued;
    await new Promise((r) => setTimeout(r, 0));
    // Fired at enqueue time, the function read the pre-drag row.
    expect(invoked).toEqual([]);

    await ack([await queued]);
    await vi.waitFor(() => expect(invoked.map((c) => c.fn)).toEqual(["task-mirror"]));
  });

  it("a write the server refused is never mirrored", async () => {
    const queued = queueWrite(brief(TEN));
    mirrorTask("brief");
    const stored: Op = await queued;
    await recordFailure(stored, "check constraint", true);
    await new Promise((r) => setTimeout(r, 10));
    expect(invoked).toEqual([]);
  });
});
