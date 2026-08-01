import { describe, expect, it } from "vitest";
import {
  groupEvidenceByDay,
  instantToDayISO,
  boardWeekStartISO,
  type WeekEvidence,
  type WeekReceipt,
} from "../src/lib/weekEvidence";

function receipt(partial: Partial<WeekReceipt> & Pick<WeekReceipt, "id" | "label" | "mins" | "at">): WeekReceipt {
  return {
    kind: "task",
    domainId: "d1",
    domainName: "Work",
    domainColor: "#000",
    projectId: null,
    projectName: null,
    ...partial,
  };
}

function emptyEvidence(weekStartISO: string, receipts: WeekReceipt[] = []): WeekEvidence {
  return {
    weekStartISO,
    domains: [],
    receipts,
    priorDomainHours: {},
  };
}

describe("instantToDayISO", () => {
  it("maps a local midday instant to its calendar day", () => {
    // 2026-07-14 15:00 PDT = 2026-07-14 22:00 UTC
    expect(instantToDayISO("2026-07-14T22:00:00.000Z", "America/Los_Angeles")).toBe("2026-07-14");
  });

  it("rolls a late-night UTC instant back to the prior local day", () => {
    // 2026-07-15 02:00 UTC = 2026-07-14 19:00 PDT
    expect(instantToDayISO("2026-07-15T02:00:00.000Z", "America/Los_Angeles")).toBe("2026-07-14");
  });

  it("accepts a Date", () => {
    expect(instantToDayISO(new Date("2026-07-14T22:00:00.000Z"), "America/Los_Angeles")).toBe("2026-07-14");
  });
});

describe("groupEvidenceByDay", () => {
  const weekStart = "2026-07-13"; // Monday

  it("returns empty for a week with no receipts", () => {
    expect(groupEvidenceByDay(emptyEvidence(weekStart), weekStart)).toEqual([]);
  });

  it("groups mixed task/event receipts onto their local days and omits empty days", () => {
    const receipts = [
      receipt({ id: "t1", label: "Ship PR", mins: 90, at: "2026-07-14T18:00:00.000Z" }), // Tue PDT
      receipt({ id: "e1", label: "1:1", mins: 30, kind: "event", at: "2026-07-14T17:00:00.000Z" }), // Tue
      receipt({ id: "t2", label: "Write brief", mins: 60, at: "2026-07-16T20:00:00.000Z" }), // Thu
    ];
    const days = groupEvidenceByDay(emptyEvidence(weekStart, receipts), weekStart, "America/Los_Angeles");

    expect(days.map((d) => d.dayISO)).toEqual(["2026-07-14", "2026-07-16"]);
    expect(days[0].mins).toBe(120);
    expect(days[0].receipts.map((r) => r.id)).toEqual(["t1", "e1"]); // mins desc
    expect(days[1].mins).toBe(60);
  });

  it("includes 0-min activity receipts without inflating mins", () => {
    const receipts = [
      receipt({
        id: "a1",
        label: "Merged #12",
        mins: 0,
        kind: "activity",
        at: "2026-07-15T18:00:00.000Z",
      }),
      receipt({ id: "t1", label: "Review", mins: 45, at: "2026-07-15T19:00:00.000Z" }),
    ];
    const days = groupEvidenceByDay(emptyEvidence(weekStart, receipts), weekStart, "America/Los_Angeles");

    expect(days).toHaveLength(1);
    expect(days[0].dayISO).toBe("2026-07-15");
    expect(days[0].mins).toBe(45);
    expect(days[0].receipts).toHaveLength(2);
  });

  it("places a late-night UTC receipt on the prior local day", () => {
    // Wed 2026-07-15 02:00 UTC → Tue Jul 14 PDT
    const receipts = [
      receipt({ id: "t1", label: "Late commit", mins: 30, at: "2026-07-15T02:00:00.000Z" }),
    ];
    const days = groupEvidenceByDay(emptyEvidence(weekStart, receipts), weekStart, "America/Los_Angeles");

    expect(days).toHaveLength(1);
    expect(days[0].dayISO).toBe("2026-07-14");
  });

  it("drops receipts outside the Mon–Sun window", () => {
    const receipts = [
      receipt({ id: "t1", label: "Last week", mins: 30, at: "2026-07-12T18:00:00.000Z" }), // Sun before
      receipt({ id: "t2", label: "Next week", mins: 30, at: "2026-07-20T18:00:00.000Z" }), // Mon after
    ];
    expect(groupEvidenceByDay(emptyEvidence(weekStart, receipts), weekStart, "America/Los_Angeles")).toEqual([]);
  });

  it("skips receipts with no timestamp", () => {
    const receipts = [receipt({ id: "t1", label: "Orphan", mins: 30, at: null as unknown as string })];
    // Force at: undefined
    receipts[0].at = undefined;
    expect(groupEvidenceByDay(emptyEvidence(weekStart, receipts), weekStart)).toEqual([]);
  });

  it("includeEmpty returns all seven days including quiet ones", () => {
    const receipts = [
      receipt({ id: "t1", label: "One thing", mins: 30, at: "2026-07-14T18:00:00.000Z" }),
    ];
    const days = groupEvidenceByDay(emptyEvidence(weekStart, receipts), weekStart, "America/Los_Angeles", {
      includeEmpty: true,
    });
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.dayISO)).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
    ]);
    expect(days[1].receipts).toHaveLength(1);
    expect(days[0].receipts).toHaveLength(0);
    expect(days[0].mins).toBe(0);
  });
});

describe("boardWeekStartISO", () => {
  it("keeps Monday when week starts Monday", () => {
    expect(boardWeekStartISO("2026-07-13", 1)).toBe("2026-07-13");
  });

  it("snaps to the prior Sunday for Schedule-style boards", () => {
    // Planning Monday Jul 13 → calendar week opens Sun Jul 12
    expect(boardWeekStartISO("2026-07-13", 0)).toBe("2026-07-12");
  });
});
