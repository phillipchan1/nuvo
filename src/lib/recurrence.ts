// The recurrence engine — pure, synchronous, testable. Given a rule and an
// anchor it expands occurrence dates inside a window; it also humanizes a rule
// for the UI and translates one to a Google RRULE for native calendar events.
//
// Dates are plain 'YYYY-MM-DD' (the app lives in one timezone). Occurrence #1
// is always the anchor, so `max_count` stays correct no matter which window we
// expand — we count from the origin and only collect what falls in range.

import { addDays, addMonths } from "date-fns";
import { parseDateISO, toDateISO } from "./dates";

export type RecurrenceFreq = "daily" | "weekly" | "monthly";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number; // every N units (≥ 1)
  byweekday?: number[]; // 0=Sun … 6=Sat — weekly only
  bymonthday?: number | null; // 1..31 — monthly only (else the anchor's day)
  until?: string | null; // inclusive 'YYYY-MM-DD' end bound
  count?: number | null; // total-occurrence cap (counted from the anchor)
}

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WD_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

// Hard ceiling on iterations so a malformed rule can never spin forever.
const MAX_ITERS = 1500;

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Monday-relative week index so "every N weeks" is stable across the window. */
function startOfWeekSun(d: Date): Date {
  return addDays(d, -d.getDay());
}

/**
 * Expand a rule into occurrence dates (ISO) that fall within [fromISO, toISO]
 * (inclusive). Always reckons from the anchor so `count`/interval phase are
 * exact regardless of the requested window. `exdates` are removed.
 */
export function expandRule(
  rule: RecurrenceRule,
  anchorISO: string,
  fromISO: string,
  toISO: string,
  exdates: string[] = [],
): string[] {
  const anchor = parseDateISO(anchorISO);
  const from = parseDateISO(fromISO);
  const to = parseDateISO(toISO);
  const untilD = rule.until ? parseDateISO(rule.until) : null;
  const hardEnd = untilD && untilD < to ? untilD : to;
  const skip = new Set(exdates);

  const out: string[] = [];
  let ordinalCount = 0; // how many occurrences seen from the anchor
  const interval = Math.max(1, rule.interval || 1);

  const emit = (d: Date): "stop" | "ok" => {
    if (d < anchor) return "ok";
    ordinalCount += 1;
    if (rule.count && ordinalCount > rule.count) return "stop";
    if (d > hardEnd) return "stop";
    if (d >= from) {
      const iso = toDateISO(d);
      if (!skip.has(iso)) out.push(iso);
    }
    return "ok";
  };

  if (rule.freq === "daily") {
    let d = anchor;
    for (let i = 0; i < MAX_ITERS; i++) {
      if (emit(d) === "stop") break;
      d = addDays(d, interval);
      if (d > hardEnd) break;
    }
    return out;
  }

  if (rule.freq === "weekly") {
    const days = (rule.byweekday && rule.byweekday.length ? rule.byweekday : [anchor.getDay()])
      .slice()
      .sort((a, b) => a - b);
    const anchorWeek = startOfWeekSun(anchor);
    let week = anchorWeek;
    for (let i = 0; i < MAX_ITERS; i++) {
      const weekIdx = Math.round((week.getTime() - anchorWeek.getTime()) / (7 * 86_400_000));
      if (weekIdx % interval === 0) {
        let stopped = false;
        for (const wd of days) {
          const d = addDays(week, wd);
          if (emit(d) === "stop") { stopped = true; break; }
        }
        if (stopped) break;
      }
      week = addDays(week, 7);
      if (week > hardEnd) break;
    }
    return out;
  }

  // monthly — same day-of-month each interval; months without that day skip.
  const dom = rule.bymonthday ?? anchor.getDate();
  let month = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  for (let i = 0; i < MAX_ITERS; i++) {
    if (i % interval === 0) {
      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      if (dom <= daysInMonth) {
        const d = new Date(month.getFullYear(), month.getMonth(), dom);
        if (emit(d) === "stop") break;
      }
    }
    month = addMonths(month, 1);
    if (month > hardEnd) break;
  }
  return out;
}

