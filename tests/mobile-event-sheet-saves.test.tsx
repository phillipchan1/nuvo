// @vitest-environment jsdom
/**
 * The phone's event and block sheets lost or mangled what you typed:
 *
 *  - a REPEATING event closed with two edited fields saved only the last —
 *    each field queued its own "this or all?" and the scope gate kept one;
 *  - the notes field was shown empty and editable while the description was
 *    still loading (or had failed), so typing there overwrote the provider's
 *    real body — the agenda, the Zoom link;
 *  - every secondary exit (make it a task, duplicate, move, hide, RSVP, Ask
 *    Nuvo, copy) called onClose past the flush and built from the `tap`
 *    snapshot — a rename typed a moment before was dropped and the copy wore
 *    the old name. The block sheet's chips, duplicate and child-open did too.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalEvent, Slot } from "../src/lib/types";

const calls = {
  updateEvent: vi.fn(),
  createEvent: vi.fn(async () => undefined),
  moveEventToCalendar: vi.fn(async () => undefined),
  rsvpEvent: vi.fn(async () => undefined),
  hide: vi.fn(),
  updateSlot: vi.fn(),
  createSlot: vi.fn(),
};
const details: { data: unknown; isSuccess: boolean } = { data: null, isSuccess: true };

vi.mock("../src/hooks/useCalendar", () => ({
  useCalendarAccounts: () => ({
    data: [
      {
        id: "acct",
        provider: "google",
        email: "me@example.com",
        sync_direction: "two_way",
        calendars: [{ id: "me@example.com", summary: "Me", primary: true }],
      },
    ],
  }),
  useEventDetails: () => details,
  useEventSeriesRule: () => ({ data: null }),
  useExternalEventMutations: () => ({
    updateEvent: calls.updateEvent,
    createEvent: calls.createEvent,
    moveEventToCalendar: calls.moveEventToCalendar,
    rsvpEvent: calls.rsvpEvent,
    deleteEvent: vi.fn(),
    addMeetToEvent: vi.fn(),
  }),
  useHiddenEvents: () => ({ isHidden: () => false, hiddenKeyFor: () => null, hide: calls.hide, unhide: vi.fn() }),
}));
vi.mock("../src/hooks/useSlots", () => ({
  useSlotMutations: () => ({ updateSlot: calls.updateSlot, createSlot: calls.createSlot }),
}));
vi.mock("../src/hooks/useVertical", () => ({ useOptionalVertical: () => null }));
vi.mock("../src/hooks/useOnline", () => ({ useOnline: () => true }));
vi.mock("../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: null }) }));
vi.mock("../src/hooks/useRecurrence", () => ({
  useRecurrences: () => ({ data: [] }),
  useRecurrenceMutations: () => ({}),
}));
vi.mock("../src/components/ReminderSelect", () => ({ default: () => null }));
vi.mock("../src/components/domain/EventDomainControl", () => ({ default: () => null }));
vi.mock("../src/components/tasks/TaskComposer", () => ({ default: () => null }));
vi.mock("../src/components/floors/DeferPanel", () => ({ SlotDeferPanel: () => null }));

const { default: MobileEventSheet } = await import("../src/components/mobile/MobileEventSheet");
const { useRecurringScope } = await import("../src/components/RecurrencePicker");

const start = new Date(2026, 10, 18, 10, 0);
const end = new Date(2026, 10, 18, 11, 0);
const row: ExternalEvent = {
  id: "ev1",
  account_id: "acct",
  provider_event_id: "g-ev1",
  calendar_id: "me@example.com",
  title: "Planning",
  start_at: start.toISOString(),
  end_at: end.toISOString(),
  all_day: false,
  location: null,
  busy: true,
  self_rsvp: null,
} as ExternalEvent;

function mountEvent(opts: { onAskNuvo?: (seed: string, say?: string) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["external_events", "range"], [row]);
  const mutations = { create: vi.fn() };
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MobileEventSheet
        tap={{
          kind: "event",
          id: "ev1",
          providerEventId: "g-ev1",
          title: "Planning",
          start,
          end,
          allDay: false,
          location: null,
          self_rsvp: null,
          accountId: "acct",
          calendarId: "me@example.com",
        }}
        mutations={mutations as never}
        onClose={onClose}
        onAskNuvo={opts.onAskNuvo}
      />
    </QueryClientProvider>,
  );
  return { mutations, onClose };
}

const type = (label: string, value: string) => {
  const el = screen.getByLabelText(label);
  act(() => el.focus());
  fireEvent.change(el, { target: { value } });
  return el;
};

beforeEach(() => {
  Object.values(calls).forEach((f) => f.mockClear());
  details.data = null;
  details.isSuccess = true;
});

describe("useRecurringScope — a second commit never drops the first", () => {
  it("a same-key commit replaces the waiting one: one answer, one write", () => {
    const { result } = renderHook(() => useRecurringScope(true));
    const a = vi.fn();
    const b = vi.fn();
    act(() => result.current.commit(a, undefined, "edit", "text"));
    // Synchronous: a close that just flushed knows at once to stay.
    expect(result.current.isPending()).toBe(true);
    act(() => result.current.commit(b, undefined, "edit", "text"));
    act(() => result.current.confirm("ALL"));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith("ALL");
    expect(result.current.isPending()).toBe(false);
  });

  it("two different edits join: one answer runs both, a cancel reverts both", async () => {
    const { result } = renderHook(() => useRecurringScope(true));
    const a = vi.fn();
    const b = vi.fn();
    act(() => result.current.commit(a));
    act(() => result.current.commit(b));
    await act(async () => result.current.confirm("THIS"));
    expect(a).toHaveBeenCalledWith("THIS");
    expect(b).toHaveBeenCalledWith("THIS");

    const ra = vi.fn();
    const rb = vi.fn();
    act(() => result.current.commit(vi.fn(), ra));
    act(() => result.current.commit(vi.fn(), rb));
    act(() => result.current.cancel());
    expect(ra).toHaveBeenCalled();
    expect(rb).toHaveBeenCalled();
  });
});

describe("a repeating event closed with two edited fields", () => {
  it("asks once and writes ONE patch carrying both", async () => {
    details.data = { recurringEventId: "series-1", description: "" };
    vi.useFakeTimers();
    try {
      const { onClose } = mountEvent();
      type("Event title", "Quarterly planning");
      // Edited without the title ever blurring (dictation, a field iOS never
      // blurred) — then ✕, which takes no focus on iOS. The sheet's dismiss
      // blurs the title (one commit) and the close flushes (another).
      fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Room 4" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      act(() => void vi.advanceTimersByTime(300));
      // Exactly one question is open, and the sheet waits for it.
      expect(screen.getAllByText("Edit this event or the whole series?")).toHaveLength(1);
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
      expect(calls.updateEvent).toHaveBeenCalledTimes(1);
      expect(calls.updateEvent).toHaveBeenCalledWith({
        id: "ev1",
        patch: { title: "Quarterly planning", location: "Room 4" },
        scope: "THIS",
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("notes wait for the description", () => {
  it("no notes field while the details are loading — or after they failed", () => {
    details.data = undefined;
    details.isSuccess = false;
    mountEvent();
    expect(screen.queryByLabelText("Notes")).toBeNull();
  });

  it("a description arriving late never replaces what you typed", () => {
    details.data = { description: "" };
    const qc = new QueryClient();
    const tap = {
      kind: "event" as const,
      id: "ev1",
      title: "Planning",
      start,
      end,
      location: null,
      self_rsvp: null,
      accountId: "acct",
      calendarId: "me@example.com",
    };
    const ui = () => (
      <QueryClientProvider client={qc}>
        <MobileEventSheet tap={tap} mutations={{} as never} onClose={vi.fn()} />
      </QueryClientProvider>
    );
    const { rerender } = render(ui());
    type("Notes", "my own agenda");
    details.data = { description: "Provider body" };
    rerender(ui());
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("my own agenda");
  });
});

describe("every exit flushes, and builds from the fields as they stand", () => {
  it("Make it a task saves the rename and makes the task under the NEW name", () => {
    const { mutations, onClose } = mountEvent();
    type("Event title", "Renamed");
    fireEvent.click(screen.getByText("Make it a task"));
    expect(calls.updateEvent).toHaveBeenCalledWith({ id: "ev1", patch: { title: "Renamed" }, scope: "THIS" });
    expect(mutations.create).toHaveBeenCalledWith(expect.objectContaining({ title: "Renamed" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Duplicate copies the event as the sheet shows it", () => {
    mountEvent();
    type("Event title", "Renamed");
    type("Location", "Cafe");
    fireEvent.click(screen.getByText("Duplicate"));
    expect(calls.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Renamed (copy)", location: "Cafe" }),
    );
    // Both saved (the title on its blur, the place on the way out).
    expect(calls.updateEvent).toHaveBeenCalledWith({ id: "ev1", patch: { title: "Renamed" }, scope: "THIS" });
    expect(calls.updateEvent).toHaveBeenCalledWith({ id: "ev1", patch: { location: "Cafe" }, scope: "THIS" });
  });

  it("Ask Nuvo seeds with the current name, after saving it", () => {
    const ask = vi.fn();
    mountEvent({ onAskNuvo: ask });
    type("Event title", "Board prep");
    fireEvent.click(screen.getByText("Ask Nuvo to help prepare"));
    expect(calls.updateEvent).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('"Board prep"'), "Help me prepare for “Board prep”");
  });

  it("Hide saves the rename before the sheet goes", () => {
    mountEvent();
    type("Event title", "Renamed");
    fireEvent.click(screen.getByText("Hide from calendar"));
    expect(calls.updateEvent).toHaveBeenCalledWith({ id: "ev1", patch: { title: "Renamed" }, scope: "THIS" });
    expect(calls.hide).toHaveBeenCalled();
  });
});

describe("the block sheet's exits commit its title", () => {
  const slot = {
    id: "s1",
    title: "Deep work",
    do_date: "2026-11-18",
    start_time: start.toISOString(),
    duration_minutes: 90,
    project_id: null,
    domain_id: null,
    color: null,
    recurrence_id: null,
  } as unknown as Slot;

  function mountSlot() {
    const onClose = vi.fn();
    const onEditTask = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MobileEventSheet
          tap={{ kind: "slot", slot, title: "Deep work", start, end, childCount: 0, doneCount: 0 }}
          mutations={{} as never}
          onClose={onClose}
          onEditTask={onEditTask}
        />
      </QueryClientProvider>,
    );
    return { onClose };
  }

  it("a move chip saves the rename too", () => {
    const { onClose } = mountSlot();
    type("Block title", "Writing");
    fireEvent.click(screen.getByText("Tomorrow"));
    expect(calls.updateSlot).toHaveBeenCalledWith({ id: "s1", patch: { title: "Writing" } });
    expect(onClose).toHaveBeenCalled();
  });

  it("Duplicate copies the block under its new name", () => {
    mountSlot();
    type("Block title", "Writing");
    fireEvent.click(screen.getByText("Duplicate"));
    expect(calls.updateSlot).toHaveBeenCalledWith({ id: "s1", patch: { title: "Writing" } });
    expect(calls.createSlot).toHaveBeenCalledWith(expect.objectContaining({ title: "Writing" }));
  });
});

void React;
