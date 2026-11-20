import { describe, expect, it } from "vitest";
import { layoutDay, type Laid } from "../src/components/mobile/dayPlan";

const date = new Date(2026, 10, 20);
const at = (h: number, m = 0) => new Date(2026, 10, 20, h, m);
const item = (id: string, s: [number, number?], e: [number, number?]) =>
  ({ id, kind: "event", title: id, start: at(...s), end: at(...e) }) as unknown as Parameters<typeof layoutDay>[0][number];
const by = (laid: Laid[], id: string) => laid.find((l) => (l.item as unknown as { id: string }).id === id)!;

describe("layoutDay — widening into free columns", () => {
  it("a block that shares its column with others stays one column wide", () => {
    // slot 9–12 | A 9–10 | B 10:30–11:30 (A and B share a column; slot is the other)
    const laid = layoutDay([item("slot", [9], [12]), item("A", [9], [10]), item("B", [10, 30], [11, 30])], date);
    expect(by(laid, "slot").cols).toBe(2);
    expect(by(laid, "slot").span).toBe(1);
    expect(by(laid, "A").span).toBe(1);
  });

  it("an item grows into columns that are empty for its whole time", () => {
    // long 9–12, c1 9–10, c2 9–10 (3 columns); late 11–12 sits in col 1 and col 2 is free then
    const laid = layoutDay(
      [item("long", [9], [12]), item("c1", [9], [10]), item("c2", [9], [10]), item("late", [11], [12])],
      date,
    );
    expect(by(laid, "long").cols).toBe(3);
    expect(by(laid, "late").col).toBe(1);
    expect(by(laid, "late").span).toBe(2);
  });

  it("never widens over an item that overlaps it", () => {
    const laid = layoutDay([item("long", [9], [12]), item("c1", [9], [10]), item("c2", [11], [12])], date);
    const c1 = by(laid, "c1");
    // c1 and c2 are in the same column (they don't overlap), the long block is the other
    expect(c1.span).toBe(1);
    expect(laid.every((l) => l.col + l.span <= l.cols)).toBe(true);
  });

  it("an item alone fills the row", () => {
    expect(layoutDay([item("solo", [9], [10])], date)[0]).toMatchObject({ col: 0, cols: 1, span: 1 });
  });
});
