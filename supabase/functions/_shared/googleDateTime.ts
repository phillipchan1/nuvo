/** Shift a Google Calendar `start` / `end` resource by a millisecond delta.
 *
 *  Google stores timed events two ways:
 *    - RFC3339 with an offset (`2026-08-04T09:00:00-07:00` or `…Z`)
 *    - naive civil time plus `timeZone` (`2026-08-04T09:00:00` + America/Los_Angeles)
 *
 *  `new Date("2026-08-04T09:00:00")` is the local time of *this* runtime, which
 *  on Deno Deploy is UTC — so treating a civil wall-clock as an instant silently
 *  moves the series by the account's offset, or Google rejects the PATCH. Shift
 *  civil times as civil times, and absolute instants as instants. */

export type GoogleDateResource = {
  dateTime?: string | null;
  date?: string | null;
  timeZone?: string | null;
};

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function civilFromUtcParts(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Shift a `YYYY-MM-DDTHH:MM:SS` civil clock, ignoring any trailing offset. */
export function shiftCivilDateTime(dateTime: string, deltaMs: number): string {
  const m = dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?/);
  if (!m) {
    const shifted = new Date(new Date(dateTime).getTime() + deltaMs);
    if (Number.isNaN(shifted.getTime())) return dateTime;
    return shifted.toISOString();
  }
  const [, y, mo, d, h, mi, s, frac = ""] = m;
  const ms = frac ? Math.round(parseFloat(`0${frac}`) * 1000) : 0;
  const civil = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms);
  return civilFromUtcParts(new Date(civil + deltaMs));
}

function hasOffset(dateTime: string): boolean {
  return /Z$|[+-]\d{2}:\d{2}$/.test(dateTime);
}

export function shiftGoogleDateResource(
  orig: GoogleDateResource | null | undefined,
  deltaMs: number,
): GoogleDateResource | null {
  if (!orig) return null;
  if (deltaMs === 0) return { ...orig };

  if (orig.date && !orig.dateTime) {
    const [y, mo, d] = orig.date.split("-").map(Number);
    if (!y || !mo || !d) return { ...orig };
    const next = new Date(Date.UTC(y, mo - 1, d) + deltaMs);
    return { date: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}` };
  }

  if (!orig.dateTime) return null;

  if (hasOffset(orig.dateTime)) {
    const shifted = new Date(new Date(orig.dateTime).getTime() + deltaMs);
    if (Number.isNaN(shifted.getTime())) return { ...orig };
    return {
      dateTime: shifted.toISOString(),
      ...(orig.timeZone ? { timeZone: orig.timeZone } : {}),
    };
  }

  return {
    dateTime: shiftCivilDateTime(orig.dateTime, deltaMs),
    ...(orig.timeZone ? { timeZone: orig.timeZone } : {}),
  };
}

/** Civil YYYY-MM-DD of a Google start/end resource. */
export function civilDateOf(res: GoogleDateResource | null | undefined): string | null {
  if (!res) return null;
  if (res.date) return res.date;
  if (!res.dateTime) return null;
  return res.dateTime.slice(0, 10);
}

function addUtcDays(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Timed ↔ all-day PATCH payload. Google merges partial `start`/`end` objects,
 * so converting a timed event to all-day without nulling `dateTime` leaves the
 * event timed — the inspector chip flipped, the grid didn't.
 */
export function googleStartEnd(
  isoStart: string,
  isoEnd: string,
  allDay: boolean,
): { start: GoogleDateResource; end: GoogleDateResource } {
  if (allDay) {
    return {
      start: { date: isoStart.slice(0, 10), dateTime: null, timeZone: null },
      end: { date: isoEnd.slice(0, 10), dateTime: null, timeZone: null },
    };
  }
  return {
    start: { date: null, dateTime: new Date(isoStart).toISOString() },
    end: { date: null, dateTime: new Date(isoEnd).toISOString() },
  };
}

/** Convert a series master's start/end to all-day, keeping its civil date.
 *  A same-day timed span becomes one exclusive-end calendar day. */
export function masterToAllDay(
  start: GoogleDateResource,
  end: GoogleDateResource,
): { start: GoogleDateResource; end: GoogleDateResource } {
  const startDate = civilDateOf(start);
  if (!startDate) return { start, end };
  let endDate = civilDateOf(end) ?? addUtcDays(startDate, 1);
  if (endDate <= startDate) endDate = addUtcDays(startDate, 1);
  return {
    start: { date: startDate, dateTime: null, timeZone: null },
    end: { date: endDate, dateTime: null, timeZone: null },
  };
}

/** Convert a series master's all-day span to a 9–10am timed block on that date. */
export function masterToTimed(
  start: GoogleDateResource,
): { start: GoogleDateResource; end: GoogleDateResource } {
  const startDate = civilDateOf(start);
  if (!startDate) {
    return { start, end: start };
  }
  const tz = start.timeZone ?? undefined;
  const timed = (hhmm: string): GoogleDateResource => ({
    date: null,
    dateTime: tz ? `${startDate}T${hhmm}:00` : `${startDate}T${hhmm}:00.000Z`,
    ...(tz ? { timeZone: tz } : {}),
  });
  return { start: timed("09:00"), end: timed("10:00") };
}

