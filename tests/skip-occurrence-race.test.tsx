// @vitest-environment jsdom
/**
 * Two quick "skip this occurrence" acts on one series both wrote from the
 * `rec` the caller rendered with — the second write's exdates didn't contain
 * the first, so the first skipped day came back. skipOccurrence now folds in
 * the cache and writes it back before queueing.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { expect, it, vi } from "vitest";
import type { Recurrence } from "../src/lib/types";

const queued: { table: string; kind: string; payload?: Record<string, unknown> }[] = [];

vi.mock("../src/lib/sync", () => ({
  invalidateWhenSafe: () => {},
  holdFetchesBehindWrite: () => {},
  runWithoutOwingPreserve: (fn: () => unknown) => fn(),
  settleWrite: () => {},
  makeOp: (table: string, kind: string, rowId: string, payload: Record<string, unknown> = {}) => ({ table, kind, rowId, payload }),
  queueWrite: (op: { table: string; kind: string; payload?: Record<string, unknown> }) => {
    queued.push(op);
    return Promise.resolve(op);
  },
}));

vi.mock("../src/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) },
  invokeQuiet: vi.fn(),
  mirrorTask: vi.fn(),
}));

vi.mock("../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { default_task_duration_minutes: 30 } }),
}));

const { useRecurrenceMutations } = await import("../src/hooks/useRecurrence");

it("a second skip keeps the first skip's date", async () => {
  const rec = { id: "rec1", exdates: ["2026-11-02"] } as unknown as Recurrence;
  const qc = new QueryClient();
  qc.setQueryData<Recurrence[]>(["recurrences"], [rec]);
  const { result } = renderHook(() => useRecurrenceMutations(), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });

  // Both acts read the same rendered `rec` — the race as a user hits it.
  await act(async () => {
    await result.current.skipOccurrence(rec, "2026-11-09");
    await result.current.skipOccurrence(rec, "2026-11-16");
  });

  const writes = queued.filter((o) => o.table === "recurrences").map((o) => o.payload?.exdates);
  expect(writes.at(-1)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
  expect(qc.getQueryData<Recurrence[]>(["recurrences"])?.[0].exdates).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
});
