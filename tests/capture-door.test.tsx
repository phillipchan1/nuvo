// @vitest-environment jsdom
/**
 * The capture door as a keyboard sees it — ⌘K and ⌥Space (D-149).
 *
 * What these pin is the list of ways the old palette was unreliable:
 *   · Enter must ADD what you typed — never open a record your words resembled
 *   · "added" is reported only after the write is queued; a failure stays on
 *     screen with your words still in the box (it used to be swallowed after
 *     the window had closed)
 *   · Escape clears the line first, closes second (D-051), and the ⌘K frame
 *     closes exactly once (a second history.back() walked the app backwards)
 *   · the kind switch is on the keys (⌘1–3), and a Slot comes out of the same
 *     sentence
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { addDays, format, startOfDay } from "date-fns";
import { beforeAll, describe, expect, it, vi } from "vitest";
import CaptureDoor, { type CaptureAdded } from "../src/components/capture/CaptureDoor";
import QuickAdd from "../src/components/capture/QuickAdd";
import { TaskCaptureSinkContext, type TaskCaptureSink } from "../src/hooks/useTaskCapture";
import type { NewTaskInput } from "../src/hooks/useTasks";
import type { SlotDraftInput } from "../src/lib/captureDraft";
import { nlpReady } from "../src/lib/nlp";

beforeAll(async () => {
  await nlpReady;
});

const WRITABLE = [{ id: "a1", provider: "google", email: "you@example.com", sync_direction: "two_way" }];

function mount(opts: { sink?: Partial<TaskCaptureSink>; quickAdd?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["calendar_accounts"], WRITABLE);
  const tasks: NewTaskInput[] = [];
  const slots: SlotDraftInput[] = [];
  const added: CaptureAdded[] = [];
  const onClose = vi.fn();
  const sink: TaskCaptureSink = {
    create: async (input) => {
      tasks.push(input);
    },
    createSeries: async () => {},
    createSlot: (input) => {
      slots.push(input);
    },
    createSlotSeries: async () => {},
    ...opts.sink,
  };
  render(
    <QueryClientProvider client={qc}>
      <TaskCaptureSinkContext.Provider value={sink}>
        {opts.quickAdd ? (
          <QuickAdd onClose={onClose} />
        ) : (
          <CaptureDoor variant="panel" autoFocus onClose={onClose} onAdded={(a) => added.push(a)} />
        )}
      </TaskCaptureSinkContext.Provider>
    </QueryClientProvider>,
  );
  const field = screen.getByLabelText("Capture a task, event or slot") as HTMLInputElement;
  const type = (s: string) => act(() => fireEvent.change(field, { target: { value: s } }));
  const key = async (k: string, init: Partial<KeyboardEventInit> = {}) =>
    act(async () => {
      fireEvent.keyDown(field, { key: k, ...init });
    });
  return { field, type, key, tasks, slots, added, onClose };
}

describe("the capture door, by keyboard", () => {
  it("lands in the line, and Enter adds what was typed", async () => {
    const { field, type, key, tasks, added } = mount();
    expect(document.activeElement).toBe(field);
    type("call David tomorrow 9am 30m");
    await key("Enter");

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "call David",
      do_date: format(addDays(startOfDay(new Date()), 1), "yyyy-MM-dd"),
      duration_minutes: 30,
    });
    expect(added).toEqual([{ kind: "task", title: "call David", where: expect.stringMatching(/^Tomorrow · 9–9:30am$/) }]);
  });

  it("an untimed line goes to the Inbox, and says so", async () => {
    const { type, key, tasks, added } = mount();
    type("buy stamps");
    await key("Enter");
    expect(tasks[0]).toMatchObject({ title: "buy stamps", do_date: null, start_time: null });
    expect(added[0].where).toBe("Inbox");
  });

  it("turns off inline predictions, which WebKit draws as composition text", () => {
    // With macOS/iOS inline predictive text on, a showing prediction made every
    // key report isComposing — Enter and Escape went dead in the ⌥Space panel,
    // and the controlled value fighting WebKit's marked text wiped the line.
    const { field } = mount();
    expect(field.getAttribute("writingsuggestions")).toBe("false");
  });

  it("does nothing on an empty line", async () => {
    const { key, tasks, added } = mount();
    await key("Enter");
    expect(tasks).toHaveLength(0);
    expect(added).toHaveLength(0);
  });

  it("keeps the words and shows the failure when the write fails", async () => {
    const { field, type, key, added } = mount({
      sink: {
        create: async () => {
          throw new Error("Storage is full");
        },
      },
    });
    type("renew passport");
    await key("Enter");
    expect(added).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toMatch(/Storage is full/);
    expect(field.value).toBe("renew passport");
  });

  it("⌘3 switches to Slot without losing the sentence, and Enter holds the time", async () => {
    const { field, type, key, slots, tasks, added } = mount();
    type("deep work tomorrow 9am 2h");
    await key("3", { metaKey: true });
    expect(screen.getByRole("button", { name: "Slot" }).getAttribute("aria-pressed")).toBe("true");
    expect(field.value).toBe("deep work tomorrow 9am 2h");

    await key("Enter");
    expect(tasks).toHaveLength(0);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      title: "deep work",
      do_date: format(addDays(startOfDay(new Date()), 1), "yyyy-MM-dd"),
      duration_minutes: 120,
    });
    expect(new Date(slots[0].start_time).getHours()).toBe(9);
    expect(added[0]).toMatchObject({ kind: "slot", where: expect.stringMatching(/^Tomorrow · 9–11am$/) });
  });

  it("a Slot with no clock in the words takes the one on screen", async () => {
    const { type, key, slots } = mount();
    await key("3", { metaKey: true });
    const start = screen.getByLabelText("Start time") as HTMLInputElement;
    act(() => fireEvent.change(start, { target: { value: "15:00" } }));
    type("admin");
    await key("Enter");
    expect(new Date(slots[0].start_time).getHours()).toBe(15);
    expect(slots[0].do_date).toBe(format(startOfDay(new Date()), "yyyy-MM-dd"));
  });

  it("⌘2 reaches the Event face with the sentence's time already in it", async () => {
    const { type, key } = mount();
    type("lunch with sam tomorrow 12pm 1h");
    await key("2", { metaKey: true });
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("12:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("13:00");
    expect(screen.getByRole("button", { name: "Add event" })).toBeTruthy();
  });

  it("Escape clears the line first, and leaves second", async () => {
    const { field, type, key, onClose } = mount();
    type("half a thought");
    await key("Escape");
    expect(field.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    await key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("⌘K", () => {
  it("closes exactly once — an add followed by a stray Escape doesn't walk history back twice", async () => {
    const { type, key, onClose, tasks } = mount({ quickAdd: true });
    type("email the landlord");
    await key("Enter");
    expect(tasks).toHaveLength(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has no search, commands or chat to steal Enter", () => {
    mount({ quickAdd: true });
    expect(screen.queryByText(/Ask Nuvo/)).toBeNull();
    expect(screen.queryByText(/Go to today/)).toBeNull();
  });
});
