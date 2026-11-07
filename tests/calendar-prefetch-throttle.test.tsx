// @vitest-environment jsdom
/**
 * Paging fast must still warm what's ahead.
 *
 * Reported as "loading future / previous weeks and months is slow". At a
 * steady pace the neighbours were warm and travel was a cache hit; the misses
 * came from paging QUICKLY. The warm-up waited a 350ms beat and restarted that
 * timer on every range change — a debounce — so a run of presses each cancelled
 * the warm-up the last one scheduled, nothing ahead was ever fetched, and every
 * week after the first two landed blank and waited a full round trip. Measured
 * against the dev app with 250ms of added latency: 0ms waits at a 1s pace,
 * ~300ms on every step at a 300ms pace.
 *
 * So: a warm-up goes out at least every `PREFETCH_IDLE_MS` however fast the
 * range changes, and it warms the LATEST ranges, not the ones it was scheduled
 * with. And the budget leans the way you're travelling (`warmSteps`).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/supabase", () => ({
  supabase: { from: () => ({}) },
  invokeQuiet: vi.fn(),
}));

import { PREFETCH_IDLE_MS, useCalendarRangePrefetch, useTravelDirection } from "../src/hooks/useCalendar";
import { warmSteps } from "../src/lib/scheduleRange";

type R = { start: string; end: string };
const week = (n: number): R => {
  const s = new Date(Date.UTC(2026, 10, 2 + 7 * n));
  const e = new Date(Date.UTC(2026, 10, 9 + 7 * n));
  return { start: s.toISOString(), end: e.toISOString() };
};

let qc: QueryClient;
let warmed: string[];

beforeEach(() => {
  vi.useFakeTimers();
  qc = new QueryClient();
  warmed = [];
  // Record what each warm-up asks for; never touch the network.
  vi.spyOn(qc, "prefetchQuery").mockImplementation(async (opts: { queryKey: readonly unknown[] }) => {
    const k = opts.queryKey;
    if (k[0] === "external_events") warmed.push(String(k[1]));
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: qc }, children);

describe("useCalendarRangePrefetch", () => {
  it("keeps warming while the range changes faster than the beat", () => {
    const { rerender } = renderHook(({ at }) => useCalendarRangePrefetch([week(at + 1)]), {
      wrapper,
      initialProps: { at: 0 },
    });
    // Ten presses, each well inside the beat. A debounce warms nothing here.
    const pace = Math.floor(PREFETCH_IDLE_MS / 3);
    for (let at = 1; at <= 10; at++) {
      vi.advanceTimersByTime(pace);
      rerender({ at });
    }
    vi.advanceTimersByTime(PREFETCH_IDLE_MS);
    expect(warmed.length).toBeGreaterThanOrEqual(3);
    // And what it warmed was where you were standing at the time, ending at the
    // frontier — not the range it was first scheduled for.
    expect(warmed.at(-1)).toBe(week(11).start);
  });

  it("still waits one beat before the first warm-up", () => {
    renderHook(() => useCalendarRangePrefetch([week(1)]), { wrapper });
    vi.advanceTimersByTime(PREFETCH_IDLE_MS - 1);
    expect(warmed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(warmed).toEqual([week(1).start]);
  });

  it("warms nothing after unmount", () => {
    const { unmount } = renderHook(() => useCalendarRangePrefetch([week(1)]), { wrapper });
    unmount();
    vi.advanceTimersByTime(PREFETCH_IDLE_MS * 2);
    expect(warmed).toEqual([]);
  });
});

describe("useTravelDirection", () => {
  it("reads forward, back, and a lens change as rest", () => {
    const { result, rerender } = renderHook(({ r }) => useTravelDirection(r), {
      initialProps: { r: week(0) },
    });
    expect(result.current).toBe(0);
    rerender({ r: week(1) });
    expect(result.current).toBe(1);
    rerender({ r: week(1) });
    expect(result.current).toBe(1);
    rerender({ r: week(0) });
    expect(result.current).toBe(-1);
    // Same start, different length: a zoom, not travel.
    rerender({ r: { start: week(0).start, end: week(2).end } });
    expect(result.current).toBe(0);
    rerender({ r: { start: week(1).start, end: week(3).end } });
    expect(result.current).toBe(1);
    rerender({ r: week(1) });
    expect(result.current).toBe(0);
    rerender({ r: week(5) });
    expect(result.current).toBe(1);
    rerender({ r: { start: week(4).start, end: week(9).end } });
    expect(result.current).toBe(0);
  });
});

describe("warmSteps", () => {
  it("is symmetric at rest, nearest first", () => {
    expect(warmSteps(0, 2, 3)).toEqual([1, -1, 2, -2]);
    expect(warmSteps(0, 1, 2)).toEqual([1, -1]);
  });
  it("leans the way you're going, one step behind", () => {
    expect(warmSteps(1, 2, 3)).toEqual([1, -1, 2, 3]);
    expect(warmSteps(-1, 2, 3)).toEqual([-1, 1, -2, -3]);
    expect(warmSteps(1, 1, 2)).toEqual([1, -1, 2]);
  });
  it("holds no more week ranges moving than at rest on the Schedule", () => {
    expect(warmSteps(1, 2, 3).length).toBe(warmSteps(0, 2, 3).length);
  });
});
