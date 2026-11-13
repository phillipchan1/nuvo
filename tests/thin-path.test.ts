import { describe, expect, it } from "vitest";
import { isThin, thinChip, thinPaths, type HeldSlot } from "../src/lib/thinPath";
import { NEAR_WEEKS, projectCardStatus, thinWord } from "../src/components/ondeck/deckStatus";
import { requestPathDraft, takePathDraft } from "../src/lib/draftIntent";
import type { OnDeckLane } from "../src/lib/onDeck";

// A stranger's account, not the builder's: one project with a sitting held, a
// few steps, nothing else (P16).
type P = { id: string; name: string; domainId: string; status: string };
type T = { projectId: string | null; status: string; durationMins: number };
const vertical = (projects: P[], tasks: T[]) => ({ projects, tasks }) as unknown as Parameters<typeof thinPaths>[0];
const slot = (project_id: string | null, mins: number, start = "2026-11-17T13:00:00.000Z"): HeldSlot => ({
  project_id,
  do_date: start.slice(0, 10),
  start_time: start,
  duration_minutes: mins,
});
const launch: P = { id: "p1", name: "Launch site", domainId: "d1", status: "in_progress" };

describe("thinPaths — time held, too little work in it (D-196)", () => {
  it("names a 3h sitting holding 20m of work", () => {
    const out = thinPaths(vertical([launch], [{ projectId: "p1", status: "ready", durationMins: 20 }]), [slot("p1", 180)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ projectId: "p1", heldMins: 180, workMins: 20, openSteps: 1 });
    expect(thinChip(out[0])).toBe("3h held · 20m of work");
  });

  it("is quiet when the block is roomy but not thin, or short", () => {
    // 3h held, 1h40m of work: over half — a roomy block is not a problem
    expect(thinPaths(vertical([launch], [{ projectId: "p1", status: "ready", durationMins: 100 }]), [slot("p1", 180)])).toEqual([]);
    // 45m held, nothing in it: a quick sitting, not a block to fill
    expect(thinPaths(vertical([launch], []), [slot("p1", 45)])).toEqual([]);
    // 90m held, 30m of work: under half, but only 60m short — fires; 40m of work: 50m short, quiet
    expect(isThin(90, 30)).toBe(true);
    expect(isThin(90, 46)).toBe(false);
  });

  it("sums every slot the project holds, and points at the earliest", () => {
    const out = thinPaths(vertical([launch], []), [slot("p1", 60, "2026-11-19T09:00:00.000Z"), slot("p1", 90, "2026-11-17T13:00:00.000Z")]);
    expect(out[0].heldMins).toBe(150);
    expect(out[0].first.startISO).toBe("2026-11-17T13:00:00.000Z");
    expect(thinChip(out[0])).toBe("2h 30m held · no steps");
  });

  it("counts only open steps, and never speaks for a shipped, dropped or parked project", () => {
    const tasks = [
      { projectId: "p1", status: "done", durationMins: 120 },
      { projectId: "p1", status: "ready", durationMins: 15 },
    ];
    expect(thinPaths(vertical([launch], tasks), [slot("p1", 180)])[0].workMins).toBe(15);
    for (const status of ["complete", "cancelled", "waiting"])
      expect(thinPaths(vertical([{ ...launch, status }], []), [slot("p1", 180)])).toEqual([]);
  });

  it("an account with no slots — every new one — sees nothing (P7)", () => {
    expect(thinPaths(vertical([launch], []), [])).toEqual([]);
    expect(thinPaths(vertical([launch], []), [slot(null, 240)])).toEqual([]);
  });
});

describe("the deck card's word (D-196)", () => {
  const lane = (startWeekIdx: number, extra: Partial<OnDeckLane> = {}): OnDeckLane =>
    ({
      project: launch,
      pace: { read: "on_pace", driftDays: null },
      gaps: [{ label: "no steps" }],
      state: "needs_shaping",
      axes: { defined: true, planned: false, fits: true },
      readyCount: 2,
      readyTier: "grooming",
      startWeekIdx,
      dueWeekIdx: startWeekIdx,
      ...extra,
    }) as unknown as OnDeckLane;

  it("says the thin path's two facts when time is held", () => {
    expect(projectCardStatus(lane(0), { heldMins: 180, workMins: 20 } as never)).toEqual({ label: "20m of 3h held", tone: "caution" });
    expect(thinWord({ heldMins: 120, workMins: 0 })).toBe("no steps · 2h held");
  });

  it("keeps a gap word for the next two weeks and goes quiet past them", () => {
    expect(projectCardStatus(lane(0))?.label).toBe("no steps");
    expect(projectCardStatus(lane(NEAR_WEEKS - 1))?.label).toBe("no steps");
    expect(projectCardStatus(lane(NEAR_WEEKS))).toBeNull();
    // a far-out project that genuinely won't fit still says so — that's a fact about time, not grooming
    expect(projectCardStatus(lane(NEAR_WEEKS, { axes: { defined: true, planned: true, fits: false } as never }))?.label).toBe("won't fit");
  });
});

describe("draftIntent — the mark opens the record with the draft running", () => {
  it("fires once, for the project asked about", () => {
    requestPathDraft("p1");
    expect(takePathDraft("p2")).toBe(false);
    expect(takePathDraft("p1")).toBe(true);
    expect(takePathDraft("p1")).toBe(false);
  });
});
