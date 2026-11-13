import { describe, expect, it } from "vitest";
import {
  appendGraded,
  drawnMinutes,
  gradeKept,
  GRADED_MAX,
  hoursSaid,
  keptAsDrafted,
  lastWeekOf,
  questionsLeft,
  type GradeIn,
} from "../src/lib/memoryGrade";
import { readMemoryFace, hoursFromKey, type MemoryItem } from "../src/lib/memoryRead";
import { blocksOf, chipOf, clauseOf, describe as describeObs, labelOf, sectionOf, type MemoryAnswer } from "../src/lib/memory";
import { readRhythm, windowOf, type Observation, type RhythmEvent } from "../supabase/functions/_shared/memory/rhythm";

// docs/memory.md §13.4: every proposal is a prediction, graded against what you
// did. These counts are shown to a person, so each is held to what it may and
// may NOT claim — a gated count must stay gated, never be filled in.

const TODAY = "2026-11-13"; // a Friday; last week is Nov 2–8

describe("the graded ring", () => {
  it("stamps, trims titles and keeps only the last 200", () => {
    const many: GradeIn[] = Array.from({ length: 230 }, (_, i) => ({ s: "path", o: "kept", t: `Step ${i}` }));
    const ring = appendGraded([], many, new Date("2026-11-13T10:00:00Z"));
    expect(ring).toHaveLength(GRADED_MAX);
    expect(ring[0].t).toBe("Step 30");
    expect(ring.every((g) => g.at === "2026-11-13T10:00:00.000Z")).toBe(true);
    expect(appendGraded([], [{ s: "path", o: "kept", t: "x".repeat(90) }])[0].t).toHaveLength(60);
  });
});

describe("a kept draft step is kept as drafted only if untouched", () => {
  const origin = { title: "Write the permission letter", durationMins: 45 };
  it("untouched", () => expect(gradeKept(origin, { ...origin }, 0)).toBe("kept"));
  it("renamed", () => expect(gradeKept(origin, { ...origin, title: "Write the letter" }, 0)).toBe("edited"));
  it("resized", () => expect(gradeKept(origin, { ...origin, durationMins: 30 }, 0)).toBe("edited"));
  it("another version chosen", () => expect(gradeKept(origin, { ...origin }, 1)).toBe("edited"));
});

describe("kept as drafted", () => {
  const ring = (outcomes: GradeIn["o"][]) => appendGraded([], outcomes.map((o) => ({ s: "path" as const, o })));
  it("stays gated under 20 resolved guesses, and says how many so far", () => {
    expect(keptAsDrafted(ring(Array(19).fill("kept")))).toEqual({ gated: true, soFar: 19, need: 20 });
  });
  it("ignored guesses aren't resolved: they count neither way", () => {
    const r = keptAsDrafted(ring([...Array(20).fill("ignored"), ...Array(10).fill("kept")]));
    expect(r.gated).toBe(true);
  });
  it("counts the last 20, and the 20 before them once there are", () => {
    const r = keptAsDrafted(ring([...Array(9).fill("kept"), ...Array(11).fill("edited"), ...Array(14).fill("kept"), ...Array(6).fill("dropped")]));
    expect(r).toEqual({ gated: false, kept: 14, of: 20, before: { kept: 9, of: 20 } });
  });
  it("another surface's guesses don't count toward drafts", () => {
    const q = appendGraded([], Array(25).fill({ s: "question", o: "kept" }));
    expect(keptAsDrafted(q).gated).toBe(true);
  });
});

describe("would have drawn it", () => {
  it("counts overlapping predictions once", () => {
    const d = drawnMinutes(
      [{ weekday: 0, startMin: 480, endMin: 600 }],
      [
        { weekday: 0, startMin: 450, endMin: 540 },
        { weekday: 0, startMin: 500, endMin: 560 },
      ],
    );
    expect(d).toEqual({ hit: 80, total: 120 });
  });
  it("a prediction on another day draws nothing", () => {
    expect(drawnMinutes([{ weekday: 1, startMin: 480, endMin: 600 }], [{ weekday: 0, startMin: 480, endMin: 600 }]).hit).toBe(0);
  });
  it("says hours plainly", () => {
    expect(hoursSaid(31 * 60 + 40)).toBe("31½");
    expect(hoursSaid(31 * 60 + 20)).toBe("31");
  });
  it("last week runs Monday to Sunday before this one", () => {
    expect(lastWeekOf(TODAY)).toEqual({ start: "2026-11-02", end: "2026-11-08" });
  });
});

describe("the question budget", () => {
  it("two answers this week spend it; last week's and ignored ones don't", () => {
    const at = (d: string) => `${d}T12:00:00`;
    const g = appendGraded([], [
      { s: "question", o: "kept", at: new Date(at("2026-11-06")).toISOString() },
      { s: "question", o: "ignored", at: new Date(at("2026-11-10")).toISOString() },
      { s: "path", o: "kept", at: new Date(at("2026-11-10")).toISOString() },
    ]);
    expect(questionsLeft(g, TODAY)).toBe(2);
    const spent = appendGraded(g, [
      { s: "question", o: "kept", at: new Date(at("2026-11-11")).toISOString() },
      { s: "question", o: "dropped", at: new Date(at("2026-11-12")).toISOString() },
    ]);
    expect(questionsLeft(spent, TODAY)).toBe(0);
  });
});

// ── the page's read, over a stranger's eight weeks (P16) ─────────────────────

