// Get ready on the decks (D-207, docs/rail-line.md §5): worst first, every act
// named by where it goes, and the crown's line read off the first card.
import { describe, expect, it, vi } from "vitest";
import { deckLine, initiativeDeckCards, projectDeckCards, type ProjectDeckFact } from "../src/lib/deckReady";

const fact = (over: Partial<ProjectDeckFact>): ProjectDeckFact => ({
  id: "p", name: "Project", weekIdx: 1, weekLabel: "Nov 16", overdueDays: null, thin: null, gap: null, wontFit: false, ...over,
});

describe("the project deck's stack", () => {
  it("ranks overdue, then a thin path, then a gap, then won't fit — nearer weeks first", () => {
    const acts = { open: vi.fn(), draftPath: vi.fn() };
    const cards = projectDeckCards(
      [
        fact({ id: "fit", name: "Fit", wontFit: true, weekIdx: 0 }),
        fact({ id: "gap-far", name: "Far", gap: "no outcome", weekIdx: 3 }),
        fact({ id: "gap-near", name: "Near", gap: "no outcome", weekIdx: 0 }),
        fact({ id: "thin", name: "Thin", thin: "20m of 3h held" }),
        fact({ id: "late", name: "Late", overdueDays: 4 }),
      ],
      acts,
    );
    expect(cards.map((c) => c.key)).toEqual(["deck:overdue:late", "deck:thin:thin", "deck:gap:gap-near", "deck:gap:gap-far", "deck:fit:fit"]);
  });

  it("sends no steps to Draft the path and everything else to the record", () => {
    const acts = { open: vi.fn(), draftPath: vi.fn() };
    const [steps, outcome] = projectDeckCards([fact({ id: "a", gap: "no steps", weekIdx: 0 }), fact({ id: "b", gap: "no outcome" })], acts);
    expect(steps.primary.verb).toBe("Draft the path");
    steps.primary.run(null);
    expect(acts.draftPath).toHaveBeenCalledWith("a");
    expect(outcome.primary.verb).toBe("Open");
    outcome.primary.run(null);
    expect(acts.open).toHaveBeenCalledWith("b");
  });

  it("is empty on a clean deck, so there is no line (P7)", () => {
    const cards = projectDeckCards([fact({})], { open: vi.fn(), draftPath: vi.fn() });
    expect(cards).toEqual([]);
    expect(deckLine(cards, "project")).toBeNull();
  });
});

describe("the project deck's acts that write (D-207)", () => {
  it("shows a ✦ outcome draft and writes it only on Set as outcome", () => {
    const acts = { open: vi.fn(), draftPath: vi.fn(), setOutcome: vi.fn() };
    const [card] = projectDeckCards([fact({ id: "n", name: "Newsletter", gap: "no outcome", draft: { state: "ready", text: "The relaunch issue reaches every family" } })], acts);
    expect(card.why).toBe("✦ The relaunch issue reaches every family");
    expect(card.primary.verb).toBe("Set as outcome");
    expect(acts.setOutcome).not.toHaveBeenCalled();
    card.primary.run(null);
    expect(acts.setOutcome).toHaveBeenCalledWith("n", "The relaunch issue reaches every family", null);
    expect(card.secondary?.label).toBe("Write my own");
    // while drafting it says so, and only opens
    const [loading] = projectDeckCards([fact({ gap: "no outcome", draft: { state: "loading" } })], acts);
    expect(loading.why).toMatch(/drafting/);
    expect(loading.primary.verb).toBe("Open");
  });

  it("offers to move the one project out of a crowded week, ahead of shaping", () => {
    const acts = { open: vi.fn(), draftPath: vi.fn(), move: vi.fn() };
    const cards = projectDeckCards(
      [
        fact({ id: "g", gap: "no outcome", weekIdx: 0 }),
        fact({ id: "c", name: "Crowd", weekIdx: 1, crowded: { load: 5, cap: 2 }, moveTo: { label: "In 2 weeks" } }),
      ],
      acts,
    );
    expect(cards[0]).toMatchObject({ key: "deck:crowd:c", why: "Nov 16 holds 5 · room for 2" });
    expect(cards[0].primary).toMatchObject({ verb: "Move to", name: "In 2 weeks" });
    cards[0].primary.run(null);
    expect(acts.move).toHaveBeenCalledWith("c", null);
    expect(deckLine(cards, "project")).toMatchObject({ text: "Nov 16 holds 5, room for 2", then: "Project needs shaping" });
  });

  it("moves a project that won't fit, when a later week has room", () => {
    const acts = { open: vi.fn(), draftPath: vi.fn(), move: vi.fn() };
    const [card] = projectDeckCards([fact({ wontFit: true, moveTo: { label: "Next week" } })], acts);
    expect(card.primary).toMatchObject({ verb: "Move to", name: "Next week" });
  });
});

describe("the decks' line", () => {
  it("names one project's gap, or counts several", () => {
    const acts = { open: vi.fn(), draftPath: vi.fn() };
    const one = projectDeckCards([fact({ name: "Newsletter", gap: "no outcome" })], acts);
    expect(deckLine(one, "project")).toMatchObject({ tone: "accent", text: "Newsletter: no outcome", act: "Get ready" });
    const two = projectDeckCards([fact({ id: "a", gap: "no outcome" }), fact({ id: "b", gap: "no steps" })], acts);
    expect(deckLine(two, "project")?.text).toBe("2 projects need shaping");
  });

  it("puts an at-risk bet first, in warn, with what needs shaping as its then:", () => {
    const cards = initiativeDeckCards(
      [
        { id: "a", name: "Grow the church", quarterIdx: 0, quarterLabel: "Q4", risk: null, overdue: false, gap: "no key results", stateWord: null },
        { id: "b", name: "Staff rigor", quarterIdx: 1, quarterLabel: "Q1", risk: "no project on deck", overdue: false, gap: null, stateWord: null },
      ],
      { open: vi.fn(), draftPath: vi.fn() },
    );
    expect(cards[0].key).toBe("bet:risk:b");
    expect(deckLine(cards, "initiative")).toMatchObject({ tone: "warn", text: "Staff rigor is at risk", then: "Grow the church needs shaping" });
  });
});
