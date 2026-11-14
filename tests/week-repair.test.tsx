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

import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { beforeEach, vi } from "vitest";
import RepairRail from "../src/components/plan/RepairRail";

vi.mock("../src/hooks/useWeekCrown", () => ({
  SIGNIFICANCE_FLOOR_MINS: 120,
  useWeekCrown: () => ({
    weekISO: "2026-11-09",
    weekLabel: "Nov 9 – 15",
    rows: [{ rock: { id: "r1" }, projectId: "p", title: "Pricing", color: "#2563EB", state: "in-motion", loose: [], placed: [], open: 1 }],
    landed: 0,
    total: 1,
    looseCount: 0,
    composed: true,
    significance: null,
  }),
}));
import RepairLine from "../src/components/plan/RepairLine";
import { useRepairs, type RepairActs } from "../src/components/plan/repairActs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// useRepairs reads the settings row (D-207: "Leave it" per account). The row is
// seeded, never fetched; `repairs_left` absent = migration 95 hasn't run.
let qc = new QueryClient();
const seedSettings = (row: Record<string, unknown> = {}) => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["settings"], { user_id: "u", work_start_minutes: 480, work_end_minutes: 990, ...row });
};
import type { Repair } from "../src/hooks/useWeekRepair";

const memStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
};

/** The Planner's wiring, in miniature: one useRepairs, the line at rest, the rail on a press. */
function Host(props: Parameters<typeof HostInner>[0]) {
  return (
    <QueryClientProvider client={qc}>
      <HostInner {...props} />
    </QueryClientProvider>
  );
}

function HostInner({
  repairs,
  acts,
  onOverlay = () => {},
  onClose,
}: {
  repairs: Repair[];
  acts: RepairActs;
  onOverlay?: (o: unknown) => void;
  onClose?: () => void;
}) {
  const state = useRepairs(repairs, acts);
  const [mode, setMode] = useState(false);
  if (!mode)
    return (
      <div data-rest-rail="">
        <RepairLine
          state={state}
          onOpen={() => {
            if (state.dial === "ask") state.setAsked(true);
            setMode(true);
          }}
        />
      </div>
    );
  return (
    <RepairRail
      state={state}
      onOverlay={onOverlay as never}
      onClose={() => {
        onClose?.();
        setMode(false);
      }}
    />
  );
}
// Pricing, Wed 2–3:30pm; a call lands on it at 2pm
const broken = () => run([task("Pricing", iso(11, 14), 90)], [meeting("Call with Dana", iso(11, 14), iso(11, 15))]);

describe("repair — a rail mode, not a floating bar (D-204)", () => {
  beforeEach(() => seedSettings());
  it("rests as one --warn line in the rail; nothing opens repair by itself", () => {
    vi.stubGlobal("localStorage", memStore());
    const apply = vi.fn(() => () => {});
    const { container } = render(<Host repairs={broken()} acts={{ apply }} />);
    expect(screen.getByText("Wed 2pm broke: a meeting landed")).toBeTruthy();
    const line = container.querySelector("[data-repair-line]") as HTMLElement;
    // the fact is --warn (never --signal) — the crown line's warn grammar
    expect(line.querySelector("[data-warn]")?.textContent).toBe("Wed 2pm broke: a meeting landed");
    expect(container.querySelector("[data-repair-rail]")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("the press takes the rail over: the block, its target ghosted, acts that name the destination", () => {
    vi.stubGlobal("localStorage", memStore());
    const undo = vi.fn();
    const apply = vi.fn(() => undo);
    const onOverlay = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<Host repairs={broken()} acts={{ apply }} onOverlay={onOverlay} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^Repair/ }));
    // in the rail, not floating over the Schedule
    expect(container.querySelector("[data-repair-rail]")).toBeTruthy();
    // the crown stays pinned while you repair (rail-modes §2): the slate's pips
    expect(container.querySelector('[data-repair-rail] [data-pinned-crown] [data-crown-project="p"]')).toBeTruthy();
    expect(container.querySelector(".f-dock")).toBeNull();
    expect(screen.getByText("Pricing")).toBeTruthy();
    expect(onOverlay.mock.calls.at(-1)?.[0]?.ghosts).toHaveLength(1);
    // the old words are gone; the acts say where it goes
    expect(screen.queryByLabelText("Take it")).toBeNull();
    expect(screen.queryByLabelText("Leave it")).toBeNull();
    expect(screen.getByRole("button", { name: /^Move to \w{3} \d/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Leave it where it is/ })).toBeTruthy();
    // the dial isn't here — it's in Settings → Schedule
    expect(screen.queryByRole("radiogroup", { name: "How much Nuvo moves" })).toBeNull();
    // ↵ moves it; deciding the last one hands the rail back
    act(() => void fireEvent.keyDown(window, { key: "Enter" }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-repair-rail]")).toBeNull();
  });

  it("Esc hands the rail back without moving anything", () => {
    vi.stubGlobal("localStorage", memStore());
    const apply = vi.fn(() => () => {});
    const { container } = render(<Host repairs={broken()} acts={{ apply }} />);
    fireEvent.click(screen.getByRole("button", { name: /^Repair/ }));
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(container.querySelector("[data-repair-rail]")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText("Wed 2pm broke: a meeting landed")).toBeTruthy();
  });

  it("under Ask, nothing stages until the press — the press is the ask", () => {
    vi.stubGlobal("localStorage", memStore());
    localStorage.setItem("nuvo.planDial.v1", "ask");
    const apply = vi.fn(() => () => {});
    render(<Host repairs={broken()} acts={{ apply }} />);
    expect(screen.queryByRole("button", { name: /^Move to/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Repair/ }));
    expect(screen.getByRole("button", { name: /^Move to/ })).toBeTruthy();
  });

  it("the Planner mounts the rail mode, never the floating bar", () => {
    const src = readFileSync("src/components/Planner.tsx", "utf8");
    expect(src).not.toMatch(/RepairBar/);
    expect(src).toMatch(/<RepairRail/);
    expect(src).toMatch(/repairing \? repairOverlay : null/);
  });
});
