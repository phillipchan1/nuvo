// "This and following" on a Google series, as a plan — pure, so the suite can
// hold it to the same cases as the CalDAV split (icalwrite.splitSeries).
//
// Google's own UI does exactly this: the series master gets an UNTIL just
// before the chosen occurrence, and a NEW series starts at it carrying the
// edit. There is no API verb for it.
import { type GoogleDateResource, masterToAllDay, masterToTimed, shiftGoogleDateResource } from "./googleDateTime.ts";
import { capRRule, recountRRule, shiftRRuleDays } from "./recurrence.ts";
import { isUsableTimeZone, toIcalLocal } from "./icalTz.ts";

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function msOf(r: GoogleDateResource | null | undefined): number {
  if (!r) return NaN;
  if (r.dateTime) return Date.parse(r.dateTime);
  if (r.date) return Date.parse(`${r.date}T00:00:00Z`);
  return NaN;
}

function addDays(date: string, days: number): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface GoogleSplitPatch {
  title?: string;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
  recurrence?: string[] | null;
}

/**
 * `master` is the series master, `instance` the occurrence the user touched
 * (its `originalStartTime` names the slot), `current` that occurrence's row
 * times (the edit's delta is measured from them). `remaining` is the COUNT
 * left for the new series, when the rule has one.
 *
 * Returns null when the occurrence is the series' first: nothing precedes it,
 * so "this and following" is "all".
 */
export function planGoogleSplit(
  // deno-lint-ignore no-explicit-any
  master: any,
  // deno-lint-ignore no-explicit-any
  instance: any,
  current: { start_at: string; end_at: string },
  patch: GoogleSplitPatch | null,
  opts: { timeZone?: string | null; remaining?: number | null },
): { headRecurrence: string[]; tail: Record<string, unknown> | null; originalStartISO: string } | null {
  const lines: string[] = Array.isArray(master?.recurrence) ? master.recurrence : [];
  if (!lines.some((l) => /^RRULE:/i.test(l))) return null;
  const orig: GoogleDateResource = instance?.originalStartTime ?? instance?.start ?? {};
  const origMs = msOf(orig);
  if (!Number.isFinite(origMs) || origMs <= msOf(master.start)) return null;

  const allDay = Boolean(master.start?.date);
  // UNTIL is inclusive: the day before for an all-day series, else one second
  // before — and in UTC, which Google requires for a timed series.
  const until = allDay ? addDays(orig.date!, -1).replace(/-/g, "") : utcStamp(origMs - 1000);
  const headRecurrence = capRRule(lines, until);
  if (!patch) return { headRecurrence, tail: null, originalStartISO: new Date(origMs).toISOString() };

  const zone = master.start?.timeZone ?? (isUsableTimeZone(opts.timeZone) ? opts.timeZone : null) ?? "UTC";
  let start: GoogleDateResource;
  let end: GoogleDateResource;
  if (allDay) {
    const days = Math.max(1, Math.round((msOf(master.end) - msOf(master.start)) / DAY_MS));
    start = { date: orig.date! };
    end = { date: addDays(orig.date!, days) };
  } else {
    const dur = Math.max(0, msOf(master.end) - msOf(master.start));
    start = { dateTime: new Date(origMs).toISOString(), timeZone: zone };
    end = { dateTime: new Date(origMs + dur).toISOString(), timeZone: master.end?.timeZone ?? zone };
  }

  let dayDelta = 0;
  if (patch.all_day !== undefined) {
    const converted = patch.all_day ? masterToAllDay(start, end) : masterToTimed({ ...start, timeZone: zone });
    start = converted.start;
    end = converted.end;
  } else if (patch.start_at || patch.end_at) {
    const startDelta = patch.start_at ? Date.parse(patch.start_at) - Date.parse(current.start_at) : 0;
    const endDelta = patch.end_at ? Date.parse(patch.end_at) - Date.parse(current.end_at) : startDelta;
    const before = start;
    start = shiftGoogleDateResource(start, startDelta) ?? start;
    end = shiftGoogleDateResource(end, endDelta) ?? end;
    // Moving to another DAY moves the rule's days with it.
    const day = (r: GoogleDateResource) =>
      r.date
        ? Date.parse(`${r.date}T00:00:00Z`)
        : Date.parse(`${toIcalLocal(new Date(msOf(r)).toISOString(), zone).replace(/^(\d{4})(\d{2})(\d{2}).*$/, "$1-$2-$3")}T00:00:00Z`);
    dayDelta = Math.round((day(start) - day(before)) / DAY_MS);
  }

  let recurrence: string[];
  if (patch.recurrence !== undefined) {
    recurrence = patch.recurrence?.length ? patch.recurrence : [];
  } else {
    recurrence = opts.remaining != null ? recountRRule(lines, opts.remaining) : lines;
    recurrence = shiftRRuleDays(recurrence, dayDelta);
  }

  const conference = master.conferenceData?.conferenceId
    ? {
      conferenceData: {
        conferenceId: master.conferenceData.conferenceId,
        conferenceSolution: master.conferenceData.conferenceSolution,
        entryPoints: master.conferenceData.entryPoints,
      },
    }
    : {};
  const tail: Record<string, unknown> = {
    summary: patch.title ?? master.summary,
    ...(patch.description !== undefined ? { description: patch.description ?? "" } : master.description ? { description: master.description } : {}),
    ...(patch.location !== undefined ? { location: patch.location ?? "" } : master.location ? { location: master.location } : {}),
    start,
    end,
    ...(recurrence.length ? { recurrence } : {}),
    ...(master.attendees ? { attendees: master.attendees } : {}),
    ...(master.reminders ? { reminders: master.reminders } : {}),
    ...(master.colorId ? { colorId: master.colorId } : {}),
    ...(master.transparency ? { transparency: master.transparency } : {}),
    ...(master.visibility ? { visibility: master.visibility } : {}),
    ...conference,
  };
  return { headRecurrence, tail, originalStartISO: new Date(origMs).toISOString() };
}
