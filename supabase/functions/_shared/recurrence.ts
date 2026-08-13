// Recurrence engine — pure, shared by the SPA and the agent.
// Date math uses UTC YYYY-MM-DD (same convention as planningRules).

import { dayMs, dayOfWeek, isoOf } from "./planningRules.ts";

const DAY_MS = 86_400_000;

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;
  byweekday?: number[];
  bymonthday?: number | null;
  /**
   * The nth weekday of the month (or of the anchor's month, yearly): 1–4, or
   * -1 for "last". Combined with a single `byweekday`, this is how the shapes
   * most real standing commitments take are expressed — "the last Friday of the
   * month", "the 2nd Tuesday". Mutually exclusive with `bymonthday`: a rule
   * carrying both would have two answers for the same question, so the picker
   * clears one when it sets the other and `expandRule` prefers `bysetpos`.
   */
  bysetpos?: number | null;
  /** 1–12, yearly only. Omitted = the anchor's own month. */
  bymonth?: number | null;
  until?: string | null;
  count?: number | null;
}

/** RRULE's BYSETPOS values we support, in the order a picker offers them. */
export const SETPOS_VALUES = [1, 2, 3, 4, -1] as const;
const SETPOS_LABEL: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WD_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

const MAX_ITERS = 1500;

/** How far ahead the client materializes occurrences. */
export const HORIZON_DAYS = 35;

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

function addDaysISO(iso: string, days: number): string {
  const base = dayMs(iso);
  if (Number.isNaN(base)) return iso;
  return isoOf(base + days * DAY_MS);
}

function addMonthsISO(iso: string, months: number): string {
  const base = dayMs(iso);
  if (Number.isNaN(base)) return iso;
  const d = new Date(base);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  return isoOf(Date.UTC(y, mo + months, day));
}

function domFromISO(iso: string): number {
  return new Date(dayMs(iso)).getUTCDate();
}

function monthFromISO(iso: string): number {
  return new Date(dayMs(iso)).getUTCMonth() + 1;
}

function startOfWeekSunISO(iso: string): string {
  const dow = dayOfWeek(iso);
  return isoOf(dayMs(iso) - dow * DAY_MS);
}

