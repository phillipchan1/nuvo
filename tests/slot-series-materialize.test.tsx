// @vitest-environment jsdom
/**
 * A repeating slot drawn on the Schedule never appeared. Slots live only in
 * range caches (`["slots", start, end]`); materialise asked for an unfiltered
 * `["slots"]` pool that nothing loads, got null, and skipped. Unknown must
 * still mean skip for a series that already exists — that guess queued 385
 * duplicate inserts. A series id minted in this call is the exception.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { addDays } from "date-fns";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseDateISO, toDateISO, todayISO } from "../src/lib/dates";
import { expandRule, HORIZON_DAYS } from "../src/lib/recurrence";
import { ruleOf, type Recurrence, type Slot } from "../src/lib/types";
import { SLOT_OCCURRENCES_KEY } from "../src/hooks/useSlots";

const queued: { table: string; kind: string; payload?: Record<string, unknown> }[] = [];

vi.mock("../src/lib/sync", () => ({
  invalidateWhenSafe: () => {},
  holdFetchesBehindWrite: () => {},
  runWithoutOwingPreserve: (fn: () => unknown) => fn(),
  settleWrite: () => {},
  makeOp: (table: string, kind: string, rowId: string, payload: Record<string, unknown> = {}) => ({
    table,
    kind,
    rowId,
    payload,
    ts: "2026-11-04T00:00:00.000Z",
  }),
  queueWrite: (op: { table: string; kind: string; payload?: Record<string, unknown> }) => {
    queued.push(op);
    return Promise.resolve(op);
  },
}));

const db = {
  slotsError: null as { message: string } | null,
  recurrences: [] as Recurrence[],
};

vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          if (table === "slots" && db.slotsError) {
            return Promise.resolve({ data: null, error: db.slotsError }).then(resolve, reject);
          }
          const data = table === "recurrences" ? db.recurrences : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  },
  invokeQuiet: vi.fn(),
  mirrorTask: vi.fn(),
}));

vi.mock("../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { default_task_duration_minutes: 30 } }),
}));

const { useRecurrenceMutations } = await import("../src/hooks/useRecurrence");

const RANGE = ["slots", "2026-11-01T08:00:00.000Z", "2026-11-08T08:00:00.000Z"] as const;

function wipe() {
  queued.length = 0;
  db.slotsError = null;
  db.recurrences = [];
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  qc.setQueryData([...RANGE], []);
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  const { result } = renderHook(() => useRecurrenceMutations(), { wrapper });
  return { qc, result };
}

function series(over: Partial<Recurrence> = {}): Recurrence {
  return {
    id: "series-1",
    user_id: "u",
    kind: "slot",
    freq: "daily",
    interval: 1,
    byweekday: [],
    bymonthday: null,
    bysetpos: null,
    bymonth: null,
    anchor_date: todayISO(),
    until_date: null,
    max_count: null,
    exdates: [],
    title: "Deep work",
    duration_minutes: 60,
    time_of_day_minutes: 9 * 60,
    project_id: null,
    domain_id: null,
    priority: "none",
    color: null,
    active: true,
    last_materialized: null,
    ...over,
  };
}

beforeEach(wipe);

describe("materialising a slot series", () => {
  it("lays occurrences down from a range cache alone when the series is new", async () => {
    db.slotsError = { message: "offline" };
    const { qc, result } = setup();
    expect(qc.getQueryData(["slots"])).toBeUndefined();

    let recId = "";
    await act(async () => {
      const rec = await result.current.createSeries({
        kind: "slot",
        rule: { freq: "daily", interval: 1 },
        anchorISO: todayISO(),
        template: { title: "Deep work", duration_minutes: 60, time_of_day_minutes: 9 * 60 },
      });
      recId = rec.id;
    });

    const slots = qc.getQueryData<Slot[]>([...RANGE]) ?? [];
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.recurrence_id === recId)).toBe(true);
    expect(slots.some((s) => s.recurrence_date === todayISO())).toBe(true);

    const inserts = queued.filter((o) => o.table === "slots" && o.kind === "insert");
    expect(inserts).toHaveLength(slots.length);
  });

  it("does not insert dates the occurrence index already lists", async () => {
    const rec = series();
    const horizon = toDateISO(addDays(parseDateISO(todayISO()), HORIZON_DAYS));
    const dates = expandRule(ruleOf(rec), rec.anchor_date, todayISO(), horizon, rec.exdates);
    expect(dates.length).toBeGreaterThan(0);

    db.recurrences = [rec];
    const { qc, result } = setup();
    qc.setQueryData(
      SLOT_OCCURRENCES_KEY,
      dates.map((d) => ({ recurrence_id: rec.id, recurrence_date: d })),
    );

    await act(async () => {
      await result.current.materializeAll();
    });

    expect(qc.getQueryData<Slot[]>([...RANGE])).toEqual([]);
    expect(queued.filter((o) => o.table === "slots" && o.kind === "insert")).toHaveLength(0);
  });
});
