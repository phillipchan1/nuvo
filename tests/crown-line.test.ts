// The crown's line (D-207, docs/rail-line.md §4): the Get ready stack's first
// card, said as a fact. These pin the words and the "only the first, plus one
// then:" rule — the line and the stack can never disagree because the line is
// read off the stack.
import { describe, expect, it } from "vitest";
import { composeReadyCards, scheduleLine, type ReadyActs, type ReadyInput } from "../src/lib/readyCards";
import { lineFrom } from "../src/lib/crownLine";

const noop = () => {};
const acts: ReadyActs = { move: noop, leave: noop, repairAll: noop, hold: noop, holdLoose: noop, planWeek: noop, file: noop, draftPath: noop, keep: noop, notNow: noop };
const today = "2026-11-10";
const at = (dayISO: string, startMin: number, durationMin = 30) => ({ dayISO, startMin, durationMin });
const line = (input: Partial<ReadyInput>, afterHours = false) => {
  const full: ReadyInput = { todayISO: today, acts, now: Date.UTC(2026, 10, 10), ...input };
  return scheduleLine(full, composeReadyCards(full), { afterHours });
};

describe("the Schedule's line", () => {
  it("is nothing when the stack is empty", () => {
    expect(line({})).toBeNull();
  });

  it("names one missed block and when it was, in --warn, with ◌", () => {
    const l = line({ repairs: [{ key: "a", title: "Talk about Test Cases", why: "missed", from: at(today, 840), to: at(today, 960), projectId: null }] });
    expect(l).toMatchObject({ tone: "warn", glyph: "◌", text: "Talk about Test Cases didn't happen (2pm)", act: "Get ready" });
  });

  it("says a meeting landed, with ↯", () => {
    const l = line({ repairs: [{ key: "a", title: "Pricing review", why: "meeting", event: "Design sync", from: at(today, 600), to: at("2026-11-11", 540), projectId: null }] });
    expect(l).toMatchObject({ glyph: "↯", text: "Design sync landed on Pricing review" });
  });

  it("counts several breaks, and folds today's misses after hours", () => {
    const repairs = [0, 1, 2].map((i) => ({ key: `r${i}`, title: `B${i}`, why: "missed" as const, from: at(today, 600 + i * 60), to: at("2026-11-11", 600), projectId: null }));
    expect(line({ repairs })?.text).toBe("3 blocks didn't happen");
    expect(line({ repairs }, true)?.text).toBe("3 from today didn't happen");
  });

  it("puts a break first and what has no time under it as one then:", () => {
    const l = line({
      repairs: [{ key: "a", title: "Memo", why: "missed", from: at(today, 840), to: at(today, 960), projectId: null }],
      holds: [{ taskId: "t1", title: "Call", projectId: null, at: at(today, 990) }],
      loose: [{ taskId: "t2", title: "Draft", projectId: "p", projectName: "P", at: at("2026-11-12", 600) }],
    });
    expect(l?.text).toBe("Memo didn't happen (2pm)");
    expect(l?.then).toBe("2 with no time");
  });

  it("says what has no time, in accent, when nothing broke", () => {
    const l = line({ holds: [{ taskId: "t1", title: "Call", projectId: null, at: at(today, 990) }] });
    expect(l).toMatchObject({ tone: "accent", glyph: null, text: "1 with no time", then: null });
  });
});

describe("lineFrom", () => {
  it("never carries a then: of the same part as the first card", () => {
    const l = lineFrom([
      { part: "time", fact: "4 with no time", then: "4 with no time", tone: "accent" },
      { part: "time", fact: "4 with no time", then: "4 with no time", tone: "accent" },
    ]);
    expect(l?.then).toBeNull();
  });
});