export function expandRule(
  rule: RecurrenceRule,
  anchorISO: string,
  fromISO: string,
  toISO: string,
  exdates: string[] = [],
): string[] {
  const anchorMs = dayMs(anchorISO);
  const fromMs = dayMs(fromISO);
  const toMs = dayMs(toISO);
  const untilMs = rule.until ? dayMs(rule.until) : null;
  const hardEndMs = untilMs != null && !Number.isNaN(untilMs) && untilMs < toMs ? untilMs : toMs;
  const skip = new Set(exdates);

  const out: string[] = [];
  let ordinalCount = 0;
  const interval = Math.max(1, rule.interval || 1);

  const emit = (iso: string): "stop" | "ok" => {
    const ms = dayMs(iso);
    if (Number.isNaN(ms) || ms < anchorMs) return "ok";
    ordinalCount += 1;
    if (rule.count && ordinalCount > rule.count) return "stop";
    if (ms > hardEndMs) return "stop";
    if (ms >= fromMs) {
      if (!skip.has(iso)) out.push(iso);
    }
    return "ok";
  };

  if (rule.freq === "daily") {
    let cur = anchorISO;
    for (let i = 0; i < MAX_ITERS; i++) {
      if (emit(cur) === "stop") break;
      cur = addDaysISO(cur, interval);
      if (dayMs(cur) > hardEndMs) break;
    }
    return out;
  }

  if (rule.freq === "weekly") {
    const days = (rule.byweekday && rule.byweekday.length ? rule.byweekday : [dayOfWeek(anchorISO)])
      .slice()
      .sort((a, b) => a - b);
    const anchorWeekMs = dayMs(startOfWeekSunISO(anchorISO));
    let weekMs = anchorWeekMs;
    for (let i = 0; i < MAX_ITERS; i++) {
      const weekIdx = Math.round((weekMs - anchorWeekMs) / (7 * DAY_MS));
      if (weekIdx % interval === 0) {
        let stopped = false;
        for (const wd of days) {
          const iso = isoOf(weekMs + wd * DAY_MS);
          if (emit(iso) === "stop") { stopped = true; break; }
        }
        if (stopped) break;
      }
      weekMs += 7 * DAY_MS;
      if (weekMs > hardEndMs) break;
    }
    return out;
  }

  const anchorDate = new Date(dayMs(anchorISO));

  if (rule.freq === "yearly") {
    // Same month + day as the anchor unless told otherwise, every `interval`
    // years — birthdays, renewals, anniversaries. With `bysetpos` it becomes
    // "the third Thursday of November" instead.
    const month = (rule.bymonth ?? anchorDate.getUTCMonth() + 1) - 1;
    const dom = rule.bymonthday ?? anchorDate.getUTCDate();
    let year = anchorDate.getUTCFullYear();
    for (let i = 0; i < MAX_ITERS; i++) {
      if (i % interval === 0) {
        const iso = rule.bysetpos
          ? nthWeekdayOfMonth(year, month, rule.byweekday?.[0] ?? dayOfWeek(anchorISO), rule.bysetpos)
          : dayOfMonthISO(year, month, dom);
        if (iso && emit(iso) === "stop") break;
      }
      year += 1;
      if (Date.UTC(year, month, 1) > hardEndMs) break;
    }
    return out;
  }

  const dom = rule.bymonthday ?? domFromISO(anchorISO);
  let monthISO = isoOf(Date.UTC(
    anchorDate.getUTCFullYear(),
    anchorDate.getUTCMonth(),
    1,
  ));
  for (let i = 0; i < MAX_ITERS; i++) {
    if (i % interval === 0) {
      const parts = /^(\d{4})-(\d{2})/.exec(monthISO);
      if (parts) {
        const y = Number(parts[1]);
        const mo = Number(parts[2]) - 1;
        const iso = rule.bysetpos
          ? nthWeekdayOfMonth(y, mo, rule.byweekday?.[0] ?? dayOfWeek(anchorISO), rule.bysetpos)
          : dayOfMonthISO(y, mo, dom);
        if (iso && emit(iso) === "stop") break;
      }
    }
    monthISO = addMonthsISO(monthISO, 1);
    if (dayMs(monthISO) > hardEndMs) break;
  }
  return out;
}

/** A day-of-month that exists — null for Feb 30, so a "31st" rule simply skips
 *  the short months rather than silently landing on the 1st of the next. */
function dayOfMonthISO(year: number, month: number, dom: number): string | null {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return dom <= daysInMonth ? isoOf(Date.UTC(year, month, dom)) : null;
}

/**
 * The nth `weekday` of a month — `pos` 1–4, or -1 for the last one.
 *
 * "Last Friday" is not "the 4th Friday": five-Friday months exist, and a rule
 * that quietly meant the fourth would drift a week eight times a year. So -1
 * counts back from the end rather than forward from the start. A 5th-weekday
 * request that the month can't satisfy returns null and is skipped.
 */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, pos: number): string | null {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (pos < 0) {
    const lastDow = new Date(Date.UTC(year, month, daysInMonth)).getUTCDay();
    const back = (lastDow - weekday + 7) % 7;
    const day = daysInMonth - back - (Math.abs(pos) - 1) * 7;
    return day >= 1 ? isoOf(Date.UTC(year, month, day)) : null;
  }
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const forward = (weekday - firstDow + 7) % 7;
  const day = 1 + forward + (pos - 1) * 7;
  return day <= daysInMonth ? isoOf(Date.UTC(year, month, day)) : null;
}

