// @vitest-environment jsdom
/**
 * A refused provider write-back is SAID, and the row goes back to the truth.
 *
 * A plain THIS-scope edit writes the mirror row first (so every device moves
 * now) and PATCHes Google / iCloud after. When the PATCH failed, the failure
 * went only to the error log: the grid kept showing the edit, the row kept
 * times the provider never took, and no sync would ever bring them back.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalEvent } from "../src/lib/types";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }),
}));

interface Invocation {
  fn: string;
  body: Record<string, unknown>;
  answer: (data: unknown) => void;
}
const net = {
  rows: new Map<string, Record<string, unknown>>(),
  rowWrites: [] as { id: string; columns: Record<string, unknown> }[],
  invokes: [] as Invocation[],
};

function eventsTable() {
  return {
    update(columns: Record<string, unknown>) {
      return {
        eq(_col: string, id: string) {
          const write = () => {
            net.rowWrites.push({ id, columns });
            const row = { ...(net.rows.get(id) ?? {}), ...columns };
            net.rows.set(id, row);
            return { data: { start_at: row.start_at, end_at: row.end_at }, error: null };
          };
          return {
            select: () => ({ maybeSingle: () => Promise.resolve(write()) }),
            then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(write()).then(onFulfilled),
          };
        },
      };
    },
  };
}

vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from: () => eventsTable(),
    functions: {
      invoke: (fn: string, opts: { body: Record<string, unknown> }) =>
        new Promise((resolve) => {
          net.invokes.push({ fn, body: opts.body, answer: (data) => resolve({ data, error: null }) });
        }),
    },
  },
  invokeQuiet: vi.fn(),
  mirrorTask: vi.fn(),
}));
vi.mock("../src/hooks/useOnline", () => ({ useOnline: () => true }));
vi.mock("../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: undefined, update: vi.fn() }),
  firstDayOfWeek: () => 0,
  normalizeSettingsRow: (row: unknown) => row,
}));
vi.mock("../src/lib/appError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/appError")>()),
  reportAppError: vi.fn(),
}));

const { useExternalEventMutations, EVENT_WRITEBACK_REFUSED } = await import("../src/hooks/useCalendar");
const { resetEventWritebackForTests } = await import("../src/lib/eventWriteback");

const RANGE = ["external_events", "2026-10-12T07:00:00.000Z", "2026-10-19T07:00:00.000Z"] as const;
const at = (hour: number) => `2026-10-15T${String(hour).padStart(2, "0")}:00:00.000Z`;

const standup: ExternalEvent = {
  id: "standup",
  account_id: "acct",
  provider_event_id: "g-standup",
  calendar_id: "me@example.com",
  title: "Standup",
  start_at: at(16),
  end_at: at(17),
  all_day: false,
  location: null,
  busy: true,
  self_rsvp: null,
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["calendar_accounts"], [
    {
      id: "acct",
      provider: "google",
      email: "me@example.com",
      sync_direction: "two_way",
      calendars: [{ id: "me@example.com", summary: "Me", primary: true }],
      mirror_calendar_id: null,
      needs_reconnect: false,
    },
  ]);
  qc.setQueryData([...RANGE], [standup]);
  net.rows.set("standup", { ...standup });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  const { result } = renderHook(() => useExternalEventMutations(), { wrapper });
  return { qc, result };
}

const onScreen = (qc: QueryClient) => qc.getQueryData<ExternalEvent[]>([...RANGE]) ?? [];

beforeEach(() => {
  net.rows.clear();
  net.rowWrites = [];
  net.invokes = [];
  toastError.mockClear();
  resetEventWritebackForTests();
});

describe("a provider that refuses a THIS-scope edit", () => {
  it("says so, and puts the row and the grid back", async () => {
    const { qc, result } = setup();

    act(() => result.current.updateEvent({ id: "standup", patch: { start_at: at(18), end_at: at(19) } }));
    await waitFor(() => expect(net.invokes).toHaveLength(1));
    // The row moved first, as it should.
    expect(net.rows.get("standup")?.start_at).toBe(at(18));
    expect(onScreen(qc)[0].start_at).toBe(at(18));

    await act(async () => net.invokes[0].answer({ error: "bad_request" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(EVENT_WRITEBACK_REFUSED, expect.anything()));
    // The row holds what Google holds again…
    expect(net.rows.get("standup")?.start_at).toBe(at(16));
    expect(net.rows.get("standup")?.end_at).toBe(at(17));
    // …and so does the screen.
    expect(onScreen(qc)[0].start_at).toBe(at(16));
    expect(onScreen(qc)[0].end_at).toBe(at(17));
  });

  it("goes back to what the provider last took, not further", async () => {
    const { qc, result } = setup();

    act(() => result.current.updateEvent({ id: "standup", patch: { start_at: at(18), end_at: at(19) } }));
    await waitFor(() => expect(net.invokes).toHaveLength(1));
    await act(async () => net.invokes[0].answer({ ok: true }));

    act(() => result.current.updateEvent({ id: "standup", patch: { title: "Standup (moved)", start_at: at(20), end_at: at(21) } }));
    await waitFor(() => expect(net.invokes).toHaveLength(2));
    await act(async () => net.invokes[1].answer({ error: "request_failed" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(net.rows.get("standup")).toMatchObject({ title: "Standup", start_at: at(18), end_at: at(19) });
    expect(onScreen(qc)[0]).toMatchObject({ title: "Standup", start_at: at(18), end_at: at(19) });
  });

  it("an accepted edit says nothing", async () => {
    const { result } = setup();
    act(() => result.current.updateEvent({ id: "standup", patch: { start_at: at(18), end_at: at(19) } }));
    await waitFor(() => expect(net.invokes).toHaveLength(1));
    await act(async () => net.invokes[0].answer({ ok: true }));
    expect(toastError).not.toHaveBeenCalled();
    expect(net.rows.get("standup")?.start_at).toBe(at(18));
  });
});
