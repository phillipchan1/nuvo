// @vitest-environment jsdom
/**
 * Capture is ONE door, and both kinds come out of the same sentence.
 *
 * The phone used to have two ＋s — the floating one made a task, a second in
 * the Calendar's header made an event — so you had to classify a thought before
 * you were allowed to type it, and the event half was a form with no parser at
 * all (P5's "a new object can only be created through a form"). These assert
 * the shape of the fix: one input, parsed once, feeding either branch (D-125).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { addDays, format, startOfDay } from "date-fns";
import { describe, expect, it, vi } from "vitest";
import MobileCapture from "../src/components/mobile/MobileCapture";
import type { NewTaskInput } from "../src/hooks/useTasks";

const WRITABLE = [
  { id: "a1", provider: "google", email: "you@example.com", sync_direction: "two_way" },
];

function mount(accounts: unknown[] = WRITABLE) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["calendar_accounts"], accounts);
  const created: NewTaskInput[] = [];
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={qc}>
      <MobileCapture
        labels={[]}
        onCreate={async (input) => {
          created.push(input);
        }}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  const field = screen.getByLabelText("Capture a task or event") as HTMLInputElement;
  const type = (s: string) => act(() => fireEvent.change(field, { target: { value: s } }));
  return { view, created, onClose, field, type };
}

describe("one input, two kinds", () => {
  it("opens on Task and parses the sentence into one", async () => {
    const { created, type } = mount();
    type("call David tomorrow 9am 30m !high");
    await act(async () => {
      screen.getByRole("button", { name: "Add task" }).click();
    });

    expect(created).toHaveLength(1);
    const t = created[0];
    expect(t.title).toBe("call David");
    expect(t.do_date).toBe(format(addDays(startOfDay(new Date()), 1), "yyyy-MM-dd"));
    expect(t.duration_minutes).toBe(30);
    expect(t.priority).toBe("high");
    // A time in the text IS the block, because a scheduled task is a time block
    // (P1) — the event branch is about who else can see it, not about clocks.
    expect(t.start_time).toBeTruthy();
  });

  it("keeps the sentence when you switch kind, and seeds the event from it", () => {
    const { field, type } = mount();
    type("lunch with sam tomorrow 12pm 1h");
    act(() => screen.getByRole("button", { name: "Event" }).click());

    // The words survive the switch — the whole point of one input.
    expect(field.value).toBe("lunch with sam tomorrow 12pm 1h");
    // …and the times the sentence gave are already filled in, not re-asked.
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("12:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("13:00");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(
      format(addDays(startOfDay(new Date()), 1), "yyyy-MM-dd"),
    );
    // The event's title is the sentence with the parsed tokens taken out.
    expect(screen.getByRole("button", { name: "Add event" })).toBeTruthy();
  });

  it("folds an event's rarer fields away rather than asking for them", () => {
    const { type } = mount();
    type("board meeting friday 9am");
    act(() => screen.getByRole("button", { name: "Event" }).click());

    // Repeat / guests / Meet / which calendar are real, and none of them is
    // between the thought and the button.
    expect(screen.queryByLabelText("Add guests")).toBeNull();
    const more = screen.getByRole("button", { name: /Repeat, guests, calendar/ });
    act(() => more.click());
    expect(screen.getByRole("button", { name: /Fewer options/ })).toBeTruthy();
  });

  it("says why Event is unavailable instead of offering a dead control", () => {
    mount([]);
    const event = screen.getByRole("button", { name: "Event" }) as HTMLButtonElement;
    expect(event.disabled).toBe(true);
    expect(screen.getByText(/Connect a calendar in Settings/)).toBeTruthy();
  });
});
