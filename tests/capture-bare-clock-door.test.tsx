// @vitest-environment jsdom
/**
 * A bare clock ("dentist 3pm") names no day. The capture door opened on a day
 * (the Calendar day you stood on) still treated the parser's guess — today, or
 * tomorrow once 3pm had passed — as the day for its slot face, its event face
 * and its preview, while the task path (`draftFromCapture`) already used the
 * door's day. All three faces now agree.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { addDays, format, startOfDay } from "date-fns";
import { beforeAll, describe, expect, it, vi } from "vitest";
import CaptureDoor from "../src/components/capture/CaptureDoor";
import { TaskCaptureSinkContext, type TaskCaptureSink } from "../src/hooks/useTaskCapture";
import type { NewTaskInput } from "../src/hooks/useTasks";
import type { SlotDraftInput } from "../src/lib/captureDraft";
import { nlpReady } from "../src/lib/nlp";

beforeAll(async () => {
  await nlpReady;
});

const HOST_DAY = format(addDays(startOfDay(new Date()), 5), "yyyy-MM-dd");

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["calendar_accounts"], [
    { id: "a1", provider: "google", email: "you@example.com", sync_direction: "two_way" },
  ]);
  const tasks: NewTaskInput[] = [];
  const slots: SlotDraftInput[] = [];
  const sink: TaskCaptureSink = {
    create: async (input) => {
      tasks.push(input);
    },
    createSeries: async () => {},
    createSlot: (input) => {
      slots.push(input);
    },
    createSlotSeries: async () => {},
  };
  render(
    <QueryClientProvider client={qc}>
      <TaskCaptureSinkContext.Provider value={sink}>
        <CaptureDoor variant="panel" autoFocus defaultDoDate={HOST_DAY} onClose={vi.fn()} onAdded={() => {}} />
      </TaskCaptureSinkContext.Provider>
    </QueryClientProvider>,
  );
  const field = screen.getByLabelText("Capture a task, event or slot") as HTMLInputElement;
  const type = (s: string) => act(() => fireEvent.change(field, { target: { value: s } }));
  const key = async (k: string, init: Partial<KeyboardEventInit> = {}) =>
    act(async () => {
      fireEvent.keyDown(field, { key: k, ...init });
    });
  return { type, key, tasks, slots };
}

describe("a bare clock lands on the door's day", () => {
  it("as a task", async () => {
    const { type, key, tasks } = mount();
    type("dentist 3pm");
    await key("Enter");
    expect(tasks[0].do_date).toBe(HOST_DAY);
    expect(format(new Date(tasks[0].start_time!), "yyyy-MM-dd HH:mm")).toBe(`${HOST_DAY} 15:00`);
  });

  it("as a slot", async () => {
    const { type, key, slots } = mount();
    type("deep work 3pm");
    await key("3", { metaKey: true });
    await key("Enter");
    expect(slots[0].do_date).toBe(HOST_DAY);
    expect(format(new Date(slots[0].start_time), "yyyy-MM-dd HH:mm")).toBe(`${HOST_DAY} 15:00`);
  });

  it("as an event", async () => {
    const { type, key } = mount();
    type("dentist 3pm");
    await key("2", { metaKey: true });
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(HOST_DAY);
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("15:00");
  });

  it("a named day still wins over the door's", async () => {
    const { type, key, slots } = mount();
    type("deep work tomorrow 3pm");
    await key("3", { metaKey: true });
    await key("Enter");
    expect(slots[0].do_date).toBe(format(addDays(startOfDay(new Date()), 1), "yyyy-MM-dd"));
  });
});
