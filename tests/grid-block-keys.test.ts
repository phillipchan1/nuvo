// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DRAFT_PREVIEW_ID,
  gridBlocks,
  homeBlockId,
  shiftForKey,
  shiftSpan,
} from "../src/components/calendar/blockKeys";
import { createGestureCancel } from "../src/components/calendar/gestureCancel";
import type { CalendarBlockInput } from "../src/lib/syncCalendarEvents";

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (d: Date) => d.toISOString();

const block = (
  id: string,
  start: string,
  end: string | undefined,
  kind: string,
  extra: Partial<CalendarBlockInput> = {},
  done = false,
): CalendarBlockInput => ({
  id,
  title: id,
  start,
  end,
  extendedProps: { kind, refId: id.split(":")[1], done },
  ...extra,
});

describe("the grid as a list — blocks in time order (D-158)", () => {
  const thu9 = local(2026, 10, 15, 9);
  const thu930 = local(2026, 10, 15, 9, 30);
  const thu10 = local(2026, 10, 15, 10);
  const fri9 = local(2026, 10, 16, 9);
  const inputs = [
    block("evt:fri", iso(fri9), iso(new Date(fri9.getTime() + 3_600_000)), "google"),
    block("task:late", iso(thu930), iso(thu10), "task", {}, true),
    block("slot:long", iso(thu9), iso(thu10), "slot"),
    block("task:short", iso(thu9), iso(thu930), "task"),
    block("task:chip", "2026-10-15", undefined, "task", { allDay: true }),
    block(DRAFT_PREVIEW_ID, iso(thu9), iso(thu930), "task", { extendedProps: { kind: "task", refId: "" } }),
  ];

  it("orders by start, a day's anytime chip first, then shorter, never the draft ghost", () => {
    expect(gridBlocks(inputs).map((b) => b.id)).toEqual([
      "task:chip",
      "task:short",
      "slot:long",
      "task:late",
      "evt:fri",
    ]);
  });

  it("knows each block's kind, row and whether a task is done", () => {
    const byId = new Map(gridBlocks(inputs).map((b) => [b.id, b]));
    expect(byId.get("evt:fri")).toMatchObject({ kind: "event", refId: "fri", status: null });
    expect(byId.get("slot:long")).toMatchObject({ kind: "slot", refId: "long" });
    expect(byId.get("task:late")).toMatchObject({ kind: "task", status: "done" });
    // An anytime chip is the whole day, from local midnight.
    const chip = byId.get("task:chip")!;
    expect(chip.allDay).toBe(true);
    expect(chip.start).toBe(local(2026, 10, 15).getTime());
    expect(chip.end).toBe(local(2026, 10, 16).getTime());
  });

  it("j / k start from the next thing on screen that isn't over, not the top of the week", () => {
    const blocks = gridBlocks(inputs);
    const weekStart = local(2026, 10, 12).getTime();
    const weekEnd = local(2026, 10, 19).getTime();
    // 9:40 on Thursday: the 9–9:30 block is over, the 9–10 slot is not.
    expect(homeBlockId(blocks, weekStart, weekEnd, local(2026, 10, 15, 9, 40).getTime())).toBe("slot:long");
    // Looking at another week: its first block.
    expect(homeBlockId(blocks, weekStart, weekEnd, local(2026, 11, 1).getTime())).toBe("task:chip");
    expect(homeBlockId(blocks, local(2026, 12, 1).getTime(), local(2026, 12, 8).getTime(), 0)).toBeNull();
  });
});

