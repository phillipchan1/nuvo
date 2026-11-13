// Get ready (D-206) — the cards' composition and order, worst first. Fixtures
// deliberately unlike the builder's account (P16): an empty account, an account
// with no initiatives or slate, one with only an inbox, one buried in loose work.

import { describe, expect, it, vi } from "vitest";
import { composeReadyCards, LOOSE_CARDS_MAX, READY_MAX, REPAIR_CARDS_MAX, readyKey, type ReadyActs, type ReadyInput } from "../src/lib/readyCards";

const TODAY = "2026-11-11"; // a Wednesday
const acts = (): ReadyActs => ({
  move: vi.fn(),
  leave: vi.fn(),
  repairAll: vi.fn(),
  hold: vi.fn(),
  holdLoose: vi.fn(),
  planWeek: vi.fn(),
  file: vi.fn(),
  draftPath: vi.fn(),
  keep: vi.fn(),
  notNow: vi.fn(),
});
const input = (over: Partial<ReadyInput> = {}): ReadyInput => ({ todayISO: TODAY, weekISO: "2026-11-09", acts: acts(), now: Date.parse("2026-11-11T17:00:00Z"), ...over });
const at = (dayISO: string, startMin: number, durationMin = 30) => ({ dayISO, startMin, durationMin });