const win = windowOf(TODAY);
const dayIn = (week: number, wd: number) => new Date(Date.parse(`${win.start}T00:00:00Z`) + (week * 7 + wd) * 86_400_000).toISOString().slice(0, 10);
const ev = (w: number, d: number, s: number, e: number, title: string, domainId: string): RhythmEvent => ({ title, day: dayIn(w, d), startMin: s * 60, endMin: e * 60, domainId, seriesId: null });

/** A teacher: school 8–3:30 on weekdays, a swim on Tuesday and Thursday evenings. */
function teacher(): RhythmEvent[] {
  const out: RhythmEvent[] = [];
  for (let w = 0; w < 8; w++) {
    for (let d = 0; d < 5; d++) {
      out.push(ev(w, d, 8, 9, "Homeroom", "school"));
      out.push(ev(w, d, 9, 15.5, "Classes", "school"));
    }
    out.push(ev(w, 1, 18.5, 19.5, "Swim", "swim"));
    out.push(ev(w, 3, 18.5, 19.5, "Swim", "swim"));
  }
  return out;
}

const ctx = { domainName: () => null, currentHours: { startMin: 480, endMin: 990 } };

function itemsFor(obs: Observation[], answers: MemoryAnswer[]): MemoryItem[] {
  return [
    ...obs.flatMap((o) => {
      const section = sectionOf(o, answers, TODAY);
      return section ? [{ key: o.key, section, area: "Time" as const, described: describeObs(o, ctx), observation: o, answer: null }] : [];
    }),
    ...answers.map((a) => ({
      key: a.key,
      section: a.answer === "kept" ? ("kept" as const) : ("no" as const),
      area: "Time" as const,
      described: { title: a.statement, statement: a.statement, evidence: a.evidence, confidence: "sure" as const, source: a.source, uses: a.uses, keep: "", no: "", forget: "" },
      observation: null,
      answer: a,
    })),
  ];
}

const kept = (o: Observation, at: string): MemoryAnswer => ({
  key: o.key, answer: "kept", at, area: "Time", statement: "", evidence: "", source: "", uses: [],
  clause: clauseOf(o, "kept"), chip: chipOf(o, "School"), blocks: blocksOf(o), label: labelOf(o, "School"), kind: o.kind,
});

describe("the page's read", () => {
  const events = teacher();
  const obs = readRhythm({ today: TODAY, events, tasks: [], workDomainIds: ["school"], repeatingTitles: [], fallbackHours: { startMin: 480, endMin: 990 } });
  const hours = obs.find((o) => o.kind === "hours")!;
  const face = (answers: MemoryAnswer[], workNames = ["School"], graded = undefined) =>
    readMemoryFace({ today: TODAY, items: itemsFor(obs, answers), observations: obs, answers, graded, workNames, events, learning: true });

  it("opens with what you said, then asks; nothing is kept so nothing is claimed as drawn", () => {
    const f = face([]);
    expect(f.portrait[0]).toMatchObject({ key: "said:work", state: "kept", chip: "School is paid work" });
    expect(f.portrait.slice(1).every((c) => c.state !== "kept")).toBe(true);
    expect(f.proof.drawn).toEqual({ gated: true, why: "kept" });
    expect(f.proof.keptAsDrafted.gated).toBe(true);
    expect(f.questions.length).toBeLessThanOrEqual(2);
  });

  it("no work domain said: the portrait doesn't invent one", () => {
    expect(face([], []).portrait.find((c) => c.key === "said:work")).toBeUndefined();
  });

  it("hours kept three weeks ago draw last week's school days", () => {
    const f = face([kept(hours, "2026-10-20T09:00:00.000Z")]);
    expect(f.portrait.find((c) => c.key === hours.key)?.state).toBe("kept");
    expect(f.proof.drawn.gated).toBe(false);
    if (!f.proof.drawn.gated) {
      expect(f.proof.drawn.total).toBe(5 * 7.5 * 60 + 2 * 60); // school + two swims
      expect(f.proof.drawn.hit).toBe(5 * 7.5 * 60); // the swims weren't kept
    }
  });

  it("something kept after last week began isn't a prediction of it", () => {
    expect(face([kept(hours, "2026-11-04T09:00:00.000Z")]).proof.drawn).toEqual({ gated: true, why: "kept" });
  });

  it("the week draws kept memories solid and the rest by their state", () => {
    const f = face([kept(hours, "2026-10-20T09:00:00.000Z")]);
    expect(f.week.filter((b) => b.key === hours.key).every((b) => b.state === "kept")).toBe(true);
    expect(f.week.some((b) => b.state !== "kept")).toBe(true);
  });

  it("an old kept answer without its shape still finds its hours in its key", () => {
    expect(hoursFromKey("hours:0-480-930,4-480-750")).toEqual([
      { weekday: 0, startMin: 480, endMin: 930 },
      { weekday: 4, startMin: 480, endMin: 750 },
    ]);
  });

  it("the budget spent this week leaves nothing to ask, and says how many wait", () => {
    const spent = appendGraded([], [
      { s: "question", o: "kept", at: "2026-11-10T12:00:00.000Z" },
      { s: "question", o: "dropped", at: "2026-11-11T12:00:00.000Z" },
    ]);
    const f = readMemoryFace({ today: TODAY, items: itemsFor(obs, []), observations: obs, answers: [], graded: spent, workNames: ["School"], events, learning: true });
    expect(f.questions).toHaveLength(0);
    expect(f.waiting).toBe(itemsFor(obs, []).filter((i) => i.section === "new").length);
  });
});
