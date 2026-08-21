import { describe, expect, it } from "vitest";
import { buildDayPlan, type DayCtx } from "../src/components/mobile/dayPlan";
import type { Task } from "../src/lib/types";

const now = new Date(2026, 7, 21, 10, 0, 0); // 21 Aug 2026 local

function ctx(over: Partial<DayCtx> = {}): DayCtx {
  return {
    visibleEvents: [],
    blocks: [],
    slots: [],
    slotChildren: {},
    slotTitles: new Map(),
    hidden: new Set(),
    workStart: 480,
    workEnd: 990,
    now,
    ...over,
  };
}

function anytime(id: string, title: string, doDate: string, extra: Partial<Task> = {}): Task {
  return { id, title, do_date: doDate, start_time: null, status: "planned", ...extra } as Task;
}

describe("buildDayPlan anytime", () => {
  it("surfaces untimed planned tasks on their do_date — the chip a Calendar capture needs", () => {
    const plan = buildDayPlan(
      now,
      ctx({ anytime: [anytime("t1", "Send OEI to Victoria", "2026-08-21")] }),
    );
    expect(plan.anytime).toEqual([{ id: "t1", title: "Send OEI to Victoria" }]);
  });

  it("does not put another day's capture on today", () => {
    const plan = buildDayPlan(
      now,
      ctx({ anytime: [anytime("t1", "Tomorrow's note", "2026-08-22")] }),
    );
    expect(plan.anytime).toEqual([]);
  });

  it("skips a row that already has a clock — those are timed blocks", () => {
    const plan = buildDayPlan(
      now,
      ctx({
        anytime: [anytime("t1", "Blocked", "2026-08-21", { start_time: now.toISOString() })],
      }),
    );
    expect(plan.anytime).toEqual([]);
  });
});
