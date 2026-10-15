// @vitest-environment jsdom
/**
 * Writing a Google event back — the races the 2026-10-15 Schedule audit found
 * by reading the code (docs/schedule-ux-audit-2026-10-15.md, P0 #5 and #7).
 * These drive the REAL `useExternalEventMutations` over a stubbed transport
 * whose edge-function calls the test answers by hand, which is the only way to
 * hold a PATCH open while the user drags again.
 *
 *  • Re-drag inside a second: every drag fired its own row write and PATCH at
 *    once, so the provider kept whichever PATCH arrived last and the first
 *    drag's echo painted over the second.
 *  • Create: the optimistic row had no account or calendar (drawn hatched and
 *    read-only, like M365), and the real row's Realtime INSERT was drawn beside
 *    it until a refetch of every range cleaned up.
 *
 * Each assertion failed before its fix.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalEvent } from "../src/lib/types";

// ── a Supabase stand-in whose edge-function calls the test answers ───────
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

const { useExternalEventMutations } = await import("../src/hooks/useCalendar");
const { applyLiveChange } = await import("../src/lib/sync/liveApply");
const { isPendingEventCreate, resetEventWritebackForTests } = await import("../src/lib/eventWriteback");
const { convertTaskToEvent } = await import("../src/lib/calendarWrite");

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
const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

function echo(row: Partial<ExternalEvent> & { id: string }, eventType = "UPDATE") {
  return { table: "external_events", eventType, old: { id: row.id }, new: row as Record<string, unknown> };
}

beforeEach(() => {
  net.rows.clear();
  net.rowWrites = [];
  net.invokes = [];
  resetEventWritebackForTests();
});

describe("re-dragging a Google event while its write-back is out", () => {
  it("sends one PATCH at a time, and the last one carries the last drag", async () => {
    const { qc, result } = setup();

    act(() => result.current.updateEvent({ id: "standup", patch: { start_at: at(18), end_at: at(19) } }));
    await waitFor(() => expect(net.invokes).toHaveLength(1));

    // Two more drags while Google is still answering the first.
    act(() => result.current.updateEvent({ id: "standup", patch: { start_at: at(20), end_at: at(21) } }));
    act(() => result.current.updateEvent({ id: "standup", patch: { start_at: at(22), end_at: at(23) } }));
    await settle();

    // Fired side by side, all three PATCHes were out at once and Google kept
    // whichever arrived last.
    expect(net.invokes).toHaveLength(1);
    expect(net.rowWrites).toHaveLength(1);
    expect(onScreen(qc)[0].start_at).toBe(at(22));

    await act(async () => net.invokes[0].answer({ ok: true }));
    await waitFor(() => expect(net.invokes).toHaveLength(2));

    // The two waiting drags went as one, with the newest times.
    const second = net.invokes[1].body as { patch: { start_at: string }; rowAt: { start_at: string } };
    expect(second.patch.start_at).toBe(at(22));
    expect(net.rowWrites.map((w) => w.columns.start_at)).toEqual([at(18), at(22)]);
    // …and it tells the function which row state its rewrite is for.
    expect(Date.parse(second.rowAt.start_at)).toBe(Date.parse(at(22)));

    await act(async () => net.invokes[1].answer({ ok: true }));
    expect(net.invokes).toHaveLength(2);
  });

  it("does not paint the echo of an earlier drag over a later one", async () => {
    const { qc, result } = setup();

    act(() => result.current.updateEvent({ id: "standup", patch: { start_at: at(18), end_at: at(19) } }));
    await waitFor(() => expect(net.invokes).toHaveLength(1));
    act(() => result.current.updateEvent({ id: "standup", patch: { start_at: at(20), end_at: at(21) } }));
    await settle();

    // The first drag's row write (or the function's rewrite of it) echoes now.
    applyLiveChange(qc, echo({ ...standup, start_at: "2026-10-15T18:00:00+00:00", end_at: "2026-10-15T19:00:00+00:00" }));
    expect(onScreen(qc)[0].start_at).toBe(at(20));

    await act(async () => net.invokes[0].answer({ ok: true }));
    await waitFor(() => expect(net.invokes).toHaveLength(2));
    await act(async () => net.invokes[1].answer({ ok: true }));
    await settle();

    // Lane drained. A late echo of the state it moved past is still not news…
    applyLiveChange(qc, echo({ ...standup, start_at: at(18), end_at: at(19) }));
    expect(onScreen(qc)[0].start_at).toBe(at(20));
    // …but a move made somewhere else is.
    applyLiveChange(qc, echo({ ...standup, start_at: at(14), end_at: at(15) }));
    expect(onScreen(qc)[0].start_at).toBe(at(14));
  });
});

describe("creating a Google event", () => {
  const coffee = { title: "Coffee with Sam", start_at: at(18), end_at: at(19), accountId: "acct", calendarId: "me@example.com" };
  const realRow: ExternalEvent = {
    id: "real-coffee",
    account_id: "acct",
    provider_event_id: "g-coffee",
    calendar_id: "me@example.com",
    title: "Coffee with Sam",
    start_at: "2026-10-15T18:00:00+00:00",
    end_at: "2026-10-15T19:00:00+00:00",
    all_day: false,
    location: null,
    busy: true,
    self_rsvp: null,
  };

  it("draws the new event on its own calendar, not as a read-only stranger", async () => {
    const { qc, result } = setup();
    let created!: Promise<unknown>;
    act(() => {
      created = result.current.createEvent(coffee);
    });
    await waitFor(() => expect(onScreen(qc)).toHaveLength(2));

    const temp = onScreen(qc).find((e) => e.title === "Coffee with Sam")!;
    expect(temp.account_id).toBe("acct");
    expect(temp.calendar_id).toBe("me@example.com");
    // No real id to write to yet: held still until the real row arrives.
    expect(isPendingEventCreate(temp.id)).toBe(true);

    await act(async () => net.invokes[0].answer({ ok: true, event: realRow }));
    await act(async () => {
      await created;
    });
    expect(onScreen(qc).filter((e) => e.title === "Coffee with Sam").map((e) => e.id)).toEqual(["real-coffee"]);
    expect(isPendingEventCreate(temp.id)).toBe(false);
    // The swap put it on screen; refetching every range was only cost.
    expect(qc.getQueryState([...RANGE])?.isInvalidated).toBe(false);
  });

  it("the real row's Realtime INSERT replaces the temporary one instead of joining it", async () => {
    const { qc, result } = setup();
    let created!: Promise<unknown>;
    act(() => {
      created = result.current.createEvent(coffee);
    });
    await waitFor(() => expect(net.invokes).toHaveLength(1));

    // The function upserted the row; its INSERT beats the HTTP answer back.
    applyLiveChange(qc, echo(realRow, "INSERT"));
    expect(onScreen(qc).filter((e) => e.title === "Coffee with Sam").map((e) => e.id)).toEqual(["real-coffee"]);

    await act(async () => net.invokes[0].answer({ ok: true, event: realRow }));
    await act(async () => {
      await created;
    });
    expect(onScreen(qc).filter((e) => e.title === "Coffee with Sam").map((e) => e.id)).toEqual(["real-coffee"]);
  });

  it("a failed create takes its temporary row away", async () => {
    const { qc, result } = setup();
    let created!: Promise<unknown>;
    act(() => {
      created = result.current.createEvent(coffee).catch(() => "failed");
    });
    await waitFor(() => expect(net.invokes).toHaveLength(1));
    await act(async () => net.invokes[0].answer({ error: "no google account connected" }));
    await act(async () => {
      expect(await created).toBe("failed");
    });
    expect(onScreen(qc).map((e) => e.id)).toEqual(["standup"]);
  });
});

describe("Task → Event", () => {
  it("takes the task off the grid when the event is drawn, not after Google answers", async () => {
    const steps: string[] = [];
    let answer!: () => void;
    const made = convertTaskToEvent(
      () =>
        new Promise<void>((resolve) => {
          steps.push("create");
          answer = resolve;
        }),
      { trash: () => steps.push("trash"), restore: () => steps.push("restore") },
    );
    // Before the provider answers, the task is already gone.
    expect(steps).toEqual(["trash", "create"]);
    answer();
    expect(await made).toBe(true);
    expect(steps).toEqual(["trash", "create"]);
  });

  it("brings the task back when the event never gets made", async () => {
    const steps: string[] = [];
    const made = await convertTaskToEvent(
      () => Promise.reject(new Error("calendar disconnected")),
      { trash: () => steps.push("trash"), restore: () => steps.push("restore") },
    );
    expect(made).toBe(false);
    expect(steps).toEqual(["trash", "restore"]);
  });
});