/** A short, human label: "Every weekday", "Weekly on Tue", "Monthly on the 15th". */
export function describeRule(rule: RecurrenceRule, anchorISO?: string): string {
  const interval = Math.max(1, rule.interval || 1);
  let base: string;

  if (rule.freq === "daily") {
    base = interval === 1 ? "Every day" : `Every ${interval} days`;
  } else if (rule.freq === "weekly") {
    const days = rule.byweekday && rule.byweekday.length
      ? rule.byweekday
      : anchorISO
        ? [parseDateISO(anchorISO).getDay()]
        : [];
    if (interval === 1 && sameSet(days, WEEKDAYS)) base = "Every weekday";
    else if (interval === 1 && sameSet(days, WEEKEND)) base = "Every weekend";
    else {
      const lbl = days.slice().sort((a, b) => a - b).map((d) => WD_SHORT[d]).join(", ");
      base = interval === 1 ? `Weekly on ${lbl}` : `Every ${interval} weeks on ${lbl}`;
    }
  } else {
    const dom = rule.bymonthday ?? (anchorISO ? parseDateISO(anchorISO).getDate() : 1);
    base = interval === 1
      ? `Monthly on the ${ordinal(dom)}`
      : `Every ${interval} months on the ${ordinal(dom)}`;
  }

  if (rule.count) base += ` · ${rule.count}×`;
  else if (rule.until) base += ` · until ${toDateISO(parseDateISO(rule.until)).slice(5).replace("-", "/")}`;
  return base;
}

/** The contextual preset menu shown in the picker, derived from the anchor. */
export function presetsFor(anchorISO: string): { label: string; rule: RecurrenceRule | null }[] {
  const wd = parseDateISO(anchorISO).getDay();
  return [
    { label: "Does not repeat", rule: null },
    { label: "Every day", rule: { freq: "daily", interval: 1 } },
    { label: "Every weekday", rule: { freq: "weekly", interval: 1, byweekday: WEEKDAYS } },
    { label: `Weekly on ${WD_LONG[wd]}`, rule: { freq: "weekly", interval: 1, byweekday: [wd] } },
    { label: `Every 2 weeks on ${WD_SHORT[wd]}`, rule: { freq: "weekly", interval: 2, byweekday: [wd] } },
    { label: `Monthly on the ${ordinal(parseDateISO(anchorISO).getDate())}`, rule: { freq: "monthly", interval: 1 } },
  ];
}

/** Does `rule` match a given preset rule (used to highlight the active chip)? */
export function rulesEqual(a: RecurrenceRule | null, b: RecurrenceRule | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.freq === b.freq &&
    (a.interval || 1) === (b.interval || 1) &&
    sameSet(a.byweekday ?? [], b.byweekday ?? []) &&
    (a.bymonthday ?? null) === (b.bymonthday ?? null) &&
    (a.until ?? null) === (b.until ?? null) &&
    (a.count ?? null) === (b.count ?? null)
  );
}

export const WEEKDAY_LABELS = WD_SHORT;

/** Translate a rule to a Google Calendar RRULE line (for native event series). */
export function toGoogleRRULE(rule: RecurrenceRule): string[] {
  const parts: string[] = [`FREQ=${rule.freq.toUpperCase()}`];
  if ((rule.interval || 1) > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "weekly" && rule.byweekday?.length) {
    parts.push(`BYDAY=${rule.byweekday.slice().sort((a, b) => a - b).map((d) => WD_RRULE[d]).join(",")}`);
  }
  if (rule.freq === "monthly" && rule.bymonthday) parts.push(`BYMONTHDAY=${rule.bymonthday}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) {
    // End-of-day UTC so the final local occurrence is always included.
    const d = parseDateISO(rule.until);
    const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59));
    parts.push(`UNTIL=${u.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  }
  return [`RRULE:${parts.join(";")}`];
}
