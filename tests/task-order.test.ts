import { describe, expect, it } from "vitest";
import { orderPatches, shiftId, type Ordered } from "../src/lib/taskOrder";

const rows = (...vals: number[]): Ordered[] => vals.map((v, i) => ({ id: `t${i}`, sort_order: v }));
const apply = (list: Ordered[], patches: { id: string; sort_order: number }[]) => {
  const next = new Map(list.map((r) => [r.id, r.sort_order]));
  for (const p of patches) next.set(p.id, p.sort_order);
  return [...next.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
};

describe("orderPatches — a move is the smallest write", () => {
  it("moving one row down writes only that row", () => {
    const list = rows(10, 20, 30, 40);
    const want = ["t1", "t2", "t0", "t3"];
    const patches = orderPatches(list, want);
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe("t0");
    expect(apply(list, patches)).toEqual(want);
  });

  it("moving to either end writes one row", () => {
    const list = rows(10, 20, 30);
    for (const want of [["t2", "t0", "t1"], ["t1", "t2", "t0"]]) {
      const patches = orderPatches(list, want);
      expect(patches).toHaveLength(1);
      expect(apply(list, patches)).toEqual(want);
    }
  });

  it("an unchanged order writes nothing", () => {
    expect(orderPatches(rows(1, 2, 3), ["t0", "t1", "t2"])).toEqual([]);
  });

  it("ties can still express an order", () => {
    const list = rows(9999, 9999, 9999);
    const want = ["t2", "t0", "t1"];
    expect(apply(list, orderPatches(list, want))).toEqual(want);
  });

  it("never renumbers to 0..n — rows stay in the list's own range", () => {
    const list = rows(500, 500, 500, 500);
    const patches = orderPatches(list, ["t3", "t2", "t1", "t0"]);
    for (const p of patches) expect(p.sort_order).toBeGreaterThanOrEqual(497);
  });

  it("falls back to re-dealing when a gap has been split to nothing", () => {
    const list = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 1 + 1e-9 },
      { id: "c", sort_order: 2 },
    ];
    const want = ["a", "c", "b"];
    const patches = orderPatches(list, want);
    expect(apply(list, patches)).toEqual(want);
  });

  it("hundreds of repeated moves stay ordered", () => {
    let list = rows(0, 1, 2, 3, 4);
    let order = list.map((r) => r.id);
    for (let n = 0; n < 300; n++) {
      order = shiftId(order, order[4], -3) ?? order;
      const patches = orderPatches(list, order);
      const map = new Map(list.map((r) => [r.id, r.sort_order]));
      for (const p of patches) map.set(p.id, p.sort_order);
      list = [...map.entries()].map(([id, sort_order]) => ({ id, sort_order }));
      expect(apply(list, [])).toEqual(order);
    }
  });
});

describe("shiftId", () => {
  it("moves and clamps", () => {
    expect(shiftId(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(shiftId(["a", "b", "c"], "a", -1)).toBeNull();
    expect(shiftId(["a", "b", "c"], "c", 9)).toBeNull();
  });
});
