// @vitest-environment jsdom
/**
 * Anytime (all-day) task chips on the Schedule must expose the same check-off
 * as timed blocks. A decorative dot made the row look like work you couldn't
 * finish from here — reported against the week grid's anytime band.
 */
import { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { startOfDay } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPane from "../src/components/CalendarPane";
import { toDateISO } from "../src/lib/dates";
import type { Task } from "../src/lib/types";

class FakeAnimation {
  onfinish: (() => void) | null = null;
  cancel() {}
}
const realAnimate = Element.prototype.animate;
const realRO = globalThis.ResizeObserver;
const realScrollTo = Element.prototype.scrollTo;
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  Element.prototype.animate = (() => new FakeAnimation() as unknown as Animation) as Element["animate"];
  Element.prototype.scrollTo = (() => {}) as Element["scrollTo"];
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia =
    realMatchMedia ??
    ((() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia);
});
afterEach(() => {
  Element.prototype.animate = realAnimate;
  Element.prototype.scrollTo = realScrollTo;
  globalThis.ResizeObserver = realRO;
  window.matchMedia = realMatchMedia;
});

const DAY = startOfDay(new Date());
const ANYTIME = {
  id: "anytime-1",
  title: "Rename Stampede to Drove",
  status: "planned",
  duration_minutes: 30,
  start_time: null,
  do_date: toDateISO(DAY),
  slot_id: null,
  project_id: null,
  domain_id: null,
  recurrence_id: null,
} as Task;

const TIMED = {
  id: "timed-1",
  title: "Draft the note",
  status: "planned",
  duration_minutes: 45,
  start_time: new Date(DAY.getTime() + 9 * 60 * 60_000).toISOString(),
  do_date: toDateISO(DAY),
  slot_id: null,
  project_id: null,
  domain_id: null,
  recurrence_id: null,
} as Task;

const noop = {} as never;

describe("Schedule anytime task chip", () => {
  it("renders a done-toggle on the all-day row, same as a timed block", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <div style={{ width: 960, height: 720 }}>
          <CalendarPane
            view="timeGridDay"
            tasks={[ANYTIME, TIMED]}
            events={[]}
            slots={[]}
            slotTasks={{}}
            accounts={[]}
            settings={undefined}
            now={new Date(DAY.getTime() + 10 * 60 * 60_000)}
            taskAccent={() => "#7c6f9f"}
            taskDomain={() => null}
            slotTitle={() => ""}
            mutations={
              {
                complete: vi.fn(),
                uncomplete: vi.fn(),
              } as never
            }
            eventMutations={noop}
            slotMutations={noop}
            recurrenceMutations={noop}
            onOpenTask={() => {}}
            onOpenEvent={() => {}}
            onOpenSlot={() => {}}
            onRangeChange={() => {}}
            railRef={createRef<HTMLDivElement>()}
          />
        </div>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const allday = container.querySelector(".fc-event.evt-allday.evt-task");
      expect(allday).not.toBeNull();
      expect(allday!.querySelector("[data-done-toggle]")).not.toBeNull();
      expect(allday!.textContent).toContain("Rename Stampede to Drove");
    });

    const timed = container.querySelector(".fc-event.evt-task:not(.evt-allday)");
    expect(timed?.querySelector("[data-done-toggle]")).not.toBeNull();
  });
});
