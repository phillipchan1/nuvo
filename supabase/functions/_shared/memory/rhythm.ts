// Memory · Rhythm — what your calendar and your own writing say you usually do
// (docs/memory.md §5). Pure, local-day strings in, so the SPA and the agent can
// read the same rhythm. Its only import is the planning kernel's date math —
// the week a day is in is the kernel's rule, never this file's. Detectors
// propose; nothing here writes.

import { dayMs, isoOf, mondayOf } from "../planningRules.ts";
//
// Every observation carries its evidence and a confidence that decides WHERE it
// may appear (§4.2): "sure" and "fairly" can be asked; "watch" is only ever
// shown inside Memory. Thresholds are the honesty — a missed pattern costs
// nothing, a wrong one teaches you that Nuvo guesses.

export interface RhythmEvent {
  title: string;
  /** Local calendar day, 'YYYY-MM-DD'. */
  day: string;
  /** Minutes after local midnight. */
  startMin: number;
  endMin: number;
  /** The domain the event counts toward, when known. */
  domainId: string | null;
  /** Set when the event is an occurrence of a recurring calendar series. */
  seriesId: string | null;
}

export interface RhythmTask {
  title: string;
  /** Local day it was written, 'YYYY-MM-DD'. */
  createdDay: string;
}

export interface RhythmInput {
  /** Local today, 'YYYY-MM-DD'. The window is the WEEKS full weeks before this one. */
  today: string;
  events: RhythmEvent[];
  /** Tasks written by hand (not occurrences of a series). */
  tasks: RhythmTask[];
  /** Domains whose kind is work. Empty = unknown: fall back to the weekday calendar. */
  workDomainIds: string[];
  /** Titles that already repeat (a series exists) — never proposed again. */
  repeatingTitles: string[];
  /** The hours to look for open time inside, when no hours are detected. */
  fallbackHours: { startMin: number; endMin: number };
}

export type Confidence = "sure" | "fairly" | "watch";

export interface HoursDay {
  /** Monday = 0 … Sunday = 6. */
  weekday: number;
  startMin: number;
  endMin: number;
}

export type Observation =
  | { kind: "hours"; key: string; confidence: Confidence; pips: boolean[]; hits: number; of: number; days: HoursDay[]; fromWork: boolean }
  | {
      kind: "habit";
      key: string;
      confidence: Confidence;
      pips: boolean[];
      hits: number;
      of: number;
      title: string;
      weekdays: number[];
      startMin: number;
      endMin: number;
      domainId: string | null;
      /** Every occurrence came from one recurring calendar series: it is already
       *  protected time, so a slot would double-book it. */
      fromSeries: boolean;
    }
  | { kind: "window"; key: string; confidence: Confidence; pips: boolean[]; hits: number; of: number; weekdays: number[]; startMin: number; endMin: number }
  | { kind: "repeat"; key: string; confidence: Confidence; pips: boolean[]; hits: number; of: number; title: string; cadence: "weekly" | "monthly-last-weekday" | "monthly-date"; weekday: number | null; monthDay: number | null };

export const WEEKS = 8;
const DAY = 86_400_000;

const ms = dayMs;
const iso = isoOf;
/** Monday = 0 … Sunday = 6. */
export const weekdayOf = (day: string) => (new Date(ms(day)).getUTCDay() + 6) % 7;
export const normTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (m: number, to: number) => Math.round(m / to) * to;

/** The window: WEEKS full Monday-weeks ending the Sunday before `today`'s week. */
export function windowOf(today: string): { start: string; end: string; weekIndex: (day: string) => number } {
  const thisMonday = ms(mondayOf(today));
  const start = thisMonday - WEEKS * 7 * DAY;
  return {
    start: iso(start),
    end: iso(thisMonday),
    weekIndex: (day: string) => {
      const d = ms(day);
      return d < start || d >= thisMonday ? -1 : Math.floor((d - start) / (7 * DAY));
    },
  };
}

function confidenceOf(ratio: number, weeks: number, sure: number, fairly: number): Confidence | null {
  if (ratio >= sure && weeks >= 6) return "sure";
  if (ratio >= fairly && weeks >= 5) return "fairly";
  if (ratio >= 0.35 && weeks >= 3) return "watch";
  return null;
}

