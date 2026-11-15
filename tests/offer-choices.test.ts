// Other times (docs/offer-rules.md R5 · R13, D-216): alternatives differ for a
// reason they name, at most two, each with its cost; your own pick is checked.
import { describe, expect, it } from "vitest";
import { checkPick, costFor, nameAlternatives, reasonFor, snapPick, type BusyItem } from "../src/lib/offerChoices";
import { composeReadyCards, readyKey, type ReadyActs } from "../src/lib/readyCards";

// Tue 2026-11-10 is "today".
const TUE = "2026-11-10";
const WED = "2026-11-11";
const THU = "2026-11-12";
const at = (dayISO: string, h: number, m = 0, d = 45) => ({ dayISO, startMin: h * 60 + m, durationMin: d });

const busy: BusyItem[] = [
  { title: "PermitHub Risks", dayISO: TUE, startMin: 14 * 60, endMin: 15 * 60 },
  { title: "Kid date night", dayISO: TUE, startMin: 17 * 60, endMin: 19 * 60 },
  { title: "Lunch", dayISO: WED, startMin: 12 * 60, endMin: 13 * 60 },
];

describe("reasons (R13)", () => {
  const first = at(TUE, 16, 15);
  it("names how an alternative differs from the first answer", () => {
    expect(reasonFor(at(TUE, 15), first, TUE)).toBe("Sooner");
    expect(reasonFor(at(TUE, 18), first, TUE)).toBe("Later today");
    expect(reasonFor(at(WED, 13), first, TUE)).toBe("Keeps today light");
    expect(reasonFor(at(WED, 13), at(THU, 10), TUE)).toBe("Earlier in the week");
    expect(reasonFor(at(THU, 13), at(WED, 10), TUE)).toBe("Later in the week");
  });

  it("keeps at most two, never two with the same reason, never the first answer again", () => {
    const out = nameAlternatives(first, [first, at(TUE, 15), at(TUE, 15, 15), at(WED, 13), at(WED, 15)], TUE, busy);
    expect(out.map((o) => o.reason)).toEqual(["Sooner", "Keeps today light"]);
  });
});

describe("costs (R5)", () => {
  it("says what a time butts against", () => {
    expect(costFor(at(TUE, 16, 15), busy)).toBe("Right before Kid date night");
    expect(costFor(at(TUE, 15), busy)).toBe("Straight after PermitHub Risks");
    expect(costFor(at(WED, 13, 0), busy)).toBe("Straight after Lunch");
    expect(costFor(at(WED, 9), busy)).toBeNull();
  });

  it("an alternative carries its own cost", () => {
    const [sooner] = nameAlternatives(at(TUE, 16, 15), [at(TUE, 15)], TUE, busy);
    expect(sooner.cost).toBe("Straight after PermitHub Risks");
  });
});

describe("your own pick (R13)", () => {
  const now = new Date(2026, 10, 10, 9, 30);
  it("is checked like the others: overlap, the past, or open", () => {
    expect(checkPick(at(TUE, 14, 30), busy, now, TUE)).toEqual({ cost: "Overlaps PermitHub Risks", past: false });
    expect(checkPick(at(TUE, 8), busy, now, TUE)).toEqual({ cost: "That time has passed", past: true });
    expect(checkPick(at(WED, 9), busy, now, TUE)).toEqual({ cost: "Open", past: false });
  });
  it("snaps to the quarter hour at the task's length", () => {
    expect(snapPick(new Date(2026, 10, 11, 10, 8), 45, WED)).toEqual(at(WED, 10, 15));
  });
});

describe("no time offers for this project (R8)", () => {
  const noop = () => {};
  const acts = { move: noop, leave: noop, repairAll: noop, hold: noop, holdLoose: noop, placeAt: noop, planWeek: noop, file: noop, draftPath: noop, keep: noop, notNow: noop } as ReadyActs;
  const loose = [{ taskId: "t1", title: "Runbook", projectId: "p1", projectName: "Security", at: at(TUE, 16, 15) }];
  it("a project-wide no hides its loose cards; the card can be held elsewhere", () => {
    const shown = composeReadyCards({ todayISO: TUE, loose, acts });
    const card = shown.find((c) => c.kind === "loose")!;
    expect(card.taskId).toBe("t1");
    expect(card.placeAt).toBeTypeOf("function");
    const hidden = composeReadyCards({ todayISO: TUE, loose, acts, snoozed: { [readyKey.times("p1")]: new Date(2026, 10, 10).toISOString() }, now: new Date(2026, 10, 10, 12).getTime() });
    expect(hidden.some((c) => c.kind === "loose")).toBe(false);
  });
});
