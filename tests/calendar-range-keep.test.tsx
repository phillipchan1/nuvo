// @vitest-environment jsdom
/**
 * The calendar must not empty itself while it fetches the span you swiped to.
 *
 * This was reported as "swiping left and right lags fetching the events". It
 * was not render cost: every range change minted a new query key, so
 * `useExternalEvents` and `useScheduledTasks` returned `undefined` (defaulted to
 * `[]` by the caller) for the whole round trip, and the blocks blanked and
 * refilled. `useSlots` had fixed exactly this for slots, in a comment, long
 * before — so the failure mode was known, and the fix simply hadn't been
 * applied to the two queries that draw almost everything.
 *
 * The assertion is about what a component reading the hook would SEE across the
 * change, which is the only thing the user can perceive.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── a Supabase stand-in with a controllable delay ──────────────────────────
const net = {
  /** Resolvers parked so a fetch can be held open mid-test. */
  pending: [] as (() => void)[],
  hold: false,
  calls: [] as string[],
  rowsFor: (rangeKey: string) => [{ id: `ev-${rangeKey}` }],
};

function builder(table: string) {
  let captured = "";
  const api: Record<string, unknown> = {};
  for (const m of ["select", "lt", "gt", "gte", "not", "in", "is", "order"]) {
    api[m] = (...args: unknown[]) => {
      if (m === "lt" || m === "gte") captured += String(args[1] ?? "");
      return api;
    };
  }
  const settle = () => {
    net.calls.push(table);
    const rows = net.rowsFor(captured);
    return { data: rows, error: null };
  };
  api.range = () =>
    new Promise((resolve) => {
      if (net.hold) net.pending.push(() => resolve(settle()));
      else resolve(settle());
    });
  // useScheduledTasks awaits the builder itself (no .range()).
  (api as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) =>
    new Promise((resolve) => {
      if (net.hold) net.pending.push(() => resolve(settle()));
      else resolve(settle());
    }).then(onFulfilled);
  return api;
}

vi.mock("../src/lib/supabase", () => ({
  supabase: { from: (table: string) => builder(table) },
  invokeQuiet: vi.fn(),
}));

// The hooks pull in a lot of app surface; stub the pieces that need a browser.
vi.mock("../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: undefined, update: vi.fn() }),
  firstDayOfWeek: () => 0,
}));

let useExternalEvents: typeof import("../src/hooks/useCalendar")["useExternalEvents"];

beforeEach(async () => {
  net.pending = [];
  net.hold = false;
  net.calls = [];
  ({ useExternalEvents } = await import("../src/hooks/useCalendar"));
});

afterEach(() => {
  vi.clearAllMocks();
});

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

describe("a range change keeps what is already on screen", () => {
  it("never hands back an empty list while the next span loads", async () => {
    const qc = client();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result, rerender } = renderHook(
      ({ start, end }: { start: string; end: string }) => useExternalEvents(start, end),
      { wrapper, initialProps: { start: "2026-08-01", end: "2026-09-01" } },
    );

    await waitFor(() => expect(result.current.data).toBeTruthy());
    const first = result.current.data;
    expect(first).toHaveLength(1);

    // Swipe: a brand-new key, and this time hold the network open so the gap
    // the user used to stare at is wide and unmissable.
    net.hold = true;
    rerender({ start: "2026-09-01", end: "2026-10-01" });

    // The moment after the change — the frame that used to be blank.
    expect(result.current.data).toEqual(first);
    expect(result.current.data).not.toHaveLength(0);
    // `isLoading` is what a body uses to draw "Reading your calendar…", so it
    // must stay down: placeholderData means pending is false.
    expect(result.current.isLoading).toBe(false);

    // Let it land, and the new span replaces the old in place.
    net.hold = false;
    net.pending.forEach((r) => r());
    await waitFor(() => expect(result.current.data).not.toEqual(first));
    expect(result.current.data).toHaveLength(1);
  });

  it("does not re-fetch a span it already holds (the swipe back)", async () => {
    const qc = client();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result, rerender } = renderHook(
      ({ start, end }: { start: string; end: string }) => useExternalEvents(start, end),
      { wrapper, initialProps: { start: "2026-08-01", end: "2026-09-01" } },
    );
    await waitFor(() => expect(result.current.data).toBeTruthy());

    rerender({ start: "2026-09-01", end: "2026-10-01" });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    const afterForward = net.calls.length;

    // Back to August, which is in the cache and inside its stale window.
    rerender({ start: "2026-08-01", end: "2026-09-01" });
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(net.calls.length).toBe(afterForward);
  });
});
