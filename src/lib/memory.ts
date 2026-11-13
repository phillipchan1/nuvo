// Memory — the client half (docs/memory.md). The detectors are pure and shared
// (`_shared/memory/rhythm.ts`); this file turns what they see into the words a
// person reads, in the app's one time vocabulary (`at` / `span`, D-122), and
// decides which section of Memory each observation belongs in.
//
// What's stored is only what you SAID — `user_settings.memory.answers`. An
// observation is recomputed every time and is never written down.

import { at, span } from "../components/mobile/dayPlan";
import type { Confidence, Observation } from "../../supabase/functions/_shared/memory/rhythm";

export type MemoryArea = "Time";

export interface MemoryWrite {
  /** What a Keep created, so Forget can take exactly that back. */
  kind: "hours" | "slot-series" | "task-series" | "none";
  seriesId?: string;
  before?: { work_start_minutes: number; work_end_minutes: number; dayEnds?: Record<number, number | null> };
}

export interface MemoryAnswer {
  key: string;
  answer: "kept" | "refused";
  /** ISO timestamp. */
  at: string;
  /** A refusal's expiry ('YYYY-MM-DD'); after it the pattern may be asked again. */
  until?: string | null;
  area: MemoryArea;
  statement: string;
  evidence: string;
  source: string;
  uses: string[];
  /** What Forget does, said when it was kept. */
  forget?: string;
  wrote?: MemoryWrite;
}

export interface MemoryState {
  /** Off = Nuvo uses what you kept but derives nothing new. Default on. */
  learning?: boolean;
  /** The Noticed items you've already been shown — the sidebar's dot is for the rest. */
  seenKeys?: string[];
  answers?: MemoryAnswer[];
  /** When "your week, as your calendar tells it" was shown — it's shown once (§5.3). */
  introducedAt?: string | null;
}

export type Section = "new" | "kept" | "watch" | "no";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WD_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const clock = (min: number) => {
  const d = new Date(2000, 0, 1, Math.floor(min / 60), min % 60);
  return d;
};
export const atMin = (m: number) => at(clock(m));
export const spanMin = (a: number, b: number) => span(clock(a), clock(b));

