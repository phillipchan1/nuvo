import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { claimKeys, keyOwner } from "../src/components/tasks/keyOwner";

/**
 * The Schedule's two panes speak one key grammar (D-158). The rule that keeps a
 * single ⌫ from acting in both: the keyboard belongs to the last pane pressed in.
 */
describe("keyOwner — the last pane pressed in owns the keys", () => {
  it("starts with the rail and moves with a claim", () => {
    claimKeys("rail");
    expect(keyOwner()).toBe("rail");
    claimKeys("grid");
    expect(keyOwner()).toBe("grid");
    claimKeys("rail");
  });

  const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

  it("both panes ask it before acting, and both claim it on a press", () => {
    const rail = read("src/components/LeftRail.tsx");
    const grid = read("src/components/CalendarPane.tsx");
    expect(rail).toMatch(/enabled: \(\) => railKeysOn && keyOwner\(\) === "rail"/);
    expect(rail).toContain('claimKeys("rail")');
    expect(grid).toMatch(/enabled: \(\) => gridKeysOn && keyOwner\(\) === "grid"/);
    expect(grid).toContain('claimKeys("grid")');
  });
});

/**
 * #32 — Esc mid-drag. FullCalendar can't be stopped, so every handler that would
 * write a drop asks the gesture first. Asserted on the source: a drop path that
 * forgets to ask is exactly how the release "still committed".
 */
describe("every drop asks whether the gesture was called off", () => {
  const SRC = readFileSync(resolve(__dirname, "../src/components/CalendarPane.tsx"), "utf8");
  const body = (name: string) => {
    const at = SRC.indexOf(`const ${name} = useStableHandler(`);
    expect(at, `${name} must exist`).toBeGreaterThan(-1);
    return SRC.slice(at, at + 1600);
  };

  it("eventReceive / eventDrop / eventResize take the cancel before writing", () => {
    for (const h of ["onReceive", "onDrop", "onResize"]) {
      const b = body(h);
      const take = b.indexOf("gestureRef.current?.take()");
      expect(take, `${h} must ask gestureRef.take()`).toBeGreaterThan(-1);
      for (const write of ["mutations.", "slotMutations.", "eventMutations."]) {
        const w = b.indexOf(write);
        if (w > -1) expect(take, `${h} asks before it writes`).toBeLessThan(w);
      }
    }
  });

  it("eventDragStop only peeks — it runs BEFORE eventDrop, which consumes it", () => {
    const b = body("onDragStop");
    expect(b).toContain("gestureRef.current?.cancelled");
    expect(b.slice(0, 600)).not.toContain("take()");
  });

  it("the rail's group is decided at pickup and dropped only by the drop that used it", () => {
    const clears = [...SRC.matchAll(/dragGroupRef\.current = null/g)].map((m) => m.index!);
    const receive = SRC.indexOf("const onReceive = useStableHandler(");
    const eventData = SRC.indexOf("eventData: (el) =>");
    for (const at of clears) {
      const inPickup = at > eventData && at < eventData + 2000;
      const inReceive = at > receive && at < receive + 2000;
      expect(inPickup || inReceive, "dragGroupRef cleared outside pickup / receive").toBe(true);
    }
  });
});