export function describeRule(rule: RecurrenceRule, anchorISO?: string): string {
  const interval = Math.max(1, rule.interval || 1);
  let base: string;

  if (rule.freq === "daily") {
    base = interval === 1 ? "Every day" : `Every ${interval} days`;
  } else if (rule.freq === "weekly") {
    const days = rule.byweekday && rule.byweekday.length
      ? rule.byweekday
      : anchorISO
        ? [dayOfWeek(anchorISO)]
        : [];
    if (interval === 1 && sameSet(days, WEEKDAYS)) base = "Every weekday";
    else if (interval === 1 && sameSet(days, WEEKEND)) base = "Every weekend";
    else {
      const lbl = days.slice().sort((a, b) => a - b).map((d) => WD_SHORT[d]).join(", ");
      base = interval === 1 ? `Weekly on ${lbl}` : `Every ${interval} weeks on ${lbl}`;
    }
  } else if (rule.bysetpos) {
    // "the last Friday" — the shape most standing commitments actually take,
    // and the one the picker could not express before.
    const wd = WD_LONG[rule.byweekday?.[0] ?? (anchorISO ? dayOfWeek(anchorISO) : 1)];
    const which = `${SETPOS_LABEL[rule.bysetpos] ?? ordinal(rule.bysetpos)} ${wd}`;
    if (rule.freq === "yearly") {
      const mo = MONTH_LONG[(rule.bymonth ?? (anchorISO ? monthFromISO(anchorISO) : 1)) - 1];
      base = interval === 1
        ? `Every year on the ${which} of ${mo}`
        : `Every ${interval} years on the ${which} of ${mo}`;
    } else {
      base = interval === 1
        ? `Monthly on the ${which}`
        : `Every ${interval} months on the ${which}`;
    }
  } else if (rule.freq === "yearly") {
    const mo = MONTH_LONG[(rule.bymonth ?? (anchorISO ? monthFromISO(anchorISO) : 1)) - 1];
    const dom = rule.bymonthday ?? (anchorISO ? domFromISO(anchorISO) : 1);
    base = interval === 1
      ? `Every year on ${mo} ${dom}`
      : `Every ${interval} years on ${mo} ${dom}`;
  } else {
    const dom = rule.bymonthday ?? (anchorISO ? domFromISO(anchorISO) : 1);
    base = interval === 1
      ? `Monthly on the ${ordinal(dom)}`
      : `Every ${interval} months on the ${ordinal(dom)}`;
  }

  if (rule.count) base += ` · ${rule.count}×`;
  else if (rule.until) base += ` · until ${rule.until.slice(5).replace("-", "/")}`;
  return base;
}

export function presetsFor(anchorISO: string): { label: string; rule: RecurrenceRule | null }[] {
  const wd = dayOfWeek(anchorISO);
  return [
    { label: "Does not repeat", rule: null },
    { label: "Every day", rule: { freq: "daily", interval: 1 } },
    { label: "Every weekday", rule: { freq: "weekly", interval: 1, byweekday: WEEKDAYS } },
    { label: `Weekly on ${WD_LONG[wd]}`, rule: { freq: "weekly", interval: 1, byweekday: [wd] } },
    { label: `Every 2 weeks on ${WD_SHORT[wd]}`, rule: { freq: "weekly", interval: 2, byweekday: [wd] } },
    { label: `Monthly on the ${ordinal(domFromISO(anchorISO))}`, rule: { freq: "monthly", interval: 1 } },
    {
      // The shape most standing commitments actually take, offered by name so
      // it doesn't need the custom controls to be discovered.
      label: `Monthly on the ${SETPOS_LABEL[setposOf(anchorISO)] ?? ordinal(setposOf(anchorISO))} ${WD_LONG[wd]}`,
      rule: { freq: "monthly", interval: 1, byweekday: [wd], bysetpos: setposOf(anchorISO) },
    },
    { label: `Annually on ${MONTH_LONG[monthFromISO(anchorISO) - 1]} ${domFromISO(anchorISO)}`, rule: { freq: "yearly", interval: 1 } },
  ];
}

