// @vitest-environment jsdom
// The Schedule's rail is ONE ref held in turn by LeftRail and PlanRail. The
// calendar binds FullCalendar's rail Draggable to that element, so it has to
// learn when the element is replaced — otherwise closing Plan the week left the
// Draggable on the detached PlanRail and Today/Inbox rows stopped dragging onto
// the calendar until a reload.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { act } from "react";
import { useTrackedRef } from "../src/hooks/useTrackedRef";
import { readFileSync } from "node:fs";

describe("useTrackedRef — the rail drag source follows the rail", () => {
  it("re-runs an effect keyed on the element each time the holder is swapped", () => {
    const bound: string[] = [];
    let swap: () => void = () => {};
    function Host() {
      const [ref, el] = useTrackedRef<HTMLDivElement>();
      const [planning, setPlanning] = useState(false);
      swap = () => setPlanning((p) => !p);
      useEffect(() => {
        if (ref.current) bound.push(ref.current.dataset.which ?? "?");
      }, [ref, el]);
      return planning ? <div key="plan" ref={ref} data-which="plan" /> : <div key="rail" ref={ref} data-which="rail" />;
    }
    render(<Host />);
    act(() => swap()); // Plan the week opens
    act(() => swap()); // …and closes
    // (The mount binds once more when the element first lands in state — a
    // destroy-and-recreate, harmless.) What matters: it follows each swap.
    const changes = bound.filter((w, i) => w !== bound[i - 1]);
    expect(changes).toEqual(["rail", "plan", "rail"]);
  });

  it("CalendarPane re-binds its rail Draggable on railEl, and Planner passes it", () => {
    const pane = readFileSync("src/components/CalendarPane.tsx", "utf8");
    expect(pane).toMatch(/new Draggable\(railRef\.current[\s\S]*?\}, \[railRef, view, railEl\]\);/);
    const planner = readFileSync("src/components/Planner.tsx", "utf8");
    expect(planner).toMatch(/useTrackedRef<HTMLDivElement>\(\)/);
    expect(planner).toMatch(/railEl=\{railEl\}/);
  });
});
