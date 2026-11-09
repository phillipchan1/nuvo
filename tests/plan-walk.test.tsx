// @vitest-environment jsdom
/**
 * Plan the week walks its draft ONE block at a time (docs/plan-the-week-v2.md §4,
 * the walk). Reported from a real week: a whole draft laid over a full calendar
 * was unreadable — "Admin batch" said nothing about what it held, and you could
 * not see which blocks were new. So: the plan opens on the first block, the rail
 * lists what's inside it, ↵ accepts it (held from then on) and moves to the next,
 * the overlay fades what the calendar already has, and the blocks not under
 * review are drawn quieter.
 */
import { act, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanOverlay } from "../src/components/plan/planOverlay";

vi.mock("../src/lib/calendarReveal", () => ({ revealOnCalendar: vi.fn() }));
vi.mock("../src/hooks/useAppNavigation", () => ({ useAppNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const DAY = "2026-11-10";
const t = (id: string, title: string, mins = 30) => ({ id, title, duration_minutes: mins });
const TASKS = [t("a1", "Fill in Timesheet", 15), t("a2", "Renew car registration"), t("r1", "Reply to Grace", 15), t("r2", "Follow up with Theo")];
const SLOTS = [
  { id: "admin", name: "Admin batch", taskIds: ["a1", "a2"], projectId: null, color: null, durationMins: 45 },
  { id: "replies", name: "Replies", taskIds: ["r1", "r2"], projectId: null, color: null, durationMins: 45 },
];
const PLACEMENTS = [
  { task: { id: "replies", title: "Replies" }, dayISO: DAY, startMin: 14 * 60, durationMin: 45, reason: "afternoon run" },
  { task: { id: "admin", title: "Admin batch" }, dayISO: DAY, startMin: 9 * 60, durationMin: 45, reason: "first open hour" },
];

vi.mock("../src/hooks/useWeekDraft", () => ({
  placementKey: (p: { task: { id: string } }) => p.task.id,
  useWeekDraft: () => {
    const [held, setHeld] = useState<Set<string>>(new Set());
    return {
      data: { tasks: [], projects: [], domains: [], initiatives: [] },
      placements: PLACEMENTS,
      slotById: new Map(SLOTS.map((s) => [s.id, s])),
      taskById: new Map(TASKS.map((x) => [x.id, x])),
      fromGate: DAY,
      alternativesFor: () => [],
      isHeld: (k: string) => held.has(k),
      holdPlacement: (k: string) => setHeld((h) => new Set([...h, k])),
      unpinPlacement: (k: string) => setHeld((h) => new Set([...h].filter((x) => x !== k))),
      remember: () => {},
      undo: () => false,
      moveLocally: () => {},
      loosePool: [],
      kept: new Set(),
      setKept: () => {},
      result: { unplaced: [], placements: PLACEMENTS, days: [{ freeMins: 600 }] },
      suggestions: [],
      clearRegions: [],
      planDays: [DAY],
      workingDays: [1, 2, 3, 4, 5],
      dayContexts: {},
      applying: false,
    };
  },
}));

const { default: PlanRail } = await import("../src/components/plan/PlanRail");

describe("Plan the week — the walk", () => {
  it("opens on the earliest block, lists what's inside, and ↵ accepts and moves on", () => {
    let overlay: PlanOverlay | null = null;
    render(<PlanRail onOverlay={(o) => (overlay = o)} onClose={() => {}} />);

    // earliest in time first — Admin at 9am, not Replies at 2pm
    expect(screen.getByText("Block 1 of 2")).toBeTruthy();
    expect(screen.getByText("Fill in Timesheet")).toBeTruthy();
    expect(screen.getByText("Renew car registration")).toBeTruthy();

    // the calendar fades what's fixed; the block under review is full strength
    expect(overlay!.dimCalendar).toBe(true);
    const admin = overlay!.blocks.find((b) => b.key === "admin")!;
    const replies = overlay!.blocks.find((b) => b.key === "replies")!;
    expect(admin.selected && !admin.quiet).toBe(true);
    expect(replies.quiet).toBe(true);
    expect(admin.items).toEqual(["Fill in Timesheet", "Renew car registration"]);

    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(screen.getByText("1/2 accepted")).toBeTruthy();
    expect(screen.getByText("Block 2 of 2")).toBeTruthy();
    expect(screen.getByText("Reply to Grace")).toBeTruthy();

    fireEvent.click(screen.getByText(/Looks good/));
    expect(screen.getByText("2/2 accepted")).toBeTruthy();
    expect(screen.getByText(/All 2 blocks accepted/)).toBeTruthy();
  });

  it("Later moves on without accepting", () => {
    render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Later/));
    expect(screen.getByText("Block 2 of 2")).toBeTruthy();
    expect(screen.getByText("0/2 accepted")).toBeTruthy();
  });
});