/**
 * Which occurrence of its weekday the anchor is — 1st…4th, or -1 when it is the
 * LAST one in the month. Preferring "last" over "fourth" for a 4th-that-is-also-
 * last date is the honest read: someone anchoring on the 29th of a 29-day month
 * means the last one, and offering "fourth" would drift in longer months.
 */
export function setposOf(anchorISO: string): number {
  const d = new Date(dayMs(anchorISO));
  const dom = d.getUTCDate();
  const nth = Math.floor((dom - 1) / 7) + 1;
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return dom + 7 > daysInMonth ? -1 : nth;
}

export function rulesEqual(a: RecurrenceRule | null, b: RecurrenceRule | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.freq === b.freq &&
    (a.interval || 1) === (b.interval || 1) &&
    sameSet(a.byweekday ?? [], b.byweekday ?? []) &&
    (a.bymonthday ?? null) === (b.bymonthday ?? null) &&
    (a.bysetpos ?? null) === (b.bysetpos ?? null) &&
    (a.bymonth ?? null) === (b.bymonth ?? null) &&
    (a.until ?? null) === (b.until ?? null) &&
    (a.count ?? null) === (b.count ?? null)
  );
}

export const WEEKDAY_LABELS = WD_SHORT;

export function toGoogleRRULE(rule: RecurrenceRule): string[] {
  const parts: string[] = [`FREQ=${rule.freq.toUpperCase()}`];
  if ((rule.interval || 1) > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "weekly" && rule.byweekday?.length) {
    parts.push(`BYDAY=${rule.byweekday.slice().sort((a, b) => a - b).map((d) => WD_RRULE[d]).join(",")}`);
  }
  const positional = rule.freq === "monthly" || rule.freq === "yearly";
  if (positional && rule.bysetpos && rule.byweekday?.length) {
    // BYDAY + BYSETPOS, not the `BYDAY=-1FR` shorthand: both are legal, but the
    // pair is what every provider we read back from emits, and round-tripping
    // through one form keeps `fromGoogleRRULE` from having to know two.
    parts.push(`BYDAY=${WD_RRULE[rule.byweekday[0]]}`);
    parts.push(`BYSETPOS=${rule.bysetpos}`);
  } else if (positional && rule.bymonthday) {
    parts.push(`BYMONTHDAY=${rule.bymonthday}`);
  }
  if (rule.freq === "yearly" && rule.bymonth) parts.push(`BYMONTH=${rule.bymonth}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) {
    const ms = dayMs(rule.until);
    const u = new Date(ms + DAY_MS - 1000);
    parts.push(`UNTIL=${u.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  }
  return [`RRULE:${parts.join(";")}`];
}

const RRULE_WD: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/** Parse Google / iCalendar RRULE lines back into our RecurrenceRule shape. */
export function fromGoogleRRULE(lines: string[] | null | undefined): RecurrenceRule | null {
  if (!lines?.length) return null;
  const line = lines.find((l) => /^RRULE:/i.test(l) || /^FREQ=/i.test(l));
  if (!line) return null;
  const body = line.replace(/^RRULE:/i, "");
  const parts = new Map<string, string>();
  for (const piece of body.split(";")) {
    const i = piece.indexOf("=");
    if (i === -1) continue;
    parts.set(piece.slice(0, i).toUpperCase(), piece.slice(i + 1));
  }

  const freqRaw = parts.get("FREQ")?.toLowerCase();
  if (freqRaw !== "daily" && freqRaw !== "weekly" && freqRaw !== "monthly" && freqRaw !== "yearly") {
    return null;
  }

  const rule: RecurrenceRule = {
    freq: freqRaw,
    interval: Math.max(1, Number(parts.get("INTERVAL")) || 1),
  };

  const byday = parts.get("BYDAY");
  if (byday) {
    rule.byweekday = byday.split(",")
      .map((d) => RRULE_WD[d.trim().slice(-2).toUpperCase()])
      .filter((d): d is number => d !== undefined);
  }

  const bymonthday = parts.get("BYMONTHDAY");
  if (bymonthday) rule.bymonthday = Number(bymonthday) || null;

  // Two spellings of the same idea reach us: BYSETPOS alongside a plain BYDAY,
  // and the shorthand that folds the position into the day (`BYDAY=-1FR`).
  // Reading only the first is what made an inbound Google series lossy on an
  // ALL-scope edit — the position was dropped and the rule silently became
  // "every Friday". Both are normalized to `bysetpos` here.
  const bysetpos = parts.get("BYSETPOS");
  if (bysetpos) {
    const n = Number(bysetpos);
    if (Number.isFinite(n) && n !== 0) rule.bysetpos = n;
  } else if (byday) {
    const m = /^\s*(-?\d+)\s*(SU|MO|TU|WE|TH|FR|SA)\s*$/i.exec(byday);
    if (m) {
      rule.bysetpos = Number(m[1]);
      rule.byweekday = [RRULE_WD[m[2].toUpperCase()]];
    }
  }

  const bymonth = parts.get("BYMONTH");
  if (bymonth) {
    const n = Number(bymonth);
    if (n >= 1 && n <= 12) rule.bymonth = n;
  }

  const count = parts.get("COUNT");
  if (count) rule.count = Math.max(1, Number(count) || 1);

  const until = parts.get("UNTIL");
  if (until && !count) {
    const m = until.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) rule.until = `${m[1]}-${m[2]}-${m[3]}`;
  }

  return rule;
}

