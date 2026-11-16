// @vitest-environment jsdom
/**
 * The reminder loop's event / slot window follows the local day.
 *
 * It was memoized on `enabled` alone, so the window froze at mount: an app left
 * open past `REMINDER_QUERY_DAYS` queried a range that had entirely passed, and
 * event and slot reminders simply stopped. And the delivery loop marks a fire
 * by `firedReminderKey` (key + instant), so a re-timed block speaks again.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ranges: [string, string][] = [];

/** jsdom on this Node has no usable localStorage; the fired set needs one. */
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  get length() {
    return mem.size;
  },
  clear: () => mem.clear(),
  getItem: (k: string) => mem.get(k) ?? null,
  key: (i: number) => [...mem.keys()][i] ?? null,
  removeItem: (k: string) => void mem.delete(k),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
} satisfies Storage);

vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    rpc: () => Promise.resolve({ data: true, error: null }),
  },
}));
vi.mock("../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { reminder_prefs: { ...PREFS } } }),
}));
vi.mock("../src/hooks/useTasks", () => ({ useAllTasks: () => ({ data: TASKS }) }));
vi.mock("../src/hooks/useSlots", () => ({ useSlots: () => ({ data: [] }) }));
vi.mock("../src/hooks/useCalendar", () => ({
  useExternalEvents: (start: string, end: string) => {
    ranges.push([start, end]);
    return { data: [] };
  },
  useHiddenEvents: () => ({ keys: new Set() }),
}));
vi.mock("../src/lib/push", () => ({ subscribeToPush: vi.fn(), unsubscribeFromPush: vi.fn() }));

const { DEFAULT_REMINDER_PREFS, firedReminderKey } = await import("../supabase/functions/_shared/reminderRules.ts");
const PREFS = { ...DEFAULT_REMINDER_PREFS, enabled: true };
const TASKS: unknown[] = [];
const { useReminderDelivery } = await import("../src/hooks/useReminders");
const { REMINDER_QUERY_DAYS } = await import("../src/lib/reminders");

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useReminderDelivery(), { wrapper });
}

const localMidnight = (y: number, mo: number, d: number) => new Date(y, mo - 1, d).toISOString();

beforeEach(() => {
  ranges.length = 0;
  TASKS.length = 0;
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the reminder window", () => {
  it("moves with the day while the app stays open", async () => {
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
    mount();
    expect(ranges.at(-1)).toEqual([localMidnight(2026, 11, 16), localMidnight(2026, 11, 16 + REMINDER_QUERY_DAYS)]);

    // Seventeen days later, without a reload.
    vi.setSystemTime(new Date(2026, 11, 3, 10, 0));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(ranges.at(-1)).toEqual([localMidnight(2026, 12, 3), localMidnight(2026, 12, 3 + REMINDER_QUERY_DAYS)]);
  });

  it("keeps the same window within a day (the key stays stable)", async () => {
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
    mount();
    const first = ranges.at(-1);
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(ranges.at(-1)).toEqual(first);
  });

  it("marks a delivered reminder by key and instant", async () => {
    const start = new Date(2026, 10, 16, 10, 10);
    TASKS.push({ id: "t1", title: "Write", status: "planned", start_time: start.toISOString(), duration_minutes: 30, do_date: "2026-11-16" });
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
    const { result } = mount();
    const r = result.current.plan[0];
    expect(r).toBeDefined();
    await act(async () => {
      vi.advanceTimersByTime(r.fireAtMs - Date.now() + 1_000);
    });
    const fired = JSON.parse(localStorage.getItem("nuvo.reminders.fired") ?? "{}");
    expect(Object.keys(fired)).toContain(firedReminderKey(r));
  });
});
