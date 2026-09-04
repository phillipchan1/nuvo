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
import { parseDateISO } from "../src/lib/dates";
import type { NewTaskInput } from "../src/hooks/useTasks";

const WRITABLE = [
  { id: "a1", provider: "google", email: "you@example.com", sync_direction: "two_way" },
];

function mount(
  accounts: unknown[] = WRITABLE,
  seed?: { start: Date; durationMinutes?: number },
) {
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
        initialStart={seed?.start ?? null}
        initialDurationMinutes={seed?.durationMinutes ?? null}
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
      // Timed capture — the button names the act (a block), not the kind.
      screen.getByRole("button", { name: "Add block" }).click();
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

  it("keeps a canvas tap's time when the sentence is silent", async () => {
    const start = startOfDay(new Date());
    start.setHours(14, 30, 0, 0);
    const { created, type } = mount(WRITABLE, { start, durationMinutes: 30 });

    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("14:30");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("15:00");
    type("review PR");
    await act(async () => {
      screen.getByRole("button", { name: "Add block" }).click();
    });

    expect(created).toHaveLength(1);
    expect(created[0].title).toBe("review PR");
    expect(created[0].start_time).toBe(start.toISOString());
    expect(created[0].duration_minutes).toBe(30);
    expect(created[0].do_date).toBe(format(start, "yyyy-MM-dd"));
  });

  it("lets Anytime drop the clock so the thought can stay undated on the day", async () => {
    const start = startOfDay(new Date());
    start.setHours(9, 0, 0, 0);
    const { created, type } = mount(WRITABLE, { start, durationMinutes: 30 });

    act(() => screen.getByRole("button", { name: "Anytime" }).click());
    type("buy milk");
    await act(async () => {
      screen.getByRole("button", { name: "Add task" }).click();
    });

    expect(created[0].start_time).toBeNull();
    expect(created[0].do_date).toBe(format(start, "yyyy-MM-dd"));
  });

  it("seeds the event face from the same tap", () => {
    const start = startOfDay(new Date());
    start.setHours(12, 0, 0, 0);
    mount(WRITABLE, { start, durationMinutes: 60 });
    act(() => screen.getByRole("button", { name: "Event" }).click());

    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("12:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("13:00");
  });

  it("lets Add time turn a capture into a time block without typing a clock", async () => {
    const { created, type } = mount();
    // Inbox by default — Add time still works, and stamps Today.
    expect(screen.getByRole("button", { name: "Add time" })).toBeTruthy();
    act(() => screen.getByRole("button", { name: "Add time" }).click());

    const start = screen.getByLabelText("Start time") as HTMLInputElement;
    const end = screen.getByLabelText("End time") as HTMLInputElement;
    expect(start.value).toMatch(/^\d{2}:\d{2}$/);
    expect(end.value).toMatch(/^\d{2}:\d{2}$/);

    act(() => fireEvent.change(start, { target: { value: "10:00" } }));
    act(() => fireEvent.change(end, { target: { value: "11:00" } }));
    type("deep work");
    await act(async () => {
      screen.getByRole("button", { name: "Add block" }).click();
    });

    expect(created).toHaveLength(1);
    expect(created[0].title).toBe("deep work");
    expect(created[0].do_date).toBe(format(startOfDay(new Date()), "yyyy-MM-dd"));
    expect(created[0].duration_minutes).toBe(60);
    const at = new Date(created[0].start_time!);
    expect(at.getHours()).toBe(10);
    expect(at.getMinutes()).toBe(0);
  });

  it("offers Pick date for a day the chips don't name", () => {
    mount();
    act(() => screen.getByRole("button", { name: "Pick date…" }).click());
    const date = screen.getByLabelText("Date") as HTMLInputElement;
    // 10 days out is deliberate, not arbitrary: nextWeekISO() (next Monday) can
    // land anywhere from today+1 to today+7 depending on which weekday the
    // suite runs on, and dayChips dedupes a pick that lands on an existing
    // chip's date rather than doubling it up (correct behavior — see
    // MobileCapture's dayChips loop). +3 collided with "Next week" every time
    // this ran on a Friday. +10 is past that whole window on any weekday.
    const next = format(addDays(startOfDay(new Date()), 10), "yyyy-MM-dd");
    act(() => fireEvent.change(date, { target: { value: next } }));
    expect(screen.getByRole("button", { name: format(parseDateISO(next), "EEE MMM d") })).toBeTruthy();
  });
});
