// @vitest-environment jsdom
/**
 * The vertical store's writes, driven through the REAL provider — every op it
 * queues is captured, so a test reads exactly what would reach the server.
 *
 * Each case is a confirmed bug (hardening audit, 2026-11):
 *   · planning NEXT week (late Friday) stamped THIS week's sprint
 *   · deleting a domain left its loose tasks `backlog` with no parent
 *   · deleting a project left its tasks under stale initiative/domain copies
 * plus the guard the first fix needs: entering this week must not release what
 * is already committed to the week ahead.
 */
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

type QueuedOp = { table: string; kind: string; rowId: string; payload: Record<string, unknown> };
const ops: QueuedOp[] = [];
const upserts: Record<string, unknown>[] = [];

vi.mock("../src/lib/sync", () => ({
  makeOp: (table: string, kind: string, rowId: string, payload: Record<string, unknown> = {}) => ({ table, kind, rowId, payload }),
  queueWrite: async (op: QueuedOp) => {
    ops.push(op);
  },
  invalidateWhenSafe: () => {},
  settleWrite: () => {},
  runWithoutOwingPreserve: (fn: () => void) => fn(),
}));

vi.mock("../src/lib/supabase", () => {
  // every read resolves empty (the caches are seeded); a sprint upsert echoes a row
  const chain = (table: string): unknown => {
    let upsertRow: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const m of ["select", "eq", "gt", "gte", "lt", "order", "abortSignal", "in", "neq", "not", "is", "maybeSingle", "range", "limit"]) q[m] = self;
    q.upsert = (row: Record<string, unknown>) => {
      upsertRow = row;
      upserts.push({ table, ...row });
      return q;
    };
    q.single = () => Promise.resolve({ data: upsertRow ? { id: `S-${upsertRow.week_start}`, ...upsertRow } : null, error: null });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return {
    supabase: { from: chain, auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }), getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } },
    invokeQuiet: () => {},
    mirrorTask: () => {},
  };
});
vi.mock("../src/hooks/useCalendar", () => ({ useExternalEvents: () => ({ data: [] }) }));
vi.mock("../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: null }) }));
vi.mock("../src/hooks/useEventRouting", () => ({ useEventRouting: () => ({}) }));
vi.mock("../src/hooks/useUndoStack", () => ({ useOptionalUndoStack: () => ({ recordUndo: () => {} }) }));
vi.mock("../src/hooks/useTasks", () => ({
  fetchAllTasks: async () => [],
  patchCaches: () => {},
  putTaskInCaches: () => {},
}));
vi.mock("../src/hooks/useSlots", () => ({ insertSlotCache: () => {}, patchSlotCaches: () => {} }));

import { VerticalProvider, useVertical, type VerticalStore } from "../src/hooks/useVertical";

const THIS_WEEK = "2026-11-09";
const NEXT_WEEK = "2026-11-16";
const sprint = (week: string) => ({ id: `S-${week}`, week_start: week, goal: "", big_rocks: [], reviewed_at: null });

function row(o: Record<string, unknown>) {
  return { title: String(o.id), status: "backlog", project_id: null, initiative_id: null, domain_id: null, do_date: null, start_time: null, sprint_id: null, slot_id: null, recurrence_id: null, duration_minutes: 30, ...o };
}

let store: VerticalStore;
function Probe() {
  store = useVertical();
  return null;
}

function mount(seed: { tasks?: unknown[]; projects?: unknown[]; initiatives?: unknown[]; domains?: unknown[]; sprints?: Record<string, unknown>; ahead?: unknown[] }) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(["vertical", "domains"], seed.domains ?? []);
  qc.setQueryData(["vertical", "initiatives"], seed.initiatives ?? []);
  qc.setQueryData(["vertical", "projects"], seed.projects ?? []);
  qc.setQueryData(["tasks", "all"], seed.tasks ?? []);
  qc.setQueryData(["activity_units", "motion"], []);
  for (const [week, s] of Object.entries(seed.sprints ?? {})) qc.setQueryData(["sprint", week], s);
  if (seed.ahead) qc.setQueryData(["sprints-ahead", THIS_WEEK], seed.ahead);
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  render(
    <VerticalProvider>
      <Probe />
    </VerticalProvider>,
    { wrapper: wrap },
  );
  return qc;
}

const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

