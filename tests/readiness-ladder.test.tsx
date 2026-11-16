// @vitest-environment jsdom
/**
 * The readiness ladder (D-209, docs/readiness-ladder.md).
 *
 *  · The kernel's rules, which the app's crown AND the agent read:
 *    `dayReadiness` (what closes today), `movingInitiativeIds` (which bets make
 *    work significant), `fitsCapacity` (when a week fits), `quarterStartISO`.
 *  · `readDay` — "Done at 3:04pm, 1h 56m of your day back".
 *  · The deck marks (Ready · Fits · Shipped; Ready · On a week · Moving).
 *  · The kit parts draw nothing celebratory on mount — motion only on a
 *    transition they watched — and every mark label carries its definition.
 *  · The rest deck: Not now sends a card to the back, not away.
 *  · The agent's context carries the same readings.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  dayReadiness,
  fitsCapacity,
  krMovedSince,
  movingInitiativeIds,
  quarterStartISO,
} from "../supabase/functions/_shared/planningRules";
import { MARK_DEFS, initiativeDeckMarks, marksReady, projectDeckMarks, readDay, spanWords } from "../src/lib/marks";
import { DayCrown, MarkSet, Stop } from "../src/components/kit/Readings";
import RestDeck from "../src/components/plan/RestDeck";
import type { ReadyCard } from "../src/lib/readyCards";
import type { Task } from "../src/lib/types";
import { readFileSync } from "node:fs";
import * as celebrate from "../src/lib/celebrate";

vi.mock("../src/lib/celebrate", () => ({
  pop: vi.fn(),
  sweep: vi.fn(),
  ring: vi.fn(),
  burst: vi.fn(),
  dropStop: vi.fn(),
  jolt: vi.fn(),
  closeMark: vi.fn(),
  closeDial: vi.fn(),
  bump: vi.fn(),
  seal: vi.fn(),
}));

// ── the kernel ──────────────────────────────────────────────────────────────

const dt = (o: Partial<Parameters<typeof dayReadiness>[0][number]> & { id: string }) => ({
  status: "planned",
  completedAt: null,
  rollCount: 0,
  recurrenceId: null,
  ...o,
});

describe("dayReadiness — what closes today", () => {
  it("an empty day never closes (nothing to finish is not a win)", () => {
    expect(dayReadiness([])).toEqual({ total: 0, done: 0, closed: false, closedAt: null });
  });

  it("closes when every one of today's own tasks is done, at the last completion", () => {
    const r = dayReadiness([
      dt({ id: "a", status: "done", completedAt: "2026-11-17T18:10:00Z" }),
      dt({ id: "b", status: "done", completedAt: "2026-11-17T23:04:00Z" }),
    ]);
    expect(r).toMatchObject({ total: 2, done: 2, closed: true, closedAt: "2026-11-17T23:04:00Z" });
  });

  it("a repeating task that rolled in from an earlier day doesn't block the day", () => {
    const r = dayReadiness([
      dt({ id: "a", status: "done", completedAt: "2026-11-17T18:00:00Z" }),
      dt({ id: "pile", recurrenceId: "s1", rollCount: 114 }),
    ]);
    expect(r).toMatchObject({ total: 1, done: 1, closed: true });
  });

  it("…but finishing one still counts, and a carried one-off is still today's plan", () => {
    expect(dayReadiness([dt({ id: "pile", recurrenceId: "s1", rollCount: 3, status: "done", completedAt: "x" })]).total).toBe(1);
    expect(dayReadiness([dt({ id: "carried", rollCount: 2 })])).toMatchObject({ total: 1, closed: false });
  });

  it("trashed work never counts", () => {
    expect(dayReadiness([dt({ id: "t", status: "trashed" })]).total).toBe(0);
  });
});

describe("movingInitiativeIds — significance only toward a moving bet", () => {
  const kr = (o: Partial<{ baseline: number | null; current: number | null; updatedAt: string | null }>) => ({
    baseline: 10,
    current: 14,
    updatedAt: "2026-11-02T00:00:00Z",
    ...o,
  });

  it("quarters start on Jan, Apr, Jul and Oct 1", () => {
    expect(quarterStartISO("2026-11-17")).toBe("2026-10-01");
    expect(quarterStartISO("2026-01-01")).toBe("2026-01-01");
    expect(quarterStartISO("2026-06-30")).toBe("2026-04-01");
  });

  it("a number that moved and was written this quarter moves its bet", () => {
    expect(krMovedSince(kr({}), "2026-10-01")).toBe(true);
    expect(movingInitiativeIds([{ id: "i1", keyResults: [kr({})] }], "2026-11-17")).toEqual(["i1"]);
  });

  it("still at baseline, written last quarter, or never measured: not moving", () => {
    expect(krMovedSince(kr({ current: 10 }), "2026-10-01")).toBe(false);
    expect(krMovedSince(kr({ updatedAt: "2026-09-20T00:00:00Z" }), "2026-10-01")).toBe(false);
    expect(krMovedSince(kr({ current: null }), "2026-10-01")).toBe(false);
    expect(movingInitiativeIds([{ id: "i1", keyResults: [] }], "2026-11-17")).toEqual([]);
  });
});

describe("fitsCapacity — the week fits inside 70–100%", () => {
  it("reads under, fits and over", () => {
    expect(fitsCapacity(20 * 60, 32 * 60)).toBe("under");
    expect(fitsCapacity(30 * 60, 32 * 60)).toBe("fits");
    expect(fitsCapacity(32 * 60, 32 * 60)).toBe("fits");
    expect(fitsCapacity(38 * 60, 32 * 60)).toBe("over");
    expect(fitsCapacity(0, 0)).toBe("under");
  });
});

// ── the app's read ─────────────────────────────────────────────────────────

function task(o: Partial<Task> & { id: string }): Task {
  return {
    user_id: "u",
    created_at: "",
    updated_at: "",
    title: o.id,
    notes: "",
    status: "planned",
    do_date: "2026-11-17",
    start_time: null,
    duration_minutes: 30,
    deadline: null,
    priority: "none",
    roll_count: 0,
    completed_at: null,
    trashed_at: null,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    key_result_id: null,
    sprint_id: null,
    big_rock_id: null,
    energy: null,
    assignee: "me",
    prework: "",
    prework_at: null,
    suggestion: null,
    suggested_at: null,
    google_event_id: null,
    sort_order: 0,
    slot_id: null,
    parent_task_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    ...o,
  } as Task;
}

describe("readDay — the hour you got back", () => {
  it("closed at 3:04pm on a 5pm day is 1h 56m back", () => {
    const at = new Date(2026, 10, 17, 15, 4);
    const d = readDay([task({ id: "a", status: "done", completed_at: at.toISOString() })], 17 * 60);
    expect(d.closed).toBe(true);
    expect(d.backMins).toBe(116);
    expect(spanWords(d.backMins!)).toBe("1h 56m");
  });

  it("closed after the working day: no time back is claimed", () => {
    const at = new Date(2026, 10, 17, 19, 0);
    expect(readDay([task({ id: "a", status: "done", completed_at: at.toISOString() })], 17 * 60).backMins).toBeNull();
  });

  it("orders timed tasks by the clock, untimed after", () => {
    const d = readDay(
      [
        task({ id: "untimed" }),
        task({ id: "late", start_time: new Date(2026, 10, 17, 16).toISOString() }),
        task({ id: "early", start_time: new Date(2026, 10, 17, 9).toISOString() }),
      ],
      990,
    );
    expect(d.tasks.map((t) => t.id)).toEqual(["early", "late", "untimed"]);
  });
});

describe("the deck marks", () => {
  it("projects: Ready · Fits · Shipped, the stop on Ready and Fits", () => {
    const m = projectDeckMarks(
      [
        { id: "a", color: "red", ready: true, shipped: false, weekMins: 600 },
        { id: "b", color: "red", ready: true, shipped: true, weekMins: 0 },
        { id: "c", color: "red", ready: true, shipped: false, weekMins: 1200 },
      ],
      32 * 60,
    );
    expect(m.map((x) => x.key)).toEqual(["deck-ready", "fits", "shipped"]);
    expect(m[1]).toMatchObject({ full: true, detail: "30h of 32h" });
    expect(m[2]).toMatchObject({ n: 1, of: 3, full: false });
    expect(marksReady(m)).toBe(true);
  });

  it("an overfull week says how far over, and holds the stop back", () => {
    const m = projectDeckMarks([{ id: "a", color: "red", ready: true, shipped: false, weekMins: 38 * 60 }], 32 * 60);
    expect(m[1].full).toBe(false);
    expect(m[1].todo).toBe("6h over");
    expect(marksReady(m)).toBe(false);
  });

  it("initiatives: Ready · On a week · Moving", () => {
    const m = initiativeDeckMarks([
      { id: "i1", color: "x", ready: true, onWeek: true, moving: true },
      { id: "i2", color: "x", ready: true, onWeek: true, moving: false },
    ]);
    expect(m.map((x) => [x.key, x.n, x.of, x.full])).toEqual([
      ["bet-ready", 2, 2, true],
      ["on-week", 2, 2, true],
      ["moving", 1, 2, false],
    ]);
    expect(marksReady(m)).toBe(true);
  });

  it("every mark carries its definition", () => {
    for (const d of Object.values(MARK_DEFS)) {
      expect(d.counts.length).toBeGreaterThan(10);
      expect(d.closes.length).toBeGreaterThan(10);
    }
  });
});

// ── the kit: still on mount, moving only on a transition ───────────────────

describe("Readings kit parts", () => {
  it("nothing celebrates on mount — a page opening is still; a transition does", () => {
    const marks = (full: boolean) =>
      projectDeckMarks([{ id: "a", color: "red", ready: true, shipped: false, weekMins: full ? 1800 : 600 }], 32 * 60);
    const { rerender } = render(
      <>
        <Stop on />
        <MarkSet marks={marks(true)} />
      </>,
    );
    expect(celebrate.dropStop).not.toHaveBeenCalled();
    expect(celebrate.closeDial).not.toHaveBeenCalled();
    expect(celebrate.bump).not.toHaveBeenCalled();
    rerender(
      <>
        <Stop on={false} />
        <MarkSet marks={marks(false)} />
      </>,
    );
    rerender(
      <>
        <Stop on />
        <MarkSet marks={marks(true)} />
      </>,
    );
    expect(celebrate.dropStop).toHaveBeenCalledTimes(1);
    expect(celebrate.closeDial).toHaveBeenCalledWith(expect.anything(), "medium", expect.any(Number)); // Fits locks
  });

  it("every step a dial takes swells it — the click a piece used to give (D-219)", () => {
    vi.mocked(celebrate.bump).mockClear();
    vi.mocked(celebrate.closeDial).mockClear();
    const set = (n: number) => [{ key: "done" as const, label: "Done", n, of: 5, full: n >= 5, tier: "medium" as const, pieces: [], todo: `${5 - n} to go` }];
    const { rerender } = render(<MarkSet marks={set(2)} />);
    expect(celebrate.bump).not.toHaveBeenCalled();
    rerender(<MarkSet marks={set(3)} />);
    expect(celebrate.bump).toHaveBeenCalledTimes(1);
    expect(celebrate.closeDial).not.toHaveBeenCalled();
    rerender(<MarkSet marks={set(5)} />);
    expect(celebrate.closeDial).toHaveBeenCalledTimes(1);
    // An undo steps back quietly.
    rerender(<MarkSet marks={set(4)} />);
    expect(celebrate.bump).toHaveBeenCalledTimes(1);
  });

  it("the day says the hour you got back", () => {
    render(
      <DayCrown
        day={{ total: 2, done: 2, closed: true, closedAt: null, closedAtDate: new Date(2026, 10, 17, 15, 4), backMins: 116, tasks: [] }}
        pieces={[]}
      />,
    );
    expect(screen.getByText("Done at 3:04pm. 1h 56m of your day back.")).toBeTruthy();
  });

  it("each mark label carries its definition for hover, focus and a screen reader", () => {
    const marks = initiativeDeckMarks([{ id: "i1", color: "x", ready: true, onWeek: false, moving: false }]);
    render(<MarkSet marks={marks} />);
    const label = screen.getByText("On a week");
    expect(label.getAttribute("title")).toContain("Initiatives with at least one project on this week");
    expect(label.getAttribute("tabindex")).toBe("0");
  });
});

// ── the deck at rest ────────────────────────────────────────────────────────

function card(key: string): ReadyCard {
  return {
    key,
    kind: "hold",
    title: `Card ${key}`,
    why: "why",
    primary: { verb: "Schedule", name: "3pm", run: vi.fn() },
    secondary: { label: "Not now", run: vi.fn() },
    projectId: null,
  } as unknown as ReadyCard;
}

describe("RestDeck — the stack's top card at rest", () => {
  it("shows one card; Not now sends it to the back rather than away", () => {
    const cards = [card("a"), card("b"), card("c")];
    render(<RestDeck cards={cards} />);
    expect(screen.getByText("Card a")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Not now/ }));
    });
    expect(screen.getByText("Card b")).toBeTruthy();
    expect(screen.queryByText("Card a")).toBeNull();
    // it was not snoozed — the model still has it, at the back
    expect((cards[0].secondary as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
  });

  it("the last card's Not now is the stack's own snooze", () => {
    const only = card("z");
    render(<RestDeck cards={[only]} />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Not now/ }));
    });
    expect((only.secondary as { run: ReturnType<typeof vi.fn> }).run).toHaveBeenCalled();
  });

  it("an empty stack draws nothing", () => {
    const { container } = render(<RestDeck cards={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

// ── one rule, two runtimes ─────────────────────────────────────────────────

describe("the agent reads the same readiness", () => {
  it("its context computes the day and moving bets through the kernel", () => {
    const src = readFileSync("supabase/functions/agent/context.ts", "utf8");
    expect(src).toMatch(/dayReadiness\(/);
    expect(src).toMatch(/movingInitiativeIds\(/);
    // `*`, like the app's own read: a column one database lacks comes back empty
    // instead of failing the agent's whole context.
    expect(src).toContain("key_results(*)");
  });

  it("the prompt tells it what a closed day and a moving bet mean", () => {
    const prompt = readFileSync("supabase/functions/agent/prompt.ts", "utf8");
    expect(prompt).toContain("readiness.day");
    expect(prompt).toContain("readiness.movingInitiativeIds");
  });

  it("no surface defines its own day or moving rule", () => {
    const marks = readFileSync("src/lib/marks.ts", "utf8");
    expect(marks).not.toMatch(/function dayReadiness|function movingInitiativeIds/);
  });
});