/** First occurrence on or after `afterISO`, searching up to ~2 years ahead. */
export function nextOccurrenceDate(
  rule: RecurrenceRule,
  anchorISO: string,
  afterISO: string,
  exdates: string[] = [],
): string | null {
  const horizon = addDaysISO(afterISO, 730);
  const dates = expandRule(rule, anchorISO, afterISO, horizon, exdates);
  return dates[0] ?? null;
}

export interface CadenceGroupMeta {
  key: string;
  label: string;
  sortOrder: number;
}

/** Section key + label for grouping upkeep series in the catalog UI. */
export function cadenceGroupKey(rule: RecurrenceRule): CadenceGroupMeta {
  const interval = Math.max(1, rule.interval || 1);
  if (rule.freq === "daily") {
    if (interval === 1) return { key: "daily", label: "Daily", sortOrder: 10 };
    return { key: `daily-${interval}`, label: `Every ${interval} days`, sortOrder: 11 + interval };
  }
  if (rule.freq === "weekly") {
    const days = rule.byweekday ?? [];
    if (interval === 1 && sameSet(days, WEEKDAYS)) {
      return { key: "weekday", label: "Every weekday", sortOrder: 20 };
    }
    if (interval === 1) return { key: "weekly", label: "Weekly", sortOrder: 30 };
    return { key: `weeks-${interval}`, label: `Every ${interval} weeks`, sortOrder: 40 + interval };
  }
  if (rule.freq === "yearly") {
    if (interval === 1) return { key: "yearly", label: "Yearly", sortOrder: 80 };
    return { key: `years-${interval}`, label: `Every ${interval} years`, sortOrder: 90 + interval };
  }
  if (interval === 1) return { key: "monthly", label: "Monthly", sortOrder: 50 };
  return { key: `months-${interval}`, label: `Every ${interval} months`, sortOrder: 60 + interval };
}

export interface RecurrenceSeriesRow {
  id: string;
  title: string;
  anchor_date: string;
  exdates: string[];
  freq: RecurrenceFreq;
  interval: number;
  byweekday: number[];
  bymonthday: number | null;
  bysetpos?: number | null;
  bymonth?: number | null;
}

export interface CadenceGroup<T extends RecurrenceSeriesRow = RecurrenceSeriesRow> {
  key: string;
  label: string;
  sortOrder: number;
  items: { series: T; nextDue: string | null; rowHint: string | null }[];
}

