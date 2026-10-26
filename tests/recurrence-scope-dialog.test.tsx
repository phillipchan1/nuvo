// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RecurrenceScopeDialog, type RecurrenceScopeMode } from "../src/components/RecurrencePicker";

const labels = (mode: RecurrenceScopeMode) => {
  const { unmount } = render(<RecurrenceScopeDialog mode={mode} onConfirm={() => {}} onCancel={() => {}} />);
  const out = ["Just this event", "This and following events", "All events in series"].filter((l) => screen.queryByText(l));
  unmount();
  return out;
};

describe("the series scope question", () => {
  it("offers this · this and following · all for edits, moves and deletes", () => {
    for (const mode of ["edit", "move", "delete"] as const) {
      expect(labels(mode)).toEqual(["Just this event", "This and following events", "All events in series"]);
    }
  });

  it("never splits a series to answer an invite", () => {
    expect(labels("answer")).toEqual(["Just this event", "All events in series"]);
  });

  it("a repeat change asks from-here or whole-series, defaulting to from here", () => {
    const onConfirm = vi.fn();
    render(<RecurrenceScopeDialog mode="rule" onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.queryByText("Just this event")).toBeNull();
    fireEvent.click(screen.getByText("Done"));
    expect(onConfirm).toHaveBeenCalledWith("FOLLOWING");
  });
});
