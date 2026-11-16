// @vitest-environment jsdom
/**
 * The desktop event and task cards dropped edits:
 *
 *  - Escape in a field closed the card at once, and title / place / notes save
 *    only on blur — a closing card never blurs them (React stops dispatching as
 *    it unmounts; WebKit fires no blur on a removed field). Escape now commits
 *    first, as a click outside always did.
 *  - Escape in the time list closed the WHOLE card: a picker owns Escape first.
 *  - A background change to ONE field (a sync, the provider's echo) reset every
 *    field's local state — the title you were typing snapped back.
 *  - The task title's Enter committed mid-IME-composition.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalEvent } from "../src/lib/types";

const details: { data: unknown; isLoading: boolean; isSuccess: boolean } = {
  data: null,
  isLoading: false,
  isSuccess: true,
};
vi.mock("../src/hooks/useCalendar", () => ({
  useEventDetails: () => details,
  useEventSeriesRule: () => ({ data: null }),
  useHiddenEvents: () => ({ isHidden: () => false, hiddenKeyFor: () => null, hide: vi.fn(), unhide: vi.fn() }),
}));
vi.mock("../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: null }), firstDayOfWeek: () => 0 }));
vi.mock("../src/components/ReminderSelect", () => ({ default: () => null }));
vi.mock("../src/components/domain/EventDomainControl", () => ({ default: () => null }));
vi.mock("../src/hooks/useVertical", () => ({
  useVertical: () => ({ data: { domains: [], projects: [], initiatives: [], sprint: null } }),
}));
vi.mock("../src/components/tasks/TaskActionsMenu", () => ({ useWeekCommitAct: () => vi.fn() }));
vi.mock("../src/components/calendar/EventCalendarPicker", () => ({
  useCreateTargets: () => ({ groups: [], defaultTarget: null, choosable: false }),
  CalendarTargetList: () => null,
}));
vi.mock("../src/components/TaskNotes", () => ({ default: () => null }));
vi.mock("../src/components/TaskSteps", () => ({ default: () => null }));

const { EventPopover, TaskPopover } = await import("../src/components/SlideOver");

const row: ExternalEvent = {
  id: "ev1",
  account_id: "acct",
  provider_event_id: "g-ev1",
  calendar_id: "me@example.com",
  title: "Planning",
  start_at: new Date(2026, 10, 18, 10, 0).toISOString(),
  end_at: new Date(2026, 10, 18, 11, 0).toISOString(),
  all_day: false,
  location: null,
  busy: true,
  self_rsvp: null,
} as ExternalEvent;

const updateEvent = vi.fn();
const accounts = [
  {
    id: "acct",
    provider: "google",
    email: "me@example.com",
    sync_direction: "two_way",
    calendars: [{ id: "me@example.com", summary: "Me", primary: true }],
  },
] as never;

function mount(event: ExternalEvent = row) {
  const onClose = vi.fn();
  const qc = new QueryClient();
  const ui = (ev: ExternalEvent) => (
    <QueryClientProvider client={qc}>
      <EventPopover
        event={ev}
        anchor={new DOMRect(200, 200, 100, 40)}
        editable
        calendarId="me@example.com"
        accounts={accounts}
        eventMutations={{ updateEvent } as never}
        onClose={onClose}
      />
    </QueryClientProvider>
  );
  const view = render(ui(event));
  return { onClose, rerender: (ev: ExternalEvent) => view.rerender(ui(ev)) };
}

// jsdom has no layout: the time list scrolls its highlighted row into view.
Element.prototype.scrollIntoView ??= function () {};

beforeEach(() => {
  updateEvent.mockClear();
  details.data = null;
  details.isLoading = false;
  details.isSuccess = true;
});

describe("Escape commits the field before the card goes", () => {
  it("a title typed and Escaped is saved", () => {
    const { onClose } = mount();
    const title = screen.getByLabelText("Event title");
    act(() => title.focus());
    fireEvent.change(title, { target: { value: "Quarterly planning" } });
    fireEvent.keyDown(title, { key: "Escape" });
    expect(updateEvent).toHaveBeenCalledWith({ id: "ev1", patch: { title: "Quarterly planning" }, scope: "THIS" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a place typed and Escaped is saved", () => {
    mount();
    const where = screen.getByLabelText("Location");
    act(() => where.focus());
    fireEvent.change(where, { target: { value: "Room 4" } });
    fireEvent.keyDown(where, { key: "Escape" });
    expect(updateEvent).toHaveBeenCalledWith({ id: "ev1", patch: { location: "Room 4" }, scope: "THIS" });
  });

  it("Escape in the time list closes the list, not the card", () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Start time" }));
    const search = screen.getByLabelText("Start time search");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByLabelText("Start time search")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a background change to one field leaves the others alone", () => {
  it("the place changing elsewhere doesn't wipe the title being typed", () => {
    const { rerender } = mount();
    const title = screen.getByLabelText("Event title") as HTMLInputElement;
    act(() => title.focus());
    fireEvent.change(title, { target: { value: "Half-typed" } });
    rerender({ ...row, location: "Synced room" });
    expect(title.value).toBe("Half-typed");
    expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("Synced room");
  });

  it("a field you're not in still follows the row", () => {
    const { rerender } = mount();
    rerender({ ...row, title: "Renamed elsewhere" });
    expect((screen.getByLabelText("Event title") as HTMLInputElement).value).toBe("Renamed elsewhere");
  });

  it("a new event resets every field", () => {
    const { rerender } = mount();
    const title = screen.getByLabelText("Event title") as HTMLInputElement;
    act(() => title.focus());
    fireEvent.change(title, { target: { value: "Half-typed" } });
    rerender({ ...row, id: "ev2", title: "Another" });
    expect(title.value).toBe("Another");
  });
});

describe("notes wait for the description", () => {
  it("no notes field when the details failed to load", () => {
    details.data = undefined;
    details.isSuccess = false;
    mount();
    expect(screen.queryByLabelText("Notes")).toBeNull();
  });
});

describe("the task card", () => {
  const task = {
    id: "t1",
    title: "Old title",
    notes: "",
    status: "todo",
    priority: "none",
    do_date: "2026-11-18",
    start_time: null,
    duration_minutes: 30,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    slot_id: null,
    sprint_id: null,
    recurrence_id: null,
    deadline: null,
    roll_count: 0,
    created_at: "2026-11-01T17:00:00.000Z",
    completed_at: null,
    task_labels: [],
  } as never;

  function mountTask() {
    const patchTask = vi.fn();
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TaskPopover
          task={task}
          anchor={new DOMRect(200, 200, 100, 40)}
          labels={[]}
          mutations={{ patchTask } as never}
          recurrence={null}
          recurrenceMutations={{} as never}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
    const title = screen.getByLabelText("Task title");
    act(() => title.focus());
    fireEvent.change(title, { target: { value: "New title" } });
    return { patchTask, onClose, title };
  }

  it("Escape in the title saves it before the card closes", () => {
    const { patchTask, onClose, title } = mountTask();
    fireEvent.keyDown(title, { key: "Escape" });
    expect(patchTask).toHaveBeenCalledWith("t1", { title: "New title" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an IME's Enter picks a candidate — it doesn't commit the title", () => {
    const { patchTask, title } = mountTask();
    fireEvent.keyDown(title, { key: "Enter", isComposing: true });
    fireEvent.keyDown(title, { key: "Enter", keyCode: 229 });
    expect(patchTask).not.toHaveBeenCalled();
    fireEvent.keyDown(title, { key: "Enter" });
    expect(patchTask).toHaveBeenCalledWith("t1", { title: "New title" });
  });
});

void React;