// ── habits: the same thing, same weekday(s), same time, most weeks ──────────────
function habits(input: RhythmInput, inWindow: (RhythmEvent & { w: number; wd: number })[]): Observation[] {
  const work = new Set(input.workDomainIds);
  const known = work.size > 0;
  // Outside work: a non-work domain when domains are known; otherwise only what
  // sits outside the working day or on a weekend, so a standup never reads as a habit.
  const candidate = inWindow.filter((e) =>
    known
      ? e.domainId != null && !work.has(e.domainId)
      : e.wd >= 5 || e.startMin < 8 * 60 || e.endMin > 18 * 60,
  );
  const byKey = new Map<string, (typeof candidate)[number][]>();
  for (const e of candidate) {
    const k = `${normTitle(e.title)}|${round(e.startMin, 30)}`;
    if (!normTitle(e.title)) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const out: Observation[] = [];
  for (const [k, list] of byKey) {
    const weeksByDay = new Map<number, Set<number>>();
    list.forEach((e) => weeksByDay.set(e.wd, (weeksByDay.get(e.wd) ?? new Set()).add(e.w)));
    // A weekday belongs to the habit when it held there in at least 3 weeks.
    const weekdays = [...weeksByDay.entries()].filter(([, ws]) => ws.size >= 3).map(([d]) => d).sort();
    if (!weekdays.length) continue;
    const hits = weekdays.reduce((n, d) => n + (weeksByDay.get(d)?.size ?? 0), 0);
    const of = weekdays.length * WEEKS;
    const pips = Array.from({ length: WEEKS }, (_, w) => weekdays.every((d) => weeksByDay.get(d)?.has(w)));
    const anyWeeks = new Set(list.map((e) => e.w)).size;
    const confidence = confidenceOf(hits / of, anyWeeks, 0.85, 0.6);
    if (!confidence) continue;
    const used = list.filter((e) => weekdays.includes(e.wd));
    const series = new Set(used.map((e) => e.seriesId));
    const domains = used.map((e) => e.domainId).filter((d): d is string => !!d);
    out.push({
      kind: "habit",
      key: `habit:${k}:${weekdays.join("")}`,
      confidence,
      pips,
      hits,
      of,
      title: used[used.length - 1].title.trim(),
      weekdays,
      startMin: round(median(used.map((e) => e.startMin)), 15),
      endMin: round(median(used.map((e) => e.endMin)), 15),
      domainId: domains.length ? mostCommon(domains) : null,
      fromSeries: series.size === 1 && !series.has(null),
    });
  }
  return out;
}

function mostCommon<T>(xs: T[]): T {
  const n = new Map<T, number>();
  xs.forEach((x) => n.set(x, (n.get(x) ?? 0) + 1));
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ── hours: when work starts and ends, per weekday ───────────────────────────────
function hours(input: RhythmInput, inWindow: (RhythmEvent & { w: number; wd: number })[], habitKeys: Set<string>): Observation | null {
  const work = new Set(input.workDomainIds);
  const fromWork = work.size > 0;
  const ev = inWindow.filter((e) =>
    e.wd < 5 &&
    (fromWork
      ? e.domainId != null && work.has(e.domainId)
      : e.startMin >= 7 * 60 && e.endMin <= 20 * 60 && !habitKeys.has(`${normTitle(e.title)}|${round(e.startMin, 30)}`)),
  );
  const perDay = new Map<string, { w: number; wd: number; s: number; e: number; n: number }>();
  for (const e of ev) {
    const cur = perDay.get(e.day);
    perDay.set(e.day, cur
      ? { ...cur, s: Math.min(cur.s, e.startMin), e: Math.max(cur.e, e.endMin), n: cur.n + 1 }
      : { w: e.w, wd: e.wd, s: e.startMin, e: e.endMin, n: 1 });
  }
  const days = [...perDay.values()].filter((d) => d.n >= 2);
  const weekQualifies = Array.from({ length: WEEKS }, (_, w) => days.filter((d) => d.w === w).length >= 3);
  const weeks = weekQualifies.filter(Boolean).length;
  if (weeks < 4) return null;
  const result: HoursDay[] = [];
  for (let wd = 0; wd < 5; wd++) {
    const these = days.filter((d) => d.wd === wd && weekQualifies[d.w]);
    if (these.length < 3) continue;
    result.push({ weekday: wd, startMin: round(median(these.map((d) => d.s)), 15), endMin: round(median(these.map((d) => d.e)), 15) });
  }
  if (result.length < 3) return null;
  const confidence: Confidence = weeks >= 7 ? "sure" : weeks >= 5 ? "fairly" : "watch";
  return {
    kind: "hours",
    key: "hours:" + result.map((d) => `${d.weekday}-${d.startMin}-${d.endMin}`).join(","),
    confidence,
    pips: weekQualifies,
    hits: days.filter((d) => weekQualifies[d.w]).length,
    of: weeks * 5,
    days: result,
    fromWork,
  };
}

// ── open windows: inside your hours, time nothing lands on ──────────────────────
function windows(input: RhythmInput, inWindow: (RhythmEvent & { w: number; wd: number })[], hrs: HoursDay[] | null): Observation[] {
  const STEP = 30;
  const found: { wd: number; s: number; e: number; open: number; counted: number; pips: boolean[] }[] = [];
  for (let wd = 0; wd < 5; wd++) {
    const h = hrs?.find((d) => d.weekday === wd) ?? (hrs ? null : { weekday: wd, ...input.fallbackHours });
    if (!h) continue;
    // Only weeks you were actually working that day count — a holiday is not "open".
    const evByWeek = new Map<number, (typeof inWindow)[number][]>();
    inWindow.filter((e) => e.wd === wd).forEach((e) => evByWeek.set(e.w, [...(evByWeek.get(e.w) ?? []), e]));
    const counted = [...evByWeek.entries()].filter(([, l]) => l.length >= 2).map(([w]) => w);
    if (counted.length < 5) continue;
    const openIn = (t: number) => counted.filter((w) => (evByWeek.get(w) ?? []).every((e) => e.endMin <= t || e.startMin >= t + STEP));
    // Walk the day in half hours, from an hour after you start to half an hour
    // before you stop (the edges of a day are not "open time"), keeping runs that
    // were open in at least 7 of every 8 counted weeks.
    let s0 = -1;
    let e0 = -1;
    let weeks = new Set<number>();
    const flush = () => {
      if (s0 >= 0 && e0 - s0 >= 90) {
        found.push({ wd, s: s0, e: e0, open: weeks.size, counted: counted.length, pips: Array.from({ length: WEEKS }, (_, w) => weeks.has(w)) });
      }
      s0 = -1;
    };
    for (let t = h.startMin + 60; t + STEP <= h.endMin - 30; t += STEP) {
      const open = openIn(t);
      if (open.length / counted.length >= 7 / 8) {
        if (s0 < 0) {
          s0 = t;
          weeks = new Set(open);
        } else weeks = new Set(open.filter((w) => weeks.has(w)));
        e0 = t + STEP;
      } else flush();
    }
    flush();
  }
  const byWin = new Map<string, typeof found>();
  found.forEach((f) => byWin.set(`${f.s}-${f.e}`, [...(byWin.get(`${f.s}-${f.e}`) ?? []), f]));
  // Windows that overlap in time are one fact about your week, not two. The
  // biggest (days × length) stands; an overlapping one that nearly coincides
  // (shares ≥75% of the longer) folds its days in, and any other is dropped.
  const len = (l: typeof found) => l[0].e - l[0].s;
  const groups = [...byWin.values()].filter((l) => l.length >= 2).sort((a, b) => b.length * len(b) - a.length * len(a));
  const merged: typeof found[] = [];
  for (const g of groups) {
    const host = merged.find((m) => m[0].s < g[0].e && g[0].s < m[0].e);
    if (!host) { merged.push(g); continue; }
    const s = Math.max(host[0].s, g[0].s);
    const e = Math.min(host[0].e, g[0].e);
    if (e - s < 0.75 * Math.max(len(host), len(g)) || e - s < 90) continue;
    const all = [...host, ...g].map((f) => ({ ...f, s, e })).sort((a, b) => a.wd - b.wd);
    merged.splice(merged.indexOf(host), 1, all);
  }
  const out: Observation[] = [];
  for (const list of merged) {
    const k = `${list[0].s}-${list[0].e}`;
    const ratio = Math.min(...list.map((f) => f.open / f.counted));
    const counted = Math.min(...list.map((f) => f.counted));
    const confidence: Confidence = ratio >= 1 && counted >= 6 ? "sure" : "fairly";
    out.push({
      kind: "window",
      key: `window:${k}:${list.map((f) => f.wd).join("")}`,
      confidence,
      pips: Array.from({ length: WEEKS }, (_, w) => list.every((f) => f.pips[w])),
      hits: Math.min(...list.map((f) => f.open)),
      of: counted,
      weekdays: list.map((f) => f.wd),
      startMin: list[0].s,
      endMin: list[0].e,
    });
  }
  return out;
}

// ── repeats: a task you keep writing by hand on a cadence ───────────────────────
const lastWeekdayOfMonth = (day: string) => {
  const d = ms(day);
  const wd = weekdayOf(day);
  if (wd >= 5) return false;
  const nextWorkday = d + (wd === 4 ? 3 : 1) * DAY;
  return new Date(nextWorkday).getUTCMonth() !== new Date(d).getUTCMonth();
};

function repeats(input: RhythmInput): Observation[] {
  const since = ms(input.today) - 200 * DAY;
  const skip = new Set(input.repeatingTitles.map(normTitle));
  const byTitle = new Map<string, RhythmTask[]>();
  input.tasks
    .filter((t) => ms(t.createdDay) >= since && normTitle(t.title) && !skip.has(normTitle(t.title)))
    .forEach((t) => byTitle.set(normTitle(t.title), [...(byTitle.get(normTitle(t.title)) ?? []), t]));
  const out: Observation[] = [];
  for (const [k, list] of byTitle) {
    if (list.length < 3) continue;
    const days = [...new Set(list.map((t) => t.createdDay))].sort();
    if (days.length < 3) continue;
    const gaps = days.slice(1).map((d, i) => (ms(d) - ms(days[i])) / DAY);
    const title = list[list.length - 1].title.trim();
    const recent = ms(input.today) - ms(days[days.length - 1]);
    const weekly = gaps.every((g) => g >= 6 && g <= 8) && recent <= 10 * DAY;
    const monthly = gaps.every((g) => g >= 26 && g <= 35) && recent <= 40 * DAY;
    let obs: Observation | null = null;
    const conf: Confidence = days.length >= 4 ? "sure" : "fairly";
    if (weekly) {
      const wd = mostCommon(days.map(weekdayOf));
      obs = { kind: "repeat", key: `repeat:${k}:weekly`, confidence: conf, pips: days.map(() => true), hits: days.length, of: days.length, title, cadence: "weekly", weekday: wd, monthDay: null };
    } else if (monthly) {
      const last = days.every(lastWeekdayOfMonth);
      const dom = days.map((d) => +d.slice(8, 10));
      const steady = Math.max(...dom) - Math.min(...dom) <= 2;
      if (last || steady) {
        obs = {
          kind: "repeat",
          key: `repeat:${k}:monthly`,
          confidence: conf,
          pips: days.map(() => true),
          hits: days.length,
          of: days.length,
          title,
          cadence: last ? "monthly-last-weekday" : "monthly-date",
          weekday: null,
          monthDay: last ? null : Math.round(median(dom)),
        };
      }
    }
    if (obs) out.push(obs);
  }
  return out;
}

/** Everything the rhythm chapter can see in this window. Order: hours, habits,
 *  windows, repeats — the order they matter to a plan. */
export function readRhythm(input: RhythmInput): Observation[] {
  const win = windowOf(input.today);
  const inWindow = input.events
    .map((e) => ({ ...e, w: win.weekIndex(e.day), wd: weekdayOf(e.day) }))
    .filter((e) => e.w >= 0 && e.endMin > e.startMin);
  const hab = habits(input, inWindow);
  const habitKeys = new Set(
    hab.flatMap((h) => (h.kind === "habit" ? [`${normTitle(h.title)}|${round(h.startMin, 30)}`] : [])),
  );
  const hrs = hours(input, inWindow, habitKeys);
  const hoursDays = hrs && hrs.kind === "hours" && hrs.confidence !== "watch" ? hrs.days : null;
  return [...(hrs ? [hrs] : []), ...hab, ...windows(input, inWindow, hoursDays), ...repeats(input)];
}
