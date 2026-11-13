import { describe, expect, it } from "vitest";
import { readRhythm, windowOf, type RhythmEvent, type RhythmInput } from "../supabase/functions/_shared/memory/rhythm";

// Fixture accounts that are NOT the builder's (docs/memory.md §10). Each test
// says what must not be claimed as much as what must.

const TODAY = "2026-11-13"; // a Friday; the window is the 8 weeks ending Sun Nov 9
const win = windowOf(TODAY);
const dayIn = (week: number, weekday: number) => {
  const t = Date.parse(win.start + "T00:00:00Z") + (week * 7 + weekday) * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};
const h = (x: number) => Math.round(x * 60);
const ev = (week: number, wd: number, s: number, e: number, title: string, domainId: string | null = null, seriesId: string | null = null): RhythmEvent => ({
  title,
  day: dayIn(week, wd),
  startMin: h(s),
  endMin: h(e),
  domainId,
  seriesId,
});
const base = (over: Partial<RhythmInput>): RhythmInput => ({
  today: TODAY,
  events: [],
  tasks: [],
  workDomainIds: [],
  repeatingTitles: [],
  fallbackHours: { startMin: 480, endMin: 990 },
  ...over,
});

/** A nine-to-five-thirty office worker, with meetings that never touch Tue/Thu afternoons. */
function office(): RhythmEvent[] {
  const out: RhythmEvent[] = [];
  for (let w = 0; w < 8; w++)
    for (let d = 0; d < 5; d++) {
      out.push(ev(w, d, 9, 9.5, "Standup", "work"));
      out.push(ev(w, d, 11, 12, "Review", "work"));
      if (d !== 1 && d !== 3) out.push(ev(w, d, 14, 15, "Client call", "work"));
      out.push(ev(w, d, 17, 17.5, "Wrap up", "work"));
    }
  return out;
}

describe("rhythm · empty and thin accounts", () => {
  it("an empty account says nothing at all", () => {
    expect(readRhythm(base({}))).toEqual([]);
  });

  it("three weeks of calendar is not enough to claim hours", () => {
    const events = office().filter((e) => e.day < dayIn(3, 0));
    expect(readRhythm(base({ events, workDomainIds: ["work"] })).find((o) => o.kind === "hours")).toBeUndefined();
  });
});

describe("rhythm · hours", () => {
  it("reads the working day from work events, sure after 8 full weeks", () => {
    const hours = readRhythm(base({ events: office(), workDomainIds: ["work"] })).find((o) => o.kind === "hours");
    expect(hours && hours.kind === "hours" && hours.confidence).toBe("sure");
    expect(hours && hours.kind === "hours" && hours.days.every((d) => d.startMin === 540 && d.endMin === 1050)).toBe(true);
  });

  it("a four-day week has no Friday hours", () => {
    const fourDay = office().filter((e) => {
      const wd = (new Date(e.day + "T00:00:00Z").getUTCDay() + 6) % 7;
      return wd !== 4;
    });
    const hours = readRhythm(base({ events: fourDay, workDomainIds: ["work"] })).find((o) => o.kind === "hours");
    expect(hours && hours.kind === "hours" && hours.days.map((d) => d.weekday)).toEqual([0, 1, 2, 3]);
  });
});

describe("rhythm · habits", () => {
  it("a gym habit three mornings a week, missed twice, is a sure habit outside work", () => {
    const events = office();
    for (let w = 0; w < 8; w++) [0, 2, 4].forEach((d) => { if (!(w === 2 && d === 2) && !(w === 5 && d === 4)) events.push(ev(w, d, 6, 7, "Gym", "training")); });
    const gym = readRhythm(base({ events, workDomainIds: ["work"] })).find((o) => o.kind === "habit");
    expect(gym && gym.kind === "habit" && [gym.title, gym.weekdays, gym.startMin, gym.endMin, gym.confidence]).toEqual(["Gym", [0, 2, 4], 360, 420, "sure"]);
    expect(gym && gym.kind === "habit" && `${gym.hits}/${gym.of}`).toBe("22/24");
  });

  it("a standup is never a habit when work is known", () => {
    expect(readRhythm(base({ events: office(), workDomainIds: ["work"] })).some((o) => o.kind === "habit")).toBe(false);
  });

  it("with no work domain, a nine o'clock standup still isn't read as a habit", () => {
    expect(readRhythm(base({ events: office().map((e) => ({ ...e, domainId: null })) })).some((o) => o.kind === "habit")).toBe(false);
  });

  it("one Sunday-morning habit only (church at 10)", () => {
    const events = Array.from({ length: 8 }, (_, w) => ev(w, 6, 10, 11.5, "Church", "community"));
    const obs = readRhythm(base({ events }));
    expect(obs.map((o) => o.kind)).toEqual(["habit"]);
  });

  it("a recurring calendar series is marked so Keep won't double-book it", () => {
    const events = Array.from({ length: 8 }, (_, w) => ev(w, 1, 19, 20, "Choir", "community", "series-1"));
    const choir = readRhythm(base({ events })).find((o) => o.kind === "habit");
    expect(choir && choir.kind === "habit" && choir.fromSeries).toBe(true);
  });

  it("twice in eight weeks is not a pattern", () => {
    const events = [ev(1, 2, 19, 20, "Pottery", "home"), ev(5, 2, 19, 20, "Pottery", "home")];
    expect(readRhythm(base({ events }))).toEqual([]);
  });
});

