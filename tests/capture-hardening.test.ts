/**
 * Capture and list-order bugs an audit proved, each pinned here so it stays
 * fixed. The grammar is `parseCapture` (src/lib/nlp.ts) and the one mapping
 * from words to a task is `draftFromCapture` — typed tokens > host context >
 * defaults. Reference clock: Monday 16 Nov 2026, 2pm, America/Los_Angeles.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { nlpReady, parseCapture } from "../src/lib/nlp";
import { draftFromCapture, type CaptureEnv } from "../src/lib/captureDraft";
import { expandRule } from "../supabase/functions/_shared/recurrence";
import { resolveDomainId } from "../src/lib/batch";
import { taskDomainId, type VerticalData } from "../src/lib/vertical";
import { placeBeside } from "../src/components/tasks/useTaskListKeys";
import { byManualOrder } from "../src/lib/taskOrder";
import type { Task } from "../src/lib/types";

beforeAll(async () => {
  await nlpReady;
});

const REF = new Date(2026, 10, 16, 14, 0); // Mon 16 Nov 2026, 2pm
const env: CaptureEnv = {
  labels: [],
  routeTargets: [],
  homeOfProject: () => null,
  homeOfInitiative: () => null,
  todayISO: "2026-11-16",
  defaultDurationMins: 30,
};
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const task = (p: ReturnType<typeof parseCapture>, raw: string, ctx = {}) => {
  const a = draftFromCapture(p, raw, ctx, env);
  if (a?.kind !== "task") throw new Error("expected a task");
  return a.input;
};

describe("durations", () => {
  it("decimal hours: '1.5h' is 90 minutes and leaves no '1.' in the title", () => {
    const p = parseCapture("fix bug 1.5h", REF);
    expect(p.durationMinutes).toBe(90);
    expect(p.title).toBe("fix bug");
    expect(parseCapture("fix 2.5 hours", REF).durationMinutes).toBe(150);
  });

  it("spelled-out minutes are a length, not 'in 90 minutes'", () => {
    const p = parseCapture("deep work 90 minutes", REF);
    expect(p.durationMinutes).toBe(90);
    expect(p.startTime).toBeNull();
    expect(p.doDate).toBeNull();
    expect(parseCapture("fix 45 minute bug", REF).durationMinutes).toBe(45);
    expect(parseCapture("stretch 10 mins", REF).durationMinutes).toBe(10);
  });

  it("'in 90 minutes' is still a when", () => {
    const p = parseCapture("call bob in 90 minutes", REF);
    expect(p.durationMinutes).toBeNull();
    expect(p.startTime?.getHours()).toBe(15);
    expect(p.startTime?.getMinutes()).toBe(30);
  });
});

describe("a clock with no am/pm", () => {
  it("'at 5' typed at 2pm is 5pm today, not 5am tomorrow", () => {
    const p = parseCapture("call mom at 5", REF);
    expect(p.doDate).toBe("2026-11-16");
    expect(p.startTime?.getHours()).toBe(17);
  });

  it("'at 3:30' keeps its minutes and comes forward to the afternoon", () => {
    const st = parseCapture("pick up kids at 3:30", REF).startTime!;
    expect([localDay(st), st.getHours(), st.getMinutes()]).toEqual(["2026-11-16", 15, 30]);
  });

  it("an hour still ahead this morning stays morning", () => {
    const early = new Date(2026, 10, 16, 6, 0);
    expect(parseCapture("call at 8", early).startTime?.getHours()).toBe(8);
  });

  it("on a named day, 1–7 read as afternoon and 8–11 as morning", () => {
    expect(parseCapture("tomorrow at 5", REF).startTime?.getHours()).toBe(17);
    expect(parseCapture("friday at 5", REF).startTime?.getHours()).toBe(17);
    expect(parseCapture("friday at 9", REF).startTime?.getHours()).toBe(9);
  });

  it("exact clocks stay exact", () => {
    expect(parseCapture("standup at 9am", REF).startTime?.getHours()).toBe(9);
    expect(parseCapture("call at 17:00", REF).startTime?.getHours()).toBe(17);
    const noon = parseCapture("lunch at noon", REF).startTime!;
    expect(noon.getHours()).toBe(12);
    const midnight = parseCapture("midnight backup", REF).startTime!;
    expect(midnight.getHours()).toBe(0);
    // a range carries its own meridiem
    const range = parseCapture("standup 9-9:30am", REF);
    expect(range.startTime?.getHours()).toBe(9);
    expect(range.durationMinutes).toBe(30);
  });
});

describe("a lone month name", () => {
  it("'march in the parade' is not March 1", () => {
    const p = parseCapture("march in the parade", REF);
    expect(p.doDate).toBeNull();
    expect(p.title).toBe("march in the parade");
  });

  it("'in march' and 'march 3' are still dates", () => {
    expect(parseCapture("pay taxes in march", REF).doDate).toBe("2027-03-01");
    expect(parseCapture("pay rent march 3", REF).doDate).toBe("2027-03-03");
    expect(parseCapture("pay taxes april", REF).doDate).toBe("2027-04-01");
  });
});

describe("repeats", () => {
  it("'every mon wed fri' repeats on all three days", () => {
    const p = parseCapture("gym every mon wed fri 7am", REF);
    expect(p.recurrence?.byweekday).toEqual([1, 3, 5]);
    expect(p.title).toBe("gym");
    expect(parseCapture("gym every mon, wed and fri", REF).recurrence?.byweekday).toEqual([1, 3, 5]);
  });

  it("a word that only starts like a day doesn't join the list", () => {
    const p = parseCapture("every monday sunrise walk", REF);
    expect(p.recurrence?.byweekday).toEqual([1]);
    expect(p.title).toBe("sunrise walk");
  });

  it("'weekly on friday' typed on a Monday repeats on Fridays", () => {
    const raw = "review weekly on friday";
    const a = draftFromCapture(parseCapture(raw, REF), raw, {}, env)!;
    if (a.kind !== "series") throw new Error("expected a series");
    expect(a.rule.byweekday).toEqual([5]);
    const dates = expandRule(a.rule, a.anchorISO, "2026-11-16", "2026-12-10");
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5)).toBe(true);
  });

  it("'every 2 weeks on thursday' and 'every other week tue' take the named day", () => {
    expect(parseCapture("every 2 weeks on thursday", REF).recurrence?.byweekday).toEqual([4]);
    expect(parseCapture("every other week tue", REF).recurrence?.byweekday).toEqual([2]);
    // no day named: still the anchor's own day
    expect(parseCapture("weekly sync", REF).recurrence?.byweekday).toEqual([1]);
  });
});

describe("draftFromCapture: the day and the clock agree", () => {
  it("a typed day moves a tapped clock onto that day", () => {
    // The door opened from a tap on Wed 18 Nov at 3pm; the words say tomorrow.
    const ctx = { doDate: "2026-11-18", startTime: new Date(2026, 10, 18, 15, 0), durationMinutes: 30 };
    const raw = "call bob tomorrow";
    const input = task(parseCapture(raw, REF), raw, ctx);
    expect(input.do_date).toBe("2026-11-17");
    const st = new Date(input.start_time!);
    expect([localDay(st), st.getHours()]).toEqual(["2026-11-17", 15]);
  });

  it("a bare clock lands on the day the host is showing", () => {
    const raw = "dentist 3pm";
    const p = parseCapture(raw, REF);
    expect(p.dayCertain).toBe(false);
    const input = task(p, raw, { doDate: "2026-11-19" });
    expect(input.do_date).toBe("2026-11-19");
    const st = new Date(input.start_time!);
    expect([localDay(st), st.getHours()]).toEqual(["2026-11-19", 15]);
  });

  it("a bare clock in a slot lands on the slot's day (outside the slot)", () => {
    const slot = { id: "s1", do_date: "2026-11-20", project_id: null, domain_id: null };
    const raw = "dentist 3pm";
    const input = task(parseCapture(raw, REF), raw, { slot });
    expect(input.do_date).toBe("2026-11-20");
    expect(input.slot_id).toBeNull();
    expect(localDay(new Date(input.start_time!))).toBe("2026-11-20");
  });

  it("a named day still beats the host's day, and no host means the parser's day", () => {
    const raw = "dentist friday 3pm";
    const p = parseCapture(raw, REF);
    expect(p.dayCertain).toBe(true);
    expect(task(p, raw, { doDate: "2026-11-19" }).do_date).toBe("2026-11-20");
    expect(task(parseCapture("dentist 3pm", REF), "dentist 3pm").do_date).toBe("2026-11-16");
  });
});

describe("the week batcher's domain (D-088)", () => {
  it("a re-homed project's task counts toward the project's domain, not the stale copy", () => {
    const data = { projects: [{ id: "p1", domainId: "NEW" }], initiatives: [], domains: [] } as unknown as VerticalData;
    const t = { id: "t1", project_id: "p1", initiative_id: null, domain_id: "OLD" } as Task;
    expect(resolveDomainId(data, t)).toBe("NEW");
    expect(resolveDomainId(data, t)).toBe(taskDomainId(data, t));
    // a loose task's own domain is authoritative
    expect(resolveDomainId(data, { ...t, project_id: null })).toBe("OLD");
  });
});

describe("add above / below inside a tied run", () => {
  const row = (id: string, created: string, sort = 9999) => ({ id, sort_order: sort, created_at: created, title: id }) as Task;
  const list = byManualOrder([row("A", "2026-11-01"), row("B", "2026-11-02"), row("C", "2026-11-03")]);
  const land = (where: "below" | "above", anchor: string) => {
    const placed = placeBeside(list, list.find((t) => t.id === anchor)!, where)!;
    const at = new Map(placed.spread.map((p) => [p.id, p.sort_order]));
    const spread = list.map((t) => ({ ...t, sort_order: at.get(t.id) ?? t.sort_order }));
    return byManualOrder([...spread, row("NEW", "2026-11-16", placed.sortOrder)]).map((r) => r.id);
  };

  it("'add below A' among fresh captures (all 9999) lands right below A", () => {
    expect(land("below", "A")).toEqual(["A", "NEW", "B", "C"]);
  });

  it("'add above C' lands right above C", () => {
    expect(land("above", "C")).toEqual(["A", "B", "NEW", "C"]);
  });

  it("distinct neighbours need no spread", () => {
    const ordered = [row("A", "x", 1), row("B", "x", 2)];
    expect(placeBeside(ordered, ordered[0], "below")).toEqual({ sortOrder: 1.5, spread: [] });
  });
});

describe("'today at N'", () => {
  it("is the next N o'clock still ahead today, never tomorrow", () => {
    const st = parseCapture("today at 9", REF).startTime!;
    expect([localDay(st), st.getHours()]).toEqual(["2026-11-16", 21]);
    const late = new Date(2026, 10, 16, 23, 30);
    expect(localDay(parseCapture("today at 9", late).startTime!)).toBe("2026-11-16");
  });
});
