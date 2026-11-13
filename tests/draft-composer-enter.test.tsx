// @vitest-environment jsdom
/**
 * Enter on the Schedule's create card. Plain Enter only created while focus
 * was still in the name — choosing Repeat moved it, and Enter did nothing.
 * Enter inside the custom repeat builder applied nothing either.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DraftComposer from "../src/components/DraftComposer";

vi.mock("../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: undefined }),
}));
vi.mock("../src/hooks/useCalendar", () => ({
  useCalendarAccounts: () => ({ data: [] }),
}));

const start = new Date(2026, 9, 14, 9, 0, 0);
const end = new Date(2026, 9, 14, 10, 0, 0);

function renderSlot() {
  const onCreate = vi.fn();
  render(
    <DraftComposer
      start={start}
      end={end}
      point={{ x: 240, y: 180 }}
      initialKind="slot"
      googleAvailable={false}
      onCreate={onCreate}
      onCancel={() => {}}
    />,
  );
  return onCreate;
}

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("Enter on a repeating slot", () => {
  it("creates after Repeat has moved focus off the name", () => {
    const onCreate = renderSlot();
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    fireEvent.click(screen.getByText("Every day"));
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "slot",
        recurrence: { freq: "daily", interval: 1 },
      }),
    );
  });

  it("Enter in Custom applies the rule and does not create yet", () => {
    const onCreate = renderSlot();
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    const pop = document.querySelector("[data-repeat-picker]");
    if (!pop) throw new Error("repeat popover did not open");
    fireEvent.click(within(pop as HTMLElement).getByText("Custom…"));
    fireEvent.keyDown(within(pop as HTMLElement).getByRole("spinbutton"), { key: "Enter" });
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Weekly on Wed/).length).toBeGreaterThan(0);
    expect(document.querySelector("[data-repeat-picker]")).toBeNull();

    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "slot",
        recurrence: expect.objectContaining({ freq: "weekly", interval: 1, byweekday: [3] }),
      }),
    );
  });
});