describe("rhythm · open windows", () => {
  it("finds Tue/Thu afternoons that stayed open, inside the hours", () => {
    const ws = readRhythm(base({ events: office(), workDomainIds: ["work"] })).filter((o) => o.kind === "window");
    const tt = ws.find((o) => o.kind === "window" && o.weekdays.join() === "1,3");
    expect(tt && tt.kind === "window" && [tt.startMin, tt.endMin, tt.confidence]).toEqual([720, 1020, "sure"]);
    // Mon/Wed/Fri's shorter 12–2 gap overlaps it, and isn't offered as a second window.
    expect(ws.length).toBe(1);
  });

  it("with no afternoon meetings anywhere, the window spans every weekday", () => {
    const thin = office().filter((e) => e.title !== "Client call");
    const w = readRhythm(base({ events: thin, workDomainIds: ["work"] })).find((o) => o.kind === "window");
    expect(w && w.kind === "window" && w.weekdays.length).toBe(5);
  });
});

describe("rhythm · repeats", () => {
  it("a card payment written by hand on the last weekday four months running", () => {
    const tasks = ["2026-07-31", "2026-08-31", "2026-09-30", "2026-10-30"].map((createdDay) => ({ title: "Pay the card balance", createdDay }));
    const r = readRhythm(base({ tasks })).find((o) => o.kind === "repeat");
    expect(r && r.kind === "repeat" && [r.cadence, r.confidence]).toEqual(["monthly-last-weekday", "sure"]);
  });

  it("never proposes a repeat that already repeats", () => {
    const tasks = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"].map((createdDay) => ({ title: "Water the plants", createdDay }));
    expect(readRhythm(base({ tasks, repeatingTitles: ["water the plants"] }))).toEqual([]);
  });

  it("irregular writing is not a cadence", () => {
    const tasks = ["2026-09-01", "2026-09-20", "2026-10-02", "2026-11-05"].map((createdDay) => ({ title: "Call mom", createdDay }));
    expect(readRhythm(base({ tasks }))).toEqual([]);
  });
});

describe("rhythm · days off don't count as open", () => {
  it("a weekday with no events in most weeks is not offered as open time", () => {
    // Only Mondays have meetings; the other weekdays are days off, not free afternoons.
    const events: RhythmEvent[] = [];
    for (let w = 0; w < 8; w++) [9, 11, 14, 17].forEach((s) => events.push(ev(w, 0, s, s + 0.5, "Meeting", "work")));
    expect(readRhythm(base({ events, workDomainIds: ["work"] })).some((o) => o.kind === "window")).toBe(false);
  });
});

describe("rhythm · overlapping windows are one fact", () => {
  it("Mon/Wed 11:30–2 and Tue/Thu 11:30–1:30 become one window across four days", () => {
    const events: RhythmEvent[] = [];
    for (let w = 0; w < 8; w++)
      for (let d = 0; d < 4; d++) {
        events.push(ev(w, d, 9, 11.5, "Classes", "work"));
        events.push(ev(w, d, d % 2 ? 13.5 : 14, 16, "Classes", "work"));
      }
    const ws = readRhythm(base({ events, workDomainIds: ["work"] })).filter((o) => o.kind === "window");
    expect(ws.length).toBe(1);
    expect(ws[0].kind === "window" && [ws[0].weekdays, ws[0].startMin, ws[0].endMin]).toEqual([[0, 1, 2, 3], 690, 810]);
  });
});
