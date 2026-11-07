// @vitest-environment jsdom
// The planner staying with the week (docs/plan-the-week-v2.md §7): a block a
// meeting landed on, or one that was missed, gets the composer's smallest repair —
// only that block moves, never onto anything, and a week that's fine says nothing.

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWeekRepair } from "../src/hooks/useWeekRepair";
import type { ExternalEvent, Task } from "../src/lib/types";

// Wednesday 11 Nov 2026, 9:40am local
const NOW = new Date(2026, 10, 11, 9, 40);
const iso = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

const task = (id: string, start: string, mins: number, o: Partial<Task> = {}): Task =>
  ({ id, title: id, start_time: start, duration_minutes: mins, status: "planned", project_id: null, energy: null, deadline: null, initiative_id: null, domain_id: null, slot_id: null, recurrence_id: null, sort_order: 0, ...o }) as unknown as Task;
const meeting = (id: string, start: string, end: string, o: Partial<ExternalEvent> = {}): ExternalEvent =>
  ({ id, title: id, start_at: start, end_at: end, all_day: false, busy: true, calendar_id: "c", account_id: "a", provider_event_id: id, self_rsvp: "accepted", ...o }) as unknown as ExternalEvent;

const run = (tasks: Task[], events: ExternalEvent[]) =>
  renderHook(() =>
    useWeekRepair({
      tasks,
      events,
      slots: [],
      hiddenCalendarIds: [],
      hiddenEventKeys: [],
      workStartMin: 9 * 60,
      workEndMin: 17 * 60 + 30,
      workingDays: [1, 2, 3, 4, 5],
      now: NOW,
      enabled: true,
    }),
  ).result.current;

describe("the week, repaired in place", () => {
  it("says nothing when the week holds", () => {
    expect(run([task("Write", iso(12, 9), 60)], [meeting("Standup", iso(12, 11), iso(12, 11, 30))])).toEqual([]);
  });

  it("re-places a block a meeting landed on, off the meeting and off every other block", () => {
    const blocks = [task("Pricing", iso(11, 14), 90, { project_id: "p" }), task("Other", iso(12, 9), 120)];
    const [r] = run(blocks, [meeting("Call with Dana", iso(11, 14), iso(11, 15))]);
    expect(r.why).toBe("landed");
    expect(r.event).toBe("Call with Dana");
    for (const o of r.options) {
      const s = new Date(`${o.dayISO}T00:00:00`);
      s.setMinutes(o.startMin);
      const e = new Date(s.getTime() + o.durationMin * 60_000);
      // not on the meeting
      expect(s < new Date(iso(11, 15)) && e > new Date(iso(11, 14))).toBe(false);
      // not on the other block (Thu 9–11)
      expect(s < new Date(iso(12, 11)) && e > new Date(iso(12, 9))).toBe(false);
      // never in the past
      expect(s.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    }
  });

  it("re-places a missed block, but never a repeating one or a declined meeting's", () => {
    const rs = run(
      [task("Calls", iso(10, 16), 45), task("Shutdown", iso(10, 17), 15, { recurrence_id: "r" }), task("Deep", iso(12, 10), 60)],
      [meeting("Optional", iso(12, 10), iso(12, 11), { self_rsvp: "declined" })],
    );
    expect(rs.map((r) => `${r.title}:${r.why}`)).toEqual(["Calls:missed"]);
  });

  it("gives two broken blocks two different hours", () => {
    const rs = run(
      [task("A", iso(11, 14), 60), task("B", iso(11, 14), 60)],
      [meeting("All hands", iso(11, 14), iso(11, 15))],
    );
    expect(rs).toHaveLength(2);
    const a = rs[0].options[0];
    const b = rs[1].options[0];
    expect(a.dayISO === b.dayISO && Math.abs(a.startMin - b.startMin) < 60).toBe(false);
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import RepairBar from "../src/components/plan/RepairBar";
import { vi } from "vitest";

const memStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
};

describe("the repair bar", () => {
  it("stages the repair under Suggest and moves it only on ✓", () => {
    vi.stubGlobal("localStorage", memStore());
    const [r] = run([task("Pricing", iso(11, 14), 90)], [meeting("Call with Dana", iso(11, 14), iso(11, 15))]);
    const undo = vi.fn();
    const apply = vi.fn(() => undo);
    const onOverlay = vi.fn();
    render(<RepairBar repairs={[r]} acts={{ apply }} onOverlay={onOverlay} />);
    expect(screen.getByText("Pricing")).toBeTruthy();
    // its target is drawn on the calendar as a ghost
    expect(onOverlay.mock.calls.at(-1)?.[0]?.ghosts).toHaveLength(1);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Take it"));
    expect(apply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Undo"));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("stages nothing under Ask until you re-plan", () => {
    vi.stubGlobal("localStorage", memStore());
    localStorage.setItem("nuvo.planDial.v1", "ask");
    const [r] = run([task("Pricing", iso(11, 14), 90)], [meeting("Call with Dana", iso(11, 14), iso(11, 15))]);
    render(<RepairBar repairs={[r]} acts={{ apply: vi.fn(() => () => {}) }} onOverlay={vi.fn()} />);
    expect(screen.queryByLabelText("Take it")).toBeNull();
    fireEvent.click(screen.getByText("Re-plan the rest of the week"));
    expect(screen.getByLabelText("Take it")).toBeTruthy();
  });
});
