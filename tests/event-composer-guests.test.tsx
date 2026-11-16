// @vitest-environment jsdom
/**
 * A guest typed into the event composer and not entered was dropped: tapping
 * "Add event" never blurs the field on iOS (a button takes no focus), and the
 * submit read the guest list a render behind the one the blur just committed.
 * Now the submit blurs the field first and reads the list as it stands — so
 * the address becomes a guest, and the invite question is asked.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const createEvent = vi.fn(async () => undefined);
vi.mock("../src/hooks/useCalendar", () => ({
  useCalendarAccounts: () => ({ data: [] }),
  useExternalEventMutations: () => ({ createEvent }),
}));
vi.mock("../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: null }) }));
vi.mock("../src/components/calendar/EventCalendarPicker", () => ({
  useEventCalendar: () => ({
    groups: [],
    target: { accountId: "acct", calendarId: "me@example.com" },
    defaultTarget: { accountId: "acct", calendarId: "me@example.com" },
    provider: "google",
    choosable: false,
    pick: vi.fn(),
  }),
  EventCalendarPicker: () => null,
}));
vi.mock("../src/lib/supabase", () => ({
  supabase: { rpc: async () => ({ data: [] }) },
}));

const { default: EventComposer } = await import("../src/components/mobile/EventComposer");

describe("a guest typed and not entered", () => {
  it("is added when Add event is tapped — and the invite question is asked", async () => {
    const onDone = vi.fn();
    render(
      <EventComposer
        title="Design review"
        seed={{ start_at: new Date(2026, 10, 18, 10).toISOString(), end_at: new Date(2026, 10, 18, 11).toISOString(), allDay: false }}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByText("Repeat, guests, calendar…"));
    const guests = screen.getByPlaceholderText(/Add guests|Name or email|guest/i);
    act(() => guests.focus());
    fireEvent.change(guests, { target: { value: "sam@example.com" } });
    // The tap: focus stays in the field, as it does on iOS.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add event" })));
    // Not created silently without the guest — asked first, with the guest in hand.
    expect(createEvent).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send invites" })));
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ attendees: ["sam@example.com"] }));
  });
});

void React;
