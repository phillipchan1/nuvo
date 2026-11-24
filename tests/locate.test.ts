// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getLocate, locateTargetAt, locateTargetForKey, setLocate, subscribeLocate } from "../src/lib/locate";

// D-226: pointing at a rail row names what the Schedule rings.
describe("locate", () => {
  it("reads a crown project row and a task row", () => {
    document.body.innerHTML = `
      <div data-crown-key="p:proj1"><span id="pname">Name</span>
        <div data-crown-key="t1"><div data-row-task="t1"><span id="tname">Task</span></div></div>
      </div>
      <div data-row-task="t2"><b id="t2">x</b></div>`;
    expect(locateTargetAt(document.getElementById("pname"))).toEqual({ taskIds: [], projectId: "proj1" });
    // a task inside an open project is the task, not the project
    expect(locateTargetAt(document.getElementById("tname"))).toEqual({ taskIds: ["t1"] });
    expect(locateTargetAt(document.getElementById("t2"))).toEqual({ taskIds: ["t2"] });
    expect(locateTargetAt(document.body)).toBeNull();
  });

  it("maps a cursor key the same way", () => {
    expect(locateTargetForKey("p:abc")).toEqual({ taskIds: [], projectId: "abc" });
    expect(locateTargetForKey("t9")).toEqual({ taskIds: ["t9"] });
    expect(locateTargetForKey(null)).toBeNull();
  });

  it("only tells listeners when the target actually changes", () => {
    let n = 0;
    const off = subscribeLocate(() => n++);
    setLocate({ taskIds: ["a"] });
    setLocate({ taskIds: ["a"] });
    expect(n).toBe(1);
    setLocate({ taskIds: [], projectId: "p" });
    setLocate(null);
    expect(n).toBe(3);
    expect(getLocate()).toBeNull();
    off();
  });

  it("a different day or slot is a different target — the second Basketball isn't the first", () => {
    let n = 0;
    const off = subscribeLocate(() => n++);
    setLocate({ taskIds: ["b"], dayISO: "2026-11-24" });
    setLocate({ taskIds: ["b"], dayISO: "2026-11-24" });
    setLocate({ taskIds: ["b"], dayISO: "2026-11-25" });
    setLocate({ taskIds: [], slotIds: ["s1"], dayISO: "2026-11-25" });
    expect(n).toBe(3);
    setLocate(null);
    off();
  });
});
