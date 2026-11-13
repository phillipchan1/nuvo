import { describe, expect, it } from "vitest";
import {
  draftId,
  looksAlike,
  placeSteps,
  realOrder,
  reconcile,
  shiftIn,
  sizeFromHistory,
  sortOrderAt,
  toSteps,
  type ProposedStep,
} from "../src/lib/pathDraft";

const titles: Record<string, string> = { a: "Book the hall", b: "Write the roles list", c: "Send the invite" };
const titleOf = (id: string) => titles[id] ?? "";
const p = (title: string, after?: string): ProposedStep => ({ title, energy: "quick", durationMins: 30, after });

describe("placeSteps — drafted steps land among yours", () => {
  it("goes after the step it names, and chains the ones that name nothing", () => {
    const props = [p("Pull last year's list", "Book the hall"), p("Ask three leads", "Write the roles list"), p("Follow up")];
    const steps = toSteps(props, []);
    const l = placeSteps(["a", "b", "c"], titleOf, steps, props);
    expect(l).toEqual(["a", draftId(steps[0].key), "b", draftId(steps[1].key), draftId(steps[2].key), "c"]);
  });

  it("START puts it before every step of yours; matching ignores case and spacing", () => {
    const props = [p("First thing", "START"), p("After the invite", "  send THE invite ")];
    const steps = toSteps(props, []);
    const l = placeSteps(["a", "b", "c"], titleOf, steps, props);
    expect(l).toEqual([draftId(steps[0].key), "a", "b", "c", draftId(steps[1].key)]);
  });

  it("an unknown title (or none, first) goes to the end — never guesses a place", () => {
    const props = [p("Something", "A step that isn't there"), p("Next")];
    const steps = toSteps(props, []);
    const l = placeSteps(["a", "b"], titleOf, steps, props);
    expect(l).toEqual(["a", "b", draftId(steps[0].key), draftId(steps[1].key)]);
  });

  it("two drafts after the same step keep their order", () => {
    const props = [p("One", "Book the hall"), p("Two", "Book the hall")];
    const steps = toSteps(props, []);
    const l = placeSteps(["a", "b"], titleOf, steps, props);
    expect(l).toEqual(["a", draftId(steps[0].key), draftId(steps[1].key), "b"]);
  });

  it("an empty project just lists them", () => {
    const props = [p("One"), p("Two")];
    const steps = toSteps(props, []);
    expect(placeSteps([], titleOf, steps, props)).toEqual(steps.map((s) => draftId(s.key)));
  });
});

describe("sortOrderAt — a kept step takes the order between its real neighbours", () => {
  const order: Record<string, number> = { a: 1, b: 2, c: 2 };
  const of = (id: string) => order[id];
  it("halfway between", () => expect(sortOrderAt(["a", "draft:x", "b"], "draft:x", of)).toBe(1.5));
  it("skips other drafts to find the neighbours", () =>
    expect(sortOrderAt(["a", "draft:y", "draft:x", "draft:z", "b"], "draft:x", of)).toBe(1.5));
  it("one past the last, one before the first", () => {
    expect(sortOrderAt(["a", "draft:x"], "draft:x", of)).toBe(2);
    expect(sortOrderAt(["draft:x", "a"], "draft:x", of)).toBe(0);
  });
  it("equal neighbours still give a distinct order", () =>
    expect(sortOrderAt(["b", "draft:x", "c"], "draft:x", of)).toBeGreaterThan(2));
  it("no real rows at all uses its position", () => expect(sortOrderAt(["draft:w", "draft:x"], "draft:x", of)).toBe(2));
});

describe("sizes come from your finished work, or say they're estimates", () => {
  const finished = [
    { title: "Write the run of show", duration_minutes: 50 },
    { title: "Write run of show for Easter", duration_minutes: 70 },
    { title: "Write the newsletter", duration_minutes: 30 },
    { title: "Call the plumber", duration_minutes: null },
  ];
  it("two or more alike → their median, and the line says so", () => {
    const r = sizeFromHistory("Write the 20-minute run of show", 90, finished);
    expect(r.mins).toBe(60);
    expect(r.evidence.measured).toBe(true);
    expect(r.evidence.text).toBe("You've finished 2 like this, sized 50m–1h 10m");
  });
  it("fewer than two → the model's size stands and is labelled an estimate", () => {
    const r = sizeFromHistory("Book the caterer", 45, finished);
    expect(r).toEqual({ mins: 45, evidence: { text: "An estimate", measured: false } });
  });
  it("a new account has no history and gets estimates throughout", () =>
    expect(sizeFromHistory("Write the run of show", 40, []).evidence.measured).toBe(false));
  it("a shared verb alone is not enough", () => {
    expect(looksAlike("Write the roles list", "Write the newsletter")).toBe(false);
    expect(looksAlike("Write the run of show", "Write run of show for Easter")).toBe(true);
  });
});

describe("toSteps", () => {
  it("drops duplicate and blank versions, keeps the first as the default", () => {
    const [s] = toSteps(
      [{ title: "Outline it", energy: "deep", durationMins: 30, alternatives: [{ title: "outline it", durationMins: 20 }, { title: " ", durationMins: 5 }, { title: "Write it", durationMins: 60 }] }],
      [],
    );
    expect(s.versions.map((v) => v.title)).toEqual(["Outline it", "Write it"]);
    expect(s.version).toBe(0);
  });
});

describe("the layout", () => {
  it("reconcile drops vanished rows and drafts, appends new rows, keeps drafts in place", () => {
    expect(reconcile(["a", "draft:x", "b", "draft:y"], ["b", "c"], new Set(["x"]))).toEqual(["draft:x", "b", "c"]);
  });
  it("shiftIn moves one row and refuses past the ends", () => {
    expect(shiftIn(["a", "draft:x", "b"], "draft:x", 1)).toEqual(["a", "b", "draft:x"]);
    expect(shiftIn(["a", "draft:x"], "draft:x", 1)).toBeNull();
  });
  it("realOrder is only your rows", () => expect(realOrder(["draft:x", "b", "a"])).toEqual(["b", "a"]));
});