/** Group series by cadence; within each group sort by next due (soonest first). */
export function groupSeriesByCadence<T extends RecurrenceSeriesRow>(
  series: T[],
  todayISO: string,
): CadenceGroup<T>[] {
  const ruleOf = (s: T): RecurrenceRule => ({
    freq: s.freq,
    interval: s.interval,
    byweekday: s.byweekday?.length ? s.byweekday : undefined,
    bymonthday: s.bymonthday,
    bysetpos: s.bysetpos ?? null,
    bymonth: s.bymonth ?? null,
  });

  const buckets = new Map<string, CadenceGroup<T>>();

  for (const s of series) {
    const rule = ruleOf(s);
    const meta = cadenceGroupKey(rule);
    const nextDue = nextOccurrenceDate(rule, s.anchor_date, todayISO, s.exdates);
    let rowHint: string | null = null;
    if (meta.key === "weekly" && rule.byweekday?.length) {
      rowHint = rule.byweekday.slice().sort((a, b) => a - b).map((d) => WD_SHORT[d]).join(", ");
    } else if (meta.key.startsWith("weeks-") && rule.byweekday?.length) {
      rowHint = rule.byweekday.slice().sort((a, b) => a - b).map((d) => WD_SHORT[d]).join(", ");
    }

    const group = buckets.get(meta.key) ?? {
      key: meta.key,
      label: meta.label,
      sortOrder: meta.sortOrder,
      items: [],
    };
    group.items.push({ series: s, nextDue, rowHint });
    buckets.set(meta.key, group);
  }

  return [...buckets.values()]
    .map((g) => ({
      ...g,
      items: g.items.sort((a, b) => {
        if (!a.nextDue && !b.nextDue) return a.series.title.localeCompare(b.series.title);
        if (!a.nextDue) return 1;
        if (!b.nextDue) return -1;
        return a.nextDue.localeCompare(b.nextDue);
      }),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Parse recurrence phrases from capture text. Strips matched spans from input. */
export function parseRecurrencePhrase(input: string, refDateISO: string): {
  rule: RecurrenceRule | null;
  anchorDate: string | null;
  stripped: string;
} {
  let working = input;
  let anchorDate: string | null = null;

  const starting = working.match(/\bstarting\s+(today|tomorrow)\b/i);
  if (starting) {
    anchorDate = starting[1].toLowerCase() === "tomorrow" ? addDaysISO(refDateISO, 1) : refDateISO;
    working = working.replace(starting[0], "");
  }

  let rule: RecurrenceRule | null = null;

  const patterns: { re: RegExp; build: (n: number) => RecurrenceRule }[] = [
    { re: /\bevery\s+(\d+)\s+months?\b/i, build: (n) => ({ freq: "monthly", interval: n }) },
    { re: /\bevery\s+(\d+)\s+weeks?\b/i, build: (n) => ({ freq: "weekly", interval: n, byweekday: [dayOfWeek(anchorDate ?? refDateISO)] }) },
    { re: /\bevery\s+(\d+)\s+days?\b/i, build: (n) => ({ freq: "daily", interval: n }) },
    { re: /\bevery\s+month\b/i, build: () => ({ freq: "monthly", interval: 1 }) },
    { re: /\b(?:every\s+week|weekly)\b/i, build: () => ({ freq: "weekly", interval: 1, byweekday: [dayOfWeek(anchorDate ?? refDateISO)] }) },
    { re: /\b(?:every\s+day|daily)\b/i, build: () => ({ freq: "daily", interval: 1 }) },
  ];

  for (const { re, build } of patterns) {
    const m = working.match(re);
    if (m) {
      const n = m[1] ? Math.max(1, parseInt(m[1], 10)) : 1;
      rule = build(n);
      working = working.replace(m[0], "");
      break;
    }
  }

  if (!rule && /\b(?:recurring|reoccurring)\b/i.test(working)) {
    working = working.replace(/\b(?:recurring|reoccurring)\b/i, "");
  }

  return {
    rule,
    anchorDate,
    stripped: working.replace(/\s{2,}/g, " ").trim(),
  };
}
