import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUNG,
  mountStage,
  newlyComplete,
  noteOwnAct,
  onMoment,
  ownActRecent,
  playMoment,
  resetOwnAct,
  stageMounted,
  weekLanded,
} from "../src/lib/moments";

// The top of the finish ladder (D-237): when a rung was reached, and that only
// the user's own hand plays one.

afterEach(() => {
  resetOwnAct();
  vi.useRealTimers();
});

describe("the rungs", () => {
  it("a landed week had committed projects and every one has a verdict", () => {
    expect(weekLanded(4, 4)).toBe(true);
    expect(weekLanded(3, 4)).toBe(false);
    expect(weekLanded(0, 0)).toBe(false);
  });

  it("the ladder climbs week → project → initiative", () => {
    expect(RUNG.week < RUNG.project && RUNG.project < RUNG.initiative).toBe(true);
  });
});

describe("newlyComplete — only a change is a finish", () => {
  it("a first read seeds and reports nothing (data arriving is not a finish)", () => {
    expect(newlyComplete(null, [{ id: "a", status: "complete" }])).toEqual([]);
  });

  it("reports what moved into complete, not what already was", () => {
    const prev = new Map([
      ["a", "in_progress"],
      ["b", "complete"],
    ]);
    expect(
      newlyComplete(prev, [
        { id: "a", status: "complete" },
        { id: "b", status: "complete" },
      ]),
    ).toEqual(["a"]);
  });

  it("a record that arrives already complete (an import, a sync) does not play", () => {
    expect(newlyComplete(new Map(), [{ id: "new", status: "complete" }])).toEqual([]);
  });
});

describe("only what you did", () => {
  it("no own act → nothing is recent", () => {
    expect(ownActRecent()).toBe(false);
  });

  it("an own act is recent for a few seconds, then it isn't", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 9));
    noteOwnAct();
    expect(ownActRecent()).toBe(true);
    vi.setSystemTime(new Date(2026, 10, 16, 9, 0, 3));
    expect(ownActRecent()).toBe(false);
  });
});

describe("the bus and the stage", () => {
  it("plays to every listener, and an unsubscribed one hears nothing", () => {
    const heard: string[] = [];
    const off = onMoment((m) => heard.push(m.kind));
    playMoment({ kind: "week", weekLabel: "Nov 16 – 22", before: 3, of: 4, pieces: [] });
    off();
    playMoment({ kind: "week", weekLabel: "Nov 16 – 22", before: 3, of: 4, pieces: [] });
    expect(heard).toEqual(["week"]);
  });

  it("the Seal knows when a stage will carry it — one stamp, not two", () => {
    expect(stageMounted()).toBe(false);
    const unmount = mountStage();
    expect(stageMounted()).toBe(true);
    unmount();
    expect(stageMounted()).toBe(false);
  });
});
