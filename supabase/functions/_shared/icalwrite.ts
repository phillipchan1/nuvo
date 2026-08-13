// Build and patch iCalendar (VEVENT) text for CalDAV write-back.
//
// Deliberately small: we write times as UTC (`…Z`) so we never have to emit a
// VTIMEZONE. iCloud accepts UTC DTSTART/DTEND fine. Recurrence edits follow the
// same THIS/ALL model the Google write-back uses.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO string → iCalendar UTC stamp, YYYYMMDDTHHMMSSZ. */
export function toIcalUtc(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** ISO string → iCalendar DATE value, YYYYMMDD (local calendar day). */
export function toIcalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** A brand-new single or recurring event as a full VCALENDAR. */
export function buildEvent(opts: {
  uid: string;
  title: string;
  startISO: string;
  endISO: string;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  /** RRULE bodies, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]. */
  recurrence?: string[];
}): string {
  const now = toIcalUtc(new Date().toISOString());
  const dtStart = opts.allDay
    ? `DTSTART;VALUE=DATE:${toIcalDate(opts.startISO)}`
    : `DTSTART:${toIcalUtc(opts.startISO)}`;
  const dtEnd = opts.allDay
    ? `DTEND;VALUE=DATE:${toIcalDate(opts.endISO)}`
    : `DTEND:${toIcalUtc(opts.endISO)}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nuvo//CalDAV//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${now}`,
    dtStart,
    dtEnd,
    `SUMMARY:${escapeText(opts.title)}`,
    ...(opts.location ? [`LOCATION:${escapeText(opts.location)}`] : []),
    ...(opts.description ? [`DESCRIPTION:${escapeText(opts.description)}`] : []),
    ...(opts.recurrence ?? []).map((r) => (r.startsWith("RRULE") ? r : `RRULE:${r}`)),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Isolate the master VEVENT (the one without RECURRENCE-ID) from a VCALENDAR. */
function splitEvents(ics: string): { header: string; events: string[]; footer: string } {
  const first = ics.indexOf("BEGIN:VEVENT");
  const lastEnd = ics.lastIndexOf("END:VEVENT");
  if (first === -1 || lastEnd === -1) return { header: ics, events: [], footer: "" };
  const header = ics.slice(0, first);
  const footer = ics.slice(lastEnd + "END:VEVENT".length);
  const middle = ics.slice(first, lastEnd + "END:VEVENT".length);
  const events = middle.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
  return { header, events, footer };
}

function isMaster(vevent: string): boolean {
  return !/\bRECURRENCE-ID\b/i.test(vevent);
}

/** Replace (or drop) a single property line inside a VEVENT block. */
function setProp(vevent: string, name: string, value: string | null): string {
  const re = new RegExp(`^${name}(;[^:\\r\\n]*)?:.*$`, "im");
  if (value === null) return vevent.replace(new RegExp(`^${name}(;[^:\\r\\n]*)?:.*\\r?\\n`, "im"), "");
  if (re.test(vevent)) return vevent.replace(re, `${name}:${value}`);
  // Insert just after DTSTAMP (or UID) if the property is missing.
  return vevent.replace(/^(UID:.*|DTSTAMP:.*)$/im, `$&\r\n${name}:${value}`);
}

/** Swap DTSTART/DTEND between VALUE=DATE and UTC date-time forms. */
function setDateTimeProp(vevent: string, kind: "DTSTART" | "DTEND", iso: string, allDay: boolean): string {
  let v = vevent.replace(new RegExp(`^${kind}(;[^:\\r\\n]*)?:.*\\r?\\n`, "im"), "");
  const line = allDay
    ? `${kind};VALUE=DATE:${toIcalDate(iso)}`
    : `${kind}:${toIcalUtc(iso)}`;
  return v.replace(/^(UID:.*|DTSTAMP:.*)$/im, `$&\r\n${line}`);
}

/** Replace (or drop) RRULE lines on the master VEVENT. */
function setRecurrence(vevent: string, recurrence: string[] | null | undefined): string {
  let v = vevent.replace(/^RRULE:.*\r?\n/gim, "");
  if (!recurrence?.length) return v;
  const lines = recurrence.map((r) => (r.startsWith("RRULE") ? r : `RRULE:${r.replace(/^RRULE:/i, "")}`));
  return v.replace(/END:VEVENT\s*$/i, `${lines.join("\r\n")}\r\nEND:VEVENT`);
}

/** Patch the master event's title / start / end / location / notes in place.
 *  A null or empty location/description removes the property line. */
export function patchMaster(
  ics: string,
  patch: {
    title?: string;
    startISO?: string;
    endISO?: string;
    allDay?: boolean;
    location?: string | null;
    description?: string | null;
    /** RRULE lines, or null / [] to remove recurrence. */
    recurrence?: string[] | null;
  },
): string {
  const { header, events, footer } = splitEvents(ics);
  const out = events.map((ve) => {
    if (!isMaster(ve)) return ve;
    let v = ve;
    if (patch.title !== undefined) v = setProp(v, "SUMMARY", escapeText(patch.title));
    const allDay = patch.allDay ?? /\bDTSTART;VALUE=DATE\b/i.test(v);
    if (patch.startISO !== undefined) v = setDateTimeProp(v, "DTSTART", patch.startISO, allDay);
    if (patch.endISO !== undefined) v = setDateTimeProp(v, "DTEND", patch.endISO, allDay);
    if (patch.location !== undefined) v = setProp(v, "LOCATION", patch.location ? escapeText(patch.location) : null);
    if (patch.description !== undefined) v = setProp(v, "DESCRIPTION", patch.description ? escapeText(patch.description) : null);
    if (patch.recurrence !== undefined) v = setRecurrence(v, patch.recurrence);
    return v;
  });
  return header + out.join("\r\n") + footer;
}

/** Add an EXDATE to the master so a single occurrence disappears (delete THIS). */
export function addExdate(ics: string, occurrenceStartISO: string): string {
  const { header, events, footer } = splitEvents(ics);
  const stamp = toIcalUtc(occurrenceStartISO);
  const out = events.map((ve) => {
    if (!isMaster(ve)) return ve;
    return ve.replace(/END:VEVENT\s*$/i, `EXDATE:${stamp}\r\nEND:VEVENT`);
  });
  return header + out.join("\r\n") + footer;
}

/** Add or replace a per-occurrence override VEVENT (edit THIS of a series). */
export function upsertOverride(
  ics: string,
  occurrenceStartISO: string,
  patch: {
    title?: string;
    startISO?: string;
    endISO?: string;
    location?: string | null;
    description?: string | null;
  },
): string {
  const { header, events, footer } = splitEvents(ics);
  const master = events.find(isMaster);
  if (!master) return ics;
  const uid = master.match(/^UID:(.*)$/im)?.[1]?.trim() ?? crypto.randomUUID();
  const recId = toIcalUtc(occurrenceStartISO);

  const startISO = patch.startISO ?? occurrenceStartISO;
  // Default the override end to the master's original duration if not given.
  const dtstartLine = master.match(/^DTSTART(;[^:\r\n]*)?:(.*)$/im)?.[2] ?? "";
  const dtendLine = master.match(/^DTEND(;[^:\r\n]*)?:(.*)$/im)?.[2] ?? "";
  const durMs = dtstartLine && dtendLine
    ? Math.max(0, icalToDate(dtendLine).getTime() - icalToDate(dtstartLine).getTime())
    : 60 * 60_000;
  const endISO = patch.endISO ?? new Date(new Date(startISO).getTime() + durMs).toISOString();

  const override = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `RECURRENCE-ID:${recId}`,
    `DTSTAMP:${toIcalUtc(new Date().toISOString())}`,
    `DTSTART:${toIcalUtc(startISO)}`,
    `DTEND:${toIcalUtc(endISO)}`,
    ...(patch.title !== undefined ? [`SUMMARY:${escapeText(patch.title)}`] : []),
    ...(patch.location ? [`LOCATION:${escapeText(patch.location)}`] : []),
    ...(patch.description ? [`DESCRIPTION:${escapeText(patch.description)}`] : []),
    "END:VEVENT",
  ].join("\r\n");

  // Replace an existing override for this recurrence-id if present.
  const withoutExisting = events.filter(
    (ve) => !(new RegExp(`RECURRENCE-ID(;[^:\\r\\n]*)?:${recId}`, "i").test(ve)),
  );
  return header + [...withoutExisting, override].join("\r\n") + footer;
}

/** Shift the master event's start/end by a delta (ms) — used for "edit ALL" on a
 *  recurring series so every instance moves together. Optionally retitles. */
export function shiftMaster(ics: string, deltaMs: number, title?: string): string {
  const { header, events, footer } = splitEvents(ics);
  const out = events.map((ve) => {
    if (!isMaster(ve)) return ve;
    let v = ve;
    const ds = v.match(/^DTSTART(;[^:\r\n]*)?:(.*)$/im)?.[2];
    const de = v.match(/^DTEND(;[^:\r\n]*)?:(.*)$/im)?.[2];
    if (ds) v = setProp(v, "DTSTART", toIcalUtc(new Date(icalToDate(ds).getTime() + deltaMs).toISOString()));
    if (de) v = setProp(v, "DTEND", toIcalUtc(new Date(icalToDate(de).getTime() + deltaMs).toISOString()));
    if (title !== undefined) v = setProp(v, "SUMMARY", escapeText(title));
    return v;
  });
  return header + out.join("\r\n") + footer;
}

/** Parse an iCalendar date/date-time value into a JS Date (UTC-ish). */
function icalToDate(v: string): Date {
  const s = v.trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return new Date(s);
  const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
}