/** "Mon, Wed and Fri" */
export function dayList(days: number[], long = false): string {
  const names = days.map((d) => (long ? WD_LONG : WD)[d]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Group weekdays that share the same hours: "Monday to Thursday", "Friday". */
function hoursPhrase(days: { weekday: number; startMin: number; endMin: number }[]): string[] {
  const groups: { days: number[]; s: number; e: number }[] = [];
  for (const d of days) {
    const g = groups.find((x) => Math.abs(x.s - d.startMin) <= 30 && Math.abs(x.e - d.endMin) <= 30);
    if (g) g.days.push(d.weekday);
    else groups.push({ days: [d.weekday], s: d.startMin, e: d.endMin });
  }
  return groups.map((g) => {
    const contiguous = g.days.every((d, i) => i === 0 || d === g.days[i - 1] + 1);
    const label =
      g.days.length === 1
        ? WD_LONG[g.days[0]]
        : contiguous && g.days.length > 2
          ? `${WD_LONG[g.days[0]]} to ${WD_LONG[g.days[g.days.length - 1]]}`
          : dayList(g.days, true);
    return `${spanMin(g.s, g.e)} ${label}`;
  });
}

/** The day's most common hours — what the single working-hours span becomes. */
export function mainHours(days: { startMin: number; endMin: number }[]): { startMin: number; endMin: number } {
  const n = new Map<string, number>();
  days.forEach((d) => n.set(`${d.startMin}-${d.endMin}`, (n.get(`${d.startMin}-${d.endMin}`) ?? 0) + 1));
  const [k] = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  const [s, e] = k.split("-").map(Number);
  return { startMin: s, endMin: e };
}

export interface Described {
  title: string;
  statement: string;
  evidence: string;
  confidence: Confidence;
  source: string;
  uses: string[];
  keep: string;
  no: string;
  forget: string;
  need?: string;
}

const pct = (o: Observation) => `${o.hits} of ${o.of}`;

/**
 * Everything Memory says about one observation. `ctx` carries the names it
 * needs (a domain's name, the hours you have now) so every sentence is about
 * your account, never a template.
 */
export function describe(
  o: Observation,
  ctx: { domainName: (id: string | null) => string | null; currentHours: { startMin: number; endMin: number } },
): Described {
  const now = spanMin(ctx.currentHours.startMin, ctx.currentHours.endMin);
  const need = o.confidence === "watch" ? "Needs more weeks like these before Nuvo asks you about it." : undefined;
  switch (o.kind) {
    case "hours": {
      const main = mainHours(o.days);
      const early = o.days.filter((d) => main.endMin - d.endMin >= 30);
      const parts = hoursPhrase(o.days);
      return {
        title: "Working hours",
        statement: `You usually work ${parts.join(", and ")}.`,
        evidence: `${pct(o)} weekdays`,
        confidence: o.confidence,
        source: o.fromWork ? "From your calendar's work events" : "From your weekday calendar",
        uses: ["Capacity", "Plan the week"],
        keep: `Capacity and Plan the week use ${spanMin(main.startMin, main.endMin)} instead of ${now}.${
          early.length ? ` Plan the week also ends ${dayList(early.map((d) => d.weekday), true)} at ${atMin(early[0].endMin)}.` : ""
        }`,
        no: `Your hours stay ${now}. Nuvo stops reading them from your calendar for 8 weeks.`,
        forget: `Your hours go back to ${now}.`,
        need,
      };
    }
    case "habit": {
      const dom = ctx.domainName(o.domainId);
      const when = `${dayList(o.weekdays)} ${spanMin(o.startMin, o.endMin)}`;
      return {
        title: o.title,
        statement: `${o.title} is ${dayList(o.weekdays, true)}, ${spanMin(o.startMin, o.endMin)}.`,
        evidence: `${pct(o)} sessions`,
        confidence: o.confidence,
        source: o.fromSeries ? "From a repeating event on your calendar" : "From your calendar",
        uses: o.fromSeries ? [] : ["Schedule"],
        keep: o.fromSeries
          ? "It's already a repeating event on your calendar, so nothing is added. Nuvo remembers it as part of your week."
          : `A standing slot, ${o.title}, ${when}${dom ? `, counting toward ${dom}` : ""}. It holds the time on your Schedule.`,
        no: `Nuvo stops looking for ${o.title} at this time. It won't ask again for 8 weeks.`,
        forget: o.fromSeries ? "Nuvo forgets it. Your calendar is unchanged." : "The standing slot stops. Past ones stay where they were.",
        need,
      };
    }
    case "window":
      return {
        title: "Deep work",
        statement: `${dayList(o.weekdays, true)} ${spanMin(o.startMin, o.endMin)} has stayed open.`,
        evidence: `open in ${pct(o)} weeks`,
        confidence: o.confidence,
        source: "From your calendar",
        uses: ["Schedule"],
        keep: `A standing slot, Deep work, ${dayList(o.weekdays)} ${spanMin(o.startMin, o.endMin)}. It holds the time on your Schedule before meetings take it.`,
        no: `Nuvo stops offering that time for 8 weeks.`,
        forget: "The Deep work slot stops. Past ones stay where they were.",
        need,
      };
    case "repeat": {
      const cadence =
        o.cadence === "weekly"
          ? `every ${WD_LONG[o.weekday ?? 0]}`
          : o.cadence === "monthly-last-weekday"
            ? "on the last day of every month"
            : `on the ${ordinal(o.monthDay ?? 1)} of every month`;
      const written =
        o.cadence === "monthly-last-weekday" ? "on the last weekday of the month" : o.cadence === "weekly" ? `on ${WD_LONG[o.weekday ?? 0]}s` : "around the same date each month";
      return {
        title: o.title,
        statement: `You've written “${o.title}” by hand ${written}, ${o.hits} times.`,
        evidence: `${o.hits} ${o.cadence === "weekly" ? "weeks" : "months"} running`,
        confidence: o.confidence,
        source: "From tasks you wrote",
        uses: ["Repeating task"],
        keep: `A repeating task, “${o.title}”, ${cadence}. The ones you wrote stay as they are.`,
        no: `Nuvo stops suggesting it for 8 weeks.`,
        forget: "The series stops. The one already on your list stays.",
        need,
      };
    }
  }
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Which tab an observation belongs on, given what you've said. Null = don't show. */
export function sectionOf(o: Observation, answers: MemoryAnswer[], todayISO: string): Section | null {
  const a = answers.find((x) => x.key === o.key);
  if (a?.answer === "kept") return null; // shown from the answer itself, in "What Nuvo uses"
  if (a?.answer === "refused" && (!a.until || a.until > todayISO)) return null; // shown from the answer, in "You said no"
  return o.confidence === "watch" ? "watch" : "new";
}

export const addDaysISO = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
