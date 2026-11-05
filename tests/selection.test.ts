// The selection moves — pinned once so the rail and the phone can't disagree.
import { describe, expect, it } from "vitest";
import {
  coverage,
  pruneTo,
  rangeBetween,
  selectionClosesOverlay,
  toggleGroup,
  toggleId,
} from "../src/lib/selection";

const order = ["a", "b", "c", "d", "e"];

describe("toggleId", () => {
  it("adds, then removes, without mutating the input", () => {
    const base = new Set(["a"]);
    const added = toggleId(base, "b");
    expect([...added]).toEqual(["a", "b"]);
    expect([...base]).toEqual(["a"]);
    expect([...toggleId(added, "a")]).toEqual(["b"]);
  });
});

describe("rangeBetween", () => {
  it("runs from the anchor to the target in list order, either direction", () => {
    expect([...rangeBetween(order, "b", "d")!]).toEqual(["b", "c", "d"]);
    expect([...rangeBetween(order, "d", "b")!]).toEqual(["b", "c", "d"]);
  });
  it("is just the row when there is no anchor, or the anchor left the list", () => {
    expect([...rangeBetween(order, null, "c")!]).toEqual(["c"]);
    expect([...rangeBetween(order, "gone", "c")!]).toEqual(["c"]);
  });
  it("is null for a target that isn't in the list", () => {
    expect(rangeBetween(order, "a", "zzz")).toBeNull();
  });
});

describe("pruneTo", () => {
  it("returns the same set when every id is still real — so an effect can call it every render", () => {
    const ids = new Set(["a", "c"]);
    expect(pruneTo(ids, order)).toBe(ids);
  });
  it("drops the ids that vanished (a completed row, another tab)", () => {
    expect([...pruneTo(new Set(["a", "x", "c"]), order)]).toEqual(["a", "c"]);
  });
  it("can empty the selection", () => {
    expect(pruneTo(new Set(["x"]), order).size).toBe(0);
  });
  it("leaves an empty selection alone", () => {
    const none = new Set<string>();
    expect(pruneTo(none, order)).toBe(none);
  });
});

describe("coverage / toggleGroup — a slot header's mark", () => {
  const group = ["b", "c"];
  it("reads none · some · all", () => {
    expect(coverage(new Set(), group)).toBe("none");
    expect(coverage(new Set(["b"]), group)).toBe("some");
    expect(coverage(new Set(["b", "c", "z"]), group)).toBe("all");
    expect(coverage(new Set(["b"]), [])).toBe("none");
  });
  it("fills a partial group rather than emptying it, then a second tap takes it back out", () => {
    const partial = new Set(["a", "b"]);
    const filled = toggleGroup(partial, group);
    expect([...filled].sort()).toEqual(["a", "b", "c"]);
    const emptied = toggleGroup(filled, group);
    expect([...emptied]).toEqual(["a"]);
  });
});

describe("selectionClosesOverlay", () => {
  it("closes the one-thing popovers and nothing else", () => {
    expect(selectionClosesOverlay("task")).toBe(true);
    expect(selectionClosesOverlay("slot")).toBe(true);
    expect(selectionClosesOverlay("task-record")).toBe(true);
    expect(selectionClosesOverlay("none")).toBe(false);
    expect(selectionClosesOverlay("settings")).toBe(false);
    expect(selectionClosesOverlay("cmd")).toBe(false);
  });
});