describe("Get ready — composeReadyCards", () => {
  it("an empty account has nothing to get ready", () => {
    expect(composeReadyCards(input())).toEqual([]);
  });

  it("only an inbox: each capture the router is sure of, written as its destination", () => {
    const cards = composeReadyCards(input({ inbox: [{ taskId: "i1", title: "Book the hall", place: "Frontier Church", projectId: null }] }));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "file", title: "Book the hall", why: "In the inbox", primary: { verb: "→", name: "Frontier Church" } });
    expect(cards[0].secondary?.label).toBe("Not now");
    // nothing is written until the act is pressed (P3)
    expect(cards[0].primary).not.toHaveProperty("count");
  });

  it("orders worst first: broken, today, the week's loose, inbox, thin paths, memory", () => {
    const cards = composeReadyCards(
      input({
        memory: { key: "m1", statement: "You stop at 4pm on Fridays", evidence: "6 of 8 weeks", consequence: "Fridays end at 4pm" },
        thin: [{ projectId: "p2", name: "Launch site", evidence: "3h held · 20m of work" }],
        inbox: [{ taskId: "i1", title: "Call the vet", place: "Home", projectId: null }],
        loose: [{ taskId: "l1", title: "Write the brief", projectId: "p1", projectName: "Pricing", at: at("2026-11-12", 600, 60) }],
        holds: [{ taskId: "h1", title: "Email Dana", projectId: null, at: at(TODAY, 840) }],
        repairs: [{ key: "r1", title: "Pricing review", why: "meeting", event: "Design sync", from: at(TODAY, 600, 60), to: at("2026-11-12", 540, 60), projectId: "p1" }],
      }),
    );
    expect(cards.map((c) => c.kind)).toEqual(["repair", "hold", "loose", "file", "path", "memory"]);
    expect(cards[0].primary.verb).toBe("Move to");
    expect(cards[0].primary.name).toMatch(/^Thu 9/);
    expect(cards[0].secondary?.label).toBe("Leave it where it is");
    expect(cards[0].why).toMatch(/^Design sync landed on it · was Wed 10/);
    // today's hold is spelled in the clock vocabulary, no day; the week's names its day
    expect(cards[1].primary).toMatchObject({ verb: "Hold", name: "2–2:30pm" });
    expect(cards[2].primary).toMatchObject({ verb: "Hold", name: "Thu 10–11am" });
    expect(cards[2].why).toBe("Pricing · no time this week");
    expect(cards[4]).toMatchObject({ title: "Launch site", why: "3h held · 20m of work", primary: { verb: "Draft the path" } });
    expect(cards[5].primary).toMatchObject({ verb: "Keep:", name: "Fridays end at 4pm" });
  });

  it("a hold that falls to a later day says so, by its day", () => {
    const cards = composeReadyCards(input({ holds: [{ taskId: "h1", title: "Email Dana", projectId: null, at: at("2026-11-13", 540) }] }));
    expect(cards[0].primary.name).toBe("Fri 9–9:30am");
    expect(cards[0].why).toBe("Today · no time left today");
  });

  it("more loose work than cards becomes one 'Plan the whole week' card that opens the Plan mode", () => {
    const loose = Array.from({ length: 6 }, (_, i) => ({ taskId: `l${i}`, title: `Piece ${i}`, projectId: "p1", projectName: "Pricing", at: at("2026-11-12", 540 + i * 60) }));
    const a = acts();
    const cards = composeReadyCards(input({ loose, acts: a }));
    expect(cards.filter((c) => c.kind === "loose")).toHaveLength(LOOSE_CARDS_MAX);
    const plan = cards.find((c) => c.kind === "plan")!;
    expect(plan).toMatchObject({ title: "Plan the whole week", opensMode: "plan", primary: { verb: "Plan the week" } });
    plan.primary.run(null);
    expect(a.planWeek).toHaveBeenCalledTimes(1);
    // no card carries a count of what is left (P4)
    expect(cards.some((c) => /\d+ more|\d+ left/.test(`${c.title} ${c.why}`))).toBe(false);
  });

  it("loose work the composer couldn't fit goes to the walk, never to a card with no destination", () => {
    const cards = composeReadyCards(input({ loose: [{ taskId: "l1", title: "Big rewrite", projectId: "p1", projectName: "Pricing", at: null }] }));
    expect(cards.map((c) => c.kind)).toEqual(["plan"]);
  });

  it("past two broken blocks, the rest go to the Repair mode as one card", () => {
    const repairs = Array.from({ length: 4 }, (_, i) => ({ key: `r${i}`, title: `Block ${i}`, why: "missed" as const, from: at(TODAY, 540 + i * 60), to: at("2026-11-12", 540 + i * 60), projectId: null }));
    const cards = composeReadyCards(input({ repairs }));
    expect(cards.filter((c) => c.kind === "repair")).toHaveLength(REPAIR_CARDS_MAX);
    expect(cards[REPAIR_CARDS_MAX]).toMatchObject({ kind: "repairAll", opensMode: "repair", primary: { verb: "Repair" } });
    expect(cards[0].why).toMatch(/^Missed · was Wed 9/);
  });

  it("a Not now said on a row chip holds here too — the same snooze keys", () => {
    const now = Date.parse("2026-11-11T17:00:00Z");
    const snoozed = { [readyKey.file("i1")]: new Date(now - 86_400_000).toISOString() };
    const cards = composeReadyCards(
      input({
        now,
        snoozed,
        inbox: [
          { taskId: "i1", title: "Snoozed", place: "Home", projectId: null },
          { taskId: "i2", title: "Shown", place: "Home", projectId: null },
        ],
      }),
    );
    expect(cards.map((c) => c.title)).toEqual(["Shown"]);
    expect(readyKey.file("i1")).toBe("file:i1"); // RailOffers' offerKey("file", id)
  });

  it("acts route to the host with the card's own ids", () => {
    const a = acts();
    const cards = composeReadyCards(
      input({
        acts: a,
        holds: [{ taskId: "h1", title: "Email Dana", projectId: "p9", at: at(TODAY, 840) }],
        thin: [{ projectId: "p2", name: "Launch site", evidence: "2h held · no steps" }],
      }),
    );
    const el = {} as HTMLElement;
    cards[0].primary.run(el);
    expect(a.hold).toHaveBeenCalledWith("h1", el);
    expect(cards[0].projectId).toBe("p9");
    cards[0].secondary!.run();
    expect(a.notNow).toHaveBeenCalledWith("hold:h1");
    cards[1].primary.run(null);
    expect(a.draftPath).toHaveBeenCalledWith("p2");
  });

  it("a busy account still yields an ordered queue; surfaces show the first five", () => {
    const cards = composeReadyCards(
      input({
        holds: Array.from({ length: 4 }, (_, i) => ({ taskId: `h${i}`, title: `Today ${i}`, projectId: null, at: at(TODAY, 780 + i * 30) })),
        inbox: Array.from({ length: 4 }, (_, i) => ({ taskId: `i${i}`, title: `Inbox ${i}`, place: "Home", projectId: null })),
      }),
    );
    expect(cards.length).toBeGreaterThan(READY_MAX);
    expect(cards.slice(0, READY_MAX).map((c) => c.kind)).toEqual(["hold", "hold", "hold", "hold", "file"]);
  });
});