beforeEach(() => {
  ops.length = 0;
  upserts.length = 0;
  // Friday 2026-11-13, 4:50pm in the app's zone — the plan opens on NEXT week
  // (planSessionWeekStart) while planningWeekStart still says this week
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T00:50:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("planning next week writes NEXT week's sprint", () => {
  it("planWeek stamps the named week's sprint on every task and on the week", async () => {
    mount({
      tasks: [row({ id: "t1" }), row({ id: "t2" })],
      sprints: { [THIS_WEEK]: sprint(THIS_WEEK), [NEXT_WEEK]: sprint(NEXT_WEEK) },
      ahead: [{ id: `S-${NEXT_WEEK}`, week_start: NEXT_WEEK }],
    });
    await act(() =>
      store.planWeek({
        weekStartISO: NEXT_WEEK,
        commitTaskIds: ["t1", "t2"],
        placements: [{ id: "t1", doDateISO: "2026-11-17", startISO: "2026-11-17T17:00:00.000Z", durationMins: 60 }],
        goal: "ship it",
      }),
    );
    const taskOps = ops.filter((o) => o.table === "tasks");
    expect(taskOps.length).toBeGreaterThan(0);
    for (const o of taskOps) expect(o.payload.sprint_id).toBe(`S-${NEXT_WEEK}`);
    const sprintOps = ops.filter((o) => o.table === "sprints");
    expect(sprintOps.map((o) => o.rowId)).toEqual([NEXT_WEEK]);
    expect(sprintOps[0].payload.goal).toBe("ship it");
  });

  it("an un-cached week's sprint is created for THAT week, and creating it releases nothing", async () => {
    mount({
      tasks: [row({ id: "live", sprint_id: `S-${THIS_WEEK}` }), row({ id: "t1" })],
      sprints: { [THIS_WEEK]: sprint(THIS_WEEK) },
      ahead: [],
    });
    await act(() => store.planWeek({ weekStartISO: NEXT_WEEK, commitTaskIds: ["t1"], placements: [], goal: "", stamp: false }));
    await flush();
    expect(upserts).toEqual([{ table: "sprints", user_id: "u1", week_start: NEXT_WEEK }]);
    expect(ops.filter((o) => o.rowId === "live")).toEqual([]); // this week's work is untouched
    expect(ops.find((o) => o.rowId === "t1")?.payload.sprint_id).toBe(`S-${NEXT_WEEK}`);
  });

  it("applySlots and assignToStanding stamp the named week too", async () => {
    mount({
      tasks: [row({ id: "a" }), row({ id: "b" })],
      sprints: { [THIS_WEEK]: sprint(THIS_WEEK), [NEXT_WEEK]: sprint(NEXT_WEEK) },
      ahead: [{ id: `S-${NEXT_WEEK}`, week_start: NEXT_WEEK }],
    });
    await act(async () => {
      await store.applySlots(
        [{ title: "Deep work", doDateISO: "2026-11-17", startISO: "2026-11-17T17:00:00.000Z", durationMins: 90, domainId: null, color: null, taskIds: ["a"] }],
        { weekStartISO: NEXT_WEEK },
      );
      await store.assignToStanding([{ slotId: "standing", doDateISO: "2026-11-18", taskIds: ["b"] }], { weekStartISO: NEXT_WEEK });
    });
    expect(ops.find((o) => o.table === "tasks" && o.rowId === "a")?.payload.sprint_id).toBe(`S-${NEXT_WEEK}`);
    expect(ops.find((o) => o.table === "tasks" && o.rowId === "b")?.payload.sprint_id).toBe(`S-${NEXT_WEEK}`);
  });

  it("entering THIS week releases past commitments but never next week's", async () => {
    mount({
      tasks: [row({ id: "old", sprint_id: "S-2026-11-02" }), row({ id: "ahead", sprint_id: `S-${NEXT_WEEK}` })],
      sprints: { [THIS_WEEK]: sprint(THIS_WEEK), [NEXT_WEEK]: sprint(NEXT_WEEK) },
      ahead: [{ id: `S-${NEXT_WEEK}`, week_start: NEXT_WEEK }],
    });
    await act(async () => {
      await store.ensureWeek();
    });
    await flush();
    expect(ops.find((o) => o.rowId === "old")?.payload).toEqual({ status: "inbox", sprint_id: null });
    expect(ops.find((o) => o.rowId === "ahead")).toBeUndefined();
  });
});

describe("deleting a record re-files its work", () => {
  it("deleteDomain sends a loose backlog task to the inbox before the domain goes", async () => {
    mount({
      domains: [{ id: "D", name: "Home", color: "#000", icon: "diamond", sort_order: 0 }],
      tasks: [row({ id: "loose", domain_id: "D" }), row({ id: "kept", domain_id: "D", do_date: "2026-11-20", status: "planned" })],
      sprints: { [THIS_WEEK]: sprint(THIS_WEEK) },
      ahead: [],
    });
    act(() => store.deleteDomain("D"));
    await flush();
    expect(ops.map((o) => `${o.table}:${o.kind}:${o.rowId}`)).toEqual(["tasks:update:loose", "tasks:update:kept", "domains:delete:D"]);
    expect(ops[0].payload).toEqual({ domain_id: null, status: "inbox" });
    expect(ops[1].payload).toEqual({ domain_id: null });
  });

  it("deleteProject files its tasks under the project's initiative and domain", async () => {
    mount({
      domains: [{ id: "A", name: "Work", color: "#000", icon: "diamond", sort_order: 0 }],
      initiatives: [{ id: "I", domain_id: "A", name: "Bet", status: "in_progress", sort_order: 0, key_results: [] }],
      projects: [{ id: "P", initiative_id: "I", domain_id: "A", name: "Proj", status: "in_progress", sort_order: 0 }],
      tasks: [row({ id: "t", project_id: "P", initiative_id: "stale", domain_id: "stale" })],
      sprints: { [THIS_WEEK]: sprint(THIS_WEEK) },
      ahead: [],
    });
    await act(async () => {
      store.deleteProject("P");
    });
    await flush();
    expect(ops.find((o) => o.table === "tasks" && o.rowId === "t")?.payload).toEqual({ project_id: null, initiative_id: "I", domain_id: "A" });
    expect(ops.some((o) => o.table === "projects" && o.kind === "delete" && o.rowId === "P")).toBe(true);
  });
});
