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