describe("shiftSpan — the moves only a grid has", () => {
  const span = (h: number, m: number, mins: number) => {
    const start = local(2026, 10, 15, h, m);
    return { start, end: new Date(start.getTime() + mins * 60_000) };
  };
  const hm = (d: Date) => `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

  it("nudges a quarter hour, keeping the length", () => {
    const next = shiftSpan(span(9, 0, 30), "later")!;
    expect([hm(next.start), hm(next.end)]).toEqual(["15 9:15", "15 9:45"]);
    const prev = shiftSpan(span(9, 0, 30), "earlier")!;
    expect([hm(prev.start), hm(prev.end)]).toEqual(["15 8:45", "15 9:15"]);
  });

  it("lands an off-grid block on the grid it was dragged on", () => {
    expect(hm(shiftSpan(span(9, 10, 30), "later")!.start)).toBe("15 9:15");
    expect(hm(shiftSpan(span(9, 10, 30), "earlier")!.start)).toBe("15 9:00");
  });

  it("resizes from the end, never below a quarter hour", () => {
    expect(hm(shiftSpan(span(9, 0, 30), "longer")!.end)).toBe("15 9:45");
    expect(hm(shiftSpan(span(9, 0, 30), "shorter")!.end)).toBe("15 9:15");
    expect(shiftSpan(span(9, 0, 15), "shorter")).toBeNull();
    // The start never moves on a resize.
    expect(hm(shiftSpan(span(9, 0, 30), "longer")!.start)).toBe("15 9:00");
  });

  it("moves a day keeping the clock; an anytime block only moves days", () => {
    const next = shiftSpan(span(14, 30, 60), "nextDay")!;
    expect([hm(next.start), hm(next.end)]).toEqual(["16 14:30", "16 15:30"]);
    const chip = { start: local(2026, 10, 15), end: local(2026, 10, 16), allDay: true };
    expect(shiftSpan(chip, "later")).toBeNull();
    expect(shiftSpan(chip, "longer")).toBeNull();
    expect(shiftSpan(chip, "prevDay")!.start.getDate()).toBe(14);
  });

  it("past midnight goes to the next day, as the grid draws it", () => {
    const late = shiftSpan(span(23, 45, 15), "later")!;
    expect(hm(late.start)).toBe("16 0:00");
  });

  it("reads the key: ⌥↑↓ nudge, ⌥⇧↑↓ resize, ⌥←→ a day, nothing without ⌥", () => {
    const k = (key: string, mods: Partial<KeyboardEvent> = {}) =>
      shiftForKey({ key, altKey: true, shiftKey: false, metaKey: false, ctrlKey: false, ...mods });
    expect(k("ArrowUp")).toBe("earlier");
    expect(k("ArrowDown")).toBe("later");
    expect(k("ArrowUp", { shiftKey: true })).toBe("shorter");
    expect(k("ArrowDown", { shiftKey: true })).toBe("longer");
    expect(k("ArrowLeft")).toBe("prevDay");
    expect(k("ArrowRight")).toBe("nextDay");
    expect(k("ArrowDown", { altKey: false })).toBeNull();
    expect(k("ArrowDown", { metaKey: true })).toBeNull();
  });
});

describe("Esc calls a drag off — the release writes nothing (#32)", () => {
  it("marks a live gesture once, and the drop handler's question answers once", () => {
    const g = createGestureCancel(document);
    expect(g.escape()).toBe(false); // nothing in hand
    g.begin();
    expect(g.escape()).toBe(true);
    expect(g.escape()).toBe(false); // already cancelled
    g.end(); // pointerup comes BEFORE FullCalendar's drop handlers
    expect(g.take()).toBe(true);
    expect(g.take()).toBe(false);
  });

  it("owns the keyboard while live — a hidden nested surface the list keys respect", () => {
    const g = createGestureCancel(document);
    g.begin();
    expect(document.querySelector("[data-nested-surface]")).not.toBeNull();
    g.end();
    expect(document.querySelector("[data-nested-surface]")).toBeNull();
  });

  it("a second layer starting the same drag after Esc doesn't undo the cancel", () => {
    // The pointer watch begins at 5px, FullCalendar's eventDragStart a beat
    // later — Esc between them was silently forgotten, and the drop committed.
    const g = createGestureCancel(document);
    g.begin();
    g.escape();
    g.begin();
    g.end();
    expect(g.take()).toBe(true);
    g.dispose();
  });

  it("a cancel nothing consumed (released off the grid) doesn't leak into the next drag", () => {
    const g = createGestureCancel(document);
    g.begin();
    g.escape();
    g.end();
    g.begin();
    expect(g.cancelled).toBe(false);
    g.dispose();
  });
});
