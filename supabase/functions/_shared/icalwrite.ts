// Build and patch iCalendar (VEVENT) text for CalDAV write-back.
//
// A single event may be written in UTC (`…Z`). A SERIES may not: RFC 5545
// expands BYDAY and the weekly step in DTSTART's zone, so a UTC-anchored "every
// Wednesday 6pm Pacific" landed on Tuesday evenings and slid an hour at DST.
// Given the zone it was made in, a series is written `DTSTART;TZID=…` with a
// VTIMEZONE (icalTz.ts), and an existing TZID is always kept. Occurrence
// identities (RECURRENCE-ID / EXDATE) are written in the master's own form —
// that is what a CalDAV server and ical.js match an override against.
// Recurrence edits follow the same THIS/ALL model the Google write-back uses.
import { buildVtimezone, isUsableTimeZone, localIcalToMs, toIcalLocal } from "./icalTz.ts";
import { capRRule, recountRRule, rruleCount, shiftRRuleDays } from "./recurrence.ts";

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
  /** IANA zone the event was made in. A timed event is anchored to it (TZID +
   *  VTIMEZONE) so a series repeats on the local weekday across DST. */
  timeZone?: string | null;
}): string {
  const now = toIcalUtc(new Date().toISOString());
  const zone = !opts.allDay && isUsableTimeZone(opts.timeZone) ? opts.timeZone : null;
  const dtStart = opts.allDay
    ? `DTSTART;VALUE=DATE:${toIcalDate(opts.startISO)}`
    : zone
    ? `DTSTART;TZID=${zone}:${toIcalLocal(opts.startISO, zone)}`
    : `DTSTART:${toIcalUtc(opts.startISO)}`;
  const dtEnd = opts.allDay
    ? `DTEND;VALUE=DATE:${toIcalDate(opts.endISO)}`
    : zone
    ? `DTEND;TZID=${zone}:${toIcalLocal(opts.endISO, zone)}`
    : `DTEND:${toIcalUtc(opts.endISO)}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nuvo//CalDAV//EN",
    "CALSCALE:GREGORIAN",
    ...(zone ? [buildVtimezone(zone, opts.startISO)] : []),
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

/** RFC 5545 line unfolding so DTSTART;TZID=…:\\n 20260914T123000 still matches. */
function unfold(ics: string): string {
  return ics.replace(/\r?\n[ \t]/g, "");
}

/** Isolate the master VEVENT (the one without RECURRENCE-ID) from a VCALENDAR. */
function splitEvents(ics: string): { header: string; events: string[]; footer: string } {
  const text = unfold(ics);
  const first = text.indexOf("BEGIN:VEVENT");
  const lastEnd = text.lastIndexOf("END:VEVENT");
  if (first === -1 || lastEnd === -1) return { header: text, events: [], footer: "" };
  const header = text.slice(0, first);
  const footer = text.slice(lastEnd + "END:VEVENT".length);
  const middle = text.slice(first, lastEnd + "END:VEVENT".length);
  const events = middle.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
  return { header, events, footer };
}

/** Shift an iCalendar DATE / date-time stamp by a millisecond delta, keeping form.
 *  UTC (`…Z`) shifts as an instant; civil / TZID stamps shift as a wall clock
 *  so we never convert `TZID=America/Los_Angeles:123000` into `120000Z`. */
export function shiftIcalStamp(value: string, deltaMs: number): string {
  const s = value.trim();
  if (/^\d{8}$/.test(s)) {
    const next = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) + deltaMs);
    return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
  }
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i);
  if (!m) return s;
  const utc = Boolean(m[7]);
  const shifted = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + deltaMs);
  const stamp =
    `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}${pad(shifted.getUTCMinutes())}${pad(shifted.getUTCSeconds())}`;
  return utc ? `${stamp}Z` : stamp;
}

function isMaster(vevent: string): boolean {
  return !/\bRECURRENCE-ID\b/i.test(vevent);
}

/** The params (`;TZID=…`, `;VALUE=DATE`) and value of a date-time property. */
function readProp(vevent: string, kind: string): { params: string; value: string } | null {
  const m = vevent.match(new RegExp(`^${kind}(;[^:\\r\\n]*)?:(.*)$`, "im"));
  return m ? { params: m[1] ?? "", value: m[2].trim() } : null;
}

function tzidOf(params: string): string | null {
  const m = params.match(/;TZID=("?)([^;:"]+)\1/i);
  return m ? m[2] : null;
}

/** The zone a master's DTSTART is anchored to, when the runtime can resolve it. */
function masterZone(master: string): string | null {
  const ds = readProp(master, "DTSTART");
  const tz = ds ? tzidOf(ds.params) : null;
  return isUsableTimeZone(tz) ? tz : null;
}

/** A date-time property's value as an instant. Floating and unresolvable
 *  TZIDs read as UTC — the behaviour this module always had. */
function propToMs(params: string, value: string): number {
  const v = value.trim();
  const tz = tzidOf(params);
  if (!/Z$/i.test(v) && /T/.test(v) && isUsableTimeZone(tz)) return localIcalToMs(v, tz);
  return icalToDate(v).getTime();
}

const SUFFIX = /^\d{8}(T\d{6}Z?)?$/i;

/**
 * Where one occurrence of a series is, in the master's own form.
 *
 * `occurrence` is either the RECURRENCE-ID suffix a synced row carries
 * (`uid::20261028T180000` → `20261028T180000`, exactly as ical.js expanded it
 * from the master) or an ISO instant. A suffix is used verbatim; an instant is
 * spelled the way the master's DTSTART is (TZID wall clock, DATE, or UTC).
 * Writing a TZID series' occurrence as UTC — or reading its wall-clock suffix as
 * UTC, which we used to — pointed EXDATE/RECURRENCE-ID at an instant that is not
 * an occurrence, so "delete this one" deleted nothing upstream.
 */
function occurrenceRef(master: string, occurrence: string): { params: string; value: string; ms: number } {
  const ds = readProp(master, "DTSTART");
  const dsParams = ds?.params ?? "";
  const allDay = /VALUE=DATE(?!-)/i.test(dsParams);
  const zone = masterZone(master);
  if (SUFFIX.test(occurrence)) {
    const value = occurrence.toUpperCase();
    if (/^\d{8}$/.test(value)) return { params: ";VALUE=DATE", value, ms: icalToDate(value).getTime() };
    if (value.endsWith("Z")) return { params: "", value, ms: icalToDate(value).getTime() };
    const tzid = tzidOf(dsParams);
    const params = tzid ? `;TZID=${tzid}` : "";
    return { params, value, ms: propToMs(params, value) };
  }
  const ms = new Date(occurrence).getTime();
  if (allDay) {
    const d = new Date(ms);
    const value = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    return { params: ";VALUE=DATE", value, ms };
  }
  if (zone) return { params: `;TZID=${zone}`, value: toIcalLocal(occurrence, zone), ms };
  return { params: "", value: toIcalUtc(occurrence), ms };
}

/** Does this override VEVENT stand for that occurrence (by instant, not text)? */
function isOverrideFor(vevent: string, ref: { value: string; ms: number }): boolean {
  const rid = readProp(vevent, "RECURRENCE-ID");
  if (!rid) return false;
  return rid.value.toUpperCase() === ref.value || propToMs(rid.params, rid.value) === ref.ms;
}

/** Ensure the VCALENDAR header carries a VTIMEZONE for `tz`. */
function withVtimezone(header: string, tz: string, aroundISO: string): string {
  const has = new RegExp(`BEGIN:VTIMEZONE\\s*\\r?\\nTZID:"?${tz.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"?\\s*\\r?\\n`, "i");
  if (has.test(header)) return header;
  const block = buildVtimezone(tz, aroundISO);
  return /\r?\n$/.test(header) || header === "" ? `${header}${block}\r\n` : `${header}\r\n${block}\r\n`;
}

/** Replace (or drop) a single property line inside a VEVENT block. */
function setProp(vevent: string, name: string, value: string | null): string {
  const re = new RegExp(`^${name}(;[^:\\r\\n]*)?:.*$`, "im");
  if (value === null) return vevent.replace(new RegExp(`^${name}(;[^:\\r\\n]*)?:.*\\r?\\n`, "im"), "");
  if (re.test(vevent)) return vevent.replace(re, `${name}:${value}`);
  // Insert just after DTSTAMP (or UID) if the property is missing.
  return vevent.replace(/^(UID:.*|DTSTAMP:.*)$/im, `$&\r\n${name}:${value}`);
}

/** Write DTSTART/DTEND as a DATE, a TZID wall clock (when `zone`), or UTC. */
function setDateTimeProp(
  vevent: string,
  kind: "DTSTART" | "DTEND",
  iso: string,
  allDay: boolean,
  zone?: string | null,
): string {
  const v = vevent.replace(new RegExp(`^${kind}(;[^:\\r\\n]*)?:.*\\r?\\n`, "im"), "");
  const line = allDay
    ? `${kind};VALUE=DATE:${toIcalDate(iso)}`
    : zone
    ? `${kind};TZID=${zone}:${toIcalLocal(iso, zone)}`
    : `${kind}:${toIcalUtc(iso)}`;
  return v.replace(/^(UID:.*|DTSTAMP:.*)$/im, `$&\r\n${line}`);
}

/** Replace (or drop) RRULE lines on the master VEVENT. */
function setRecurrence(vevent: string, recurrence: string[] | null | undefined): string {
  const v = vevent.replace(/^RRULE:.*\r?\n/gim, "");
  if (!recurrence?.length) return v;
  const lines = recurrence.map((r) => (r.startsWith("RRULE") ? r : `RRULE:${r.replace(/^RRULE:/i, "")}`));
  return v.replace(/END:VEVENT\s*$/i, `${lines.join("\r\n")}\r\nEND:VEVENT`);
}

/**
 * A UTC-anchored timed series → the same instants, re-anchored to `zone`.
 * This is the repair for every series Nuvo wrote before it knew the zone:
 * the first instant is kept, and from then on BYDAY means the local weekday.
 */
function anchorSeriesToZone(vevent: string, zone: string | null | undefined): { vevent: string; zone: string | null } {
  if (!/^RRULE:/im.test(vevent)) return { vevent, zone: null };
  const ds = readProp(vevent, "DTSTART");
  if (!ds || /VALUE=DATE(?!-)/i.test(ds.params)) return { vevent, zone: null };
  const existing = tzidOf(ds.params);
  if (existing) return { vevent, zone: null };
  if (!/Z$/i.test(ds.value) || !isUsableTimeZone(zone)) return { vevent, zone: null };
  const startISO = new Date(propToMs(ds.params, ds.value)).toISOString();
  const de = readProp(vevent, "DTEND");
  let v = setDateTimeProp(vevent, "DTSTART", startISO, false, zone);
  if (de) v = setDateTimeProp(v, "DTEND", new Date(propToMs(de.params, de.value)).toISOString(), false, zone);
  return { vevent: v, zone };
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
    /** The zone the user is editing in — anchors a series that has none yet. */
    timeZone?: string | null;
  },
): string {
  const { header, events, footer } = splitEvents(ics);
  let addZone: { zone: string; around: string } | null = null;
  const out = events.map((ve) => {
    if (!isMaster(ve)) return ve;
    let v = ve;
    if (patch.title !== undefined) v = setProp(v, "SUMMARY", escapeText(patch.title));
    if (patch.recurrence !== undefined) v = setRecurrence(v, patch.recurrence);
    const flipping = patch.allDay !== undefined;
    const allDay = patch.allDay ?? /\bDTSTART;VALUE=DATE\b/i.test(v);
    // Keep the zone the event already lives in; a series that has none takes
    // the editor's (a lone event may stay UTC — nothing repeats off it).
    const kept = masterZone(v);
    const wantZone = kept ?? (/^RRULE:/im.test(v) && isUsableTimeZone(patch.timeZone) ? patch.timeZone : null);
    if (patch.startISO !== undefined || patch.endISO !== undefined || flipping) {
      const startISO = patch.startISO ?? isoFromVevent(v, "DTSTART");
      let endISO = patch.endISO ?? isoFromVevent(v, "DTEND");
      if (allDay && startISO && endISO && toIcalDate(endISO) <= toIcalDate(startISO)) {
        endISO = new Date(new Date(startISO).getTime() + 24 * 60 * 60 * 1000).toISOString();
      }
      if (startISO) v = setDateTimeProp(v, "DTSTART", startISO, allDay, allDay ? null : wantZone);
      if (endISO) v = setDateTimeProp(v, "DTEND", endISO, allDay, allDay ? null : wantZone);
      if (!allDay && wantZone && !kept && startISO) addZone = { zone: wantZone, around: startISO };
    } else {
      const anchored = anchorSeriesToZone(v, patch.timeZone);
      v = anchored.vevent;
      if (anchored.zone) addZone = { zone: anchored.zone, around: isoFromVevent(v, "DTSTART") ?? new Date().toISOString() };
    }
    if (patch.location !== undefined) v = setProp(v, "LOCATION", patch.location ? escapeText(patch.location) : null);
    if (patch.description !== undefined) v = setProp(v, "DESCRIPTION", patch.description ? escapeText(patch.description) : null);
    return v;
  });
  const z = addZone as { zone: string; around: string } | null;
  return (z ? withVtimezone(header, z.zone, z.around) : header) + out.join("\r\n") + footer;
}

/** Add an EXDATE to the master so a single occurrence disappears (delete THIS).
 *  `occurrence` is the row's RECURRENCE-ID suffix or an ISO instant. */
export function addExdate(ics: string, occurrence: string): string {
  const { header, events, footer } = splitEvents(ics);
  const out = events.map((ve) => {
    if (!isMaster(ve)) return ve;
    const ref = occurrenceRef(ve, occurrence);
    return ve.replace(/END:VEVENT\s*$/i, `EXDATE${ref.params}:${ref.value}\r\nEND:VEVENT`);
  });
  // An override already standing in for that occurrence would keep it alive.
  const master = events.find(isMaster);
  const ref = master ? occurrenceRef(master, occurrence) : null;
  const kept = ref ? out.filter((ve) => isMaster(ve) || !isOverrideFor(ve, ref)) : out;
  return header + kept.join("\r\n") + footer;
}

/** Add or replace a per-occurrence override VEVENT (edit THIS of a series).
 *  `occurrence` is the row's RECURRENCE-ID suffix or an ISO instant. */
export function upsertOverride(
  ics: string,
  occurrence: string,
  patch: {
    title?: string;
    startISO?: string;
    endISO?: string;
    allDay?: boolean;
    location?: string | null;
    description?: string | null;
  },
): string {
  const { header, events, footer } = splitEvents(ics);
  const master = events.find(isMaster);
  if (!master) return ics;
  const uid = master.match(/^UID:(.*)$/im)?.[1]?.trim() ?? crypto.randomUUID();
  const ref = occurrenceRef(master, occurrence);
  const existing = events.find((ve) => !isMaster(ve) && isOverrideFor(ve, ref));
  // Start from the existing override (or the master), so an edit to one field
  // keeps the others the occurrence already had — a retitle used to drop its
  // moved time, and a move used to drop its title.
  const base = existing ?? master;
  const occurrenceISO = new Date(ref.ms).toISOString();

  const ds = readProp(master, "DTSTART");
  const de = readProp(master, "DTEND");
  const durMs = ds && de ? Math.max(0, propToMs(de.params, de.value) - propToMs(ds.params, ds.value)) : 60 * 60_000;
  const baseStart = existing ? readProp(existing, "DTSTART") : null;
  const baseEnd = existing ? readProp(existing, "DTEND") : null;
  const startISO = patch.startISO ??
    (baseStart ? new Date(propToMs(baseStart.params, baseStart.value)).toISOString() : occurrenceISO);
  const endISO = patch.endISO ??
    (baseEnd && !patch.startISO
      ? new Date(propToMs(baseEnd.params, baseEnd.value)).toISOString()
      : new Date(new Date(startISO).getTime() + durMs).toISOString());

  const allDay = patch.allDay ?? Boolean(baseStart && /VALUE=DATE(?!-)/i.test(baseStart.params));
  const zone = masterZone(master);
  const dt = (kind: "DTSTART" | "DTEND", iso: string) =>
    allDay
      ? `${kind};VALUE=DATE:${toIcalDate(iso)}`
      : zone
      ? `${kind};TZID=${zone}:${toIcalLocal(iso, zone)}`
      : `${kind}:${toIcalUtc(iso)}`;

  const carry = (name: string): string | null => {
    const m = base.match(new RegExp(`^${name}(;[^:\\r\\n]*)?:.*$`, "im"));
    return m ? m[0] : null;
  };
  const title = patch.title !== undefined ? `SUMMARY:${escapeText(patch.title)}` : carry("SUMMARY");
  const location = patch.location !== undefined
    ? (patch.location ? `LOCATION:${escapeText(patch.location)}` : null)
    : carry("LOCATION");
  const description = patch.description !== undefined
    ? (patch.description ? `DESCRIPTION:${escapeText(patch.description)}` : null)
    : carry("DESCRIPTION");
  const attendees = base.match(/^(ATTENDEE|ORGANIZER)[;:].*$/gim) ?? [];

  const override = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `RECURRENCE-ID${ref.params}:${ref.value}`,
    `DTSTAMP:${toIcalUtc(new Date().toISOString())}`,
    dt("DTSTART", startISO),
    dt("DTEND", endISO),
    ...(title ? [title] : []),
    ...(location ? [location] : []),
    ...(description ? [description] : []),
    ...attendees,
    "END:VEVENT",
  ].join("\r\n");

  const withoutExisting = events.filter((ve) => isMaster(ve) || !isOverrideFor(ve, ref));
  return header + [...withoutExisting, override].join("\r\n") + footer;
}

/** Shift the master event's start/end by a delta (ms) — used for "edit ALL" on a
 *  recurring series so every instance moves together. Optionally retitles.
 *  `endDeltaMs` defaults to `deltaMs` (a drag); a resize passes a different end.
 *  `timeZone` re-anchors a UTC series first, so the shift is a wall-clock one. */
export function shiftMaster(
  ics: string,
  deltaMs: number,
  title?: string,
  endDeltaMs = deltaMs,
  timeZone?: string | null,
): string {
  const { header, events, footer } = splitEvents(ics);
  let addZone: { zone: string; around: string } | null = null;
  const out = events.map((ve) => {
    if (!isMaster(ve)) {
      // An edited occurrence keeps its own time, but it is NAMED by the
      // series' original slot — which just moved. Leave the name behind and
      // the override orphans into a duplicate.
      return ve.replace(
        /^RECURRENCE-ID(;[^:\r\n]*)?:(.*)$/im,
        (_, params: string | undefined, value: string) => `RECURRENCE-ID${params ?? ""}:${shiftIcalStamp(value, deltaMs)}`,
      );
    }
    const anchored = anchorSeriesToZone(ve, timeZone);
    let v = anchored.vevent;
    const ds = v.match(/^DTSTART(;[^:\r\n]*)?:(.*)$/im);
    const de = v.match(/^DTEND(;[^:\r\n]*)?:(.*)$/im);
    // Keep TZID / VALUE=DATE params. Rewriting `DTSTART:${utcZ}` is how a
    // 12:30pm Pacific series became 4:30am after "move all in the series".
    if (ds) {
      const moved = shiftIcalStamp(ds[2], deltaMs);
      v = v.replace(/^DTSTART(;[^:\r\n]*)?:.*$/im, `DTSTART${ds[1] ?? ""}:${moved}`);
      // The stamp is written in the zone the rule expands in, so its date part
      // IS the rule's day: moving it a day moves BYDAY/BYMONTHDAY with it.
      const dayDelta = Math.round((icalToDate(moved.slice(0, 8)).getTime() - icalToDate(ds[2].trim().slice(0, 8)).getTime()) / 86_400_000);
      if (dayDelta) {
        v = v.replace(/^RRULE:.*$/gim, (line) => shiftRRuleDays([line], dayDelta)[0]);
      }
    }
    if (de) v = v.replace(/^DTEND(;[^:\r\n]*)?:.*$/im, `DTEND${de[1] ?? ""}:${shiftIcalStamp(de[2], endDeltaMs)}`);
    // Deleted occurrences stay deleted at their new slots.
    v = v.replace(
      /^EXDATE(;[^:\r\n]*)?:(.*)$/gim,
      (_, params: string | undefined, list: string) =>
        `EXDATE${params ?? ""}:${list.split(",").map((x) => shiftIcalStamp(x, deltaMs)).join(",")}`,
    );
    if (title !== undefined) v = setProp(v, "SUMMARY", escapeText(title));
    if (anchored.zone) addZone = { zone: anchored.zone, around: isoFromVevent(v, "DTSTART") ?? new Date().toISOString() };
    return v;
  });
  const z = addZone as { zone: string; around: string } | null;
  return (z ? withVtimezone(header, z.zone, z.around) : header) + out.join("\r\n") + footer;
}

/** Parse an iCalendar date/date-time value into a JS Date (UTC-ish). */
function icalToDate(v: string): Date {
  const s = v.trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return new Date(s);
  const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
}

function isoFromVevent(vevent: string, kind: "DTSTART" | "DTEND"): string | undefined {
  const p = readProp(vevent, kind);
  if (!p) return undefined;
  return new Date(propToMs(p.params, p.value)).toISOString();
}

/** Clone the master VEVENT as a RECURRENCE-ID override, keeping attendees. */
export function cloneAsOverride(ics: string, occurrence: string): string {
  const { header, events, footer } = splitEvents(ics);
  const master = events.find(isMaster);
  if (!master) return ics;
  const ref = occurrenceRef(master, occurrence);
  if (events.some((ve) => !isMaster(ve) && isOverrideFor(ve, ref))) {
    return ics;
  }
  const zone = masterZone(master);
  const allDay = ref.params === ";VALUE=DATE";
  const ds = readProp(master, "DTSTART");
  const de = readProp(master, "DTEND");
  const durMs = ds && de ? Math.max(0, propToMs(de.params, de.value) - propToMs(ds.params, ds.value)) : 0;
  const startISO = new Date(ref.ms).toISOString();
  const endISO = new Date(ref.ms + durMs).toISOString();
  let ve = master
    .replace(/^RRULE:.*\r?\n/gim, "")
    .replace(/^EXDATE[;:].*\r?\n/gim, "")
    .replace(/^RDATE[;:].*\r?\n/gim, "")
    .replace(/^RECURRENCE-ID.*\r?\n/gim, "");
  // The clone's own times are this occurrence's, not the series' first.
  ve = setDateTimeProp(ve, "DTSTART", startISO, allDay, allDay ? null : zone);
  if (de) ve = setDateTimeProp(ve, "DTEND", endISO, allDay, allDay ? null : zone);
  ve = ve.replace(/^(UID:.*)$/im, `$1\r\nRECURRENCE-ID${ref.params}:${ref.value}`);
  return header + [...events, ve].join("\r\n") + footer;
}

/** `YYYYMMDD[THHMMSS]` (no zone) for a UTC-epoch instant's fields. */
function stampOf(ms: number, dateOnly: boolean): string {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return dateOnly ? date : `${date}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** The ORGANIZER of a series, when it is somebody other than `ownEmail`.
 *  Splitting someone else's meeting would make the user organizer of a copy. */
export function foreignOrganizer(ics: string, ownEmail: string): string | null {
  const { events } = splitEvents(ics);
  const master = events.find(isMaster);
  const m = master?.match(/^ORGANIZER[;:].*?mailto:([^;:\s]+)/im);
  if (!m) return null;
  return m[1].trim().toLowerCase() === ownEmail.trim().toLowerCase() ? null : m[1].trim();
}

/** The RRULE's COUNT, so the caller can count what the old series keeps. */
export function seriesCount(ics: string): number | null {
  const { events } = splitEvents(ics);
  const master = events.find(isMaster);
  return master ? rruleCount(master.match(/^RRULE:.*$/gim) ?? []) : null;
}

/**
 * "This and following": cut a series in two at `occurrence` (the row's
 * RECURRENCE-ID suffix or an ISO instant).
 *
 *   head — the original resource, its rule ended just before the occurrence,
 *          its overrides from the occurrence on dropped (they move to the tail);
 *   tail — a new resource (`newUid`) whose first occurrence IS that one: same
 *          rule (a COUNT carries only what the head didn't use), same zone,
 *          same fields, the later overrides re-homed under the new UID.
 *
 * The caller then edits the tail as a whole series (shiftMaster / patchMaster),
 * exactly as an ALL edit edits a series. Returns null when the occurrence is
 * the series' first — "this and following" from the start IS "all".
 * `countBefore` is required when the rule has a COUNT: how many occurrences
 * the rule generates before the split (EXDATEd ones included, per RFC 5545).
 */
export function splitSeries(
  ics: string,
  occurrence: string,
  opts: { newUid: string; countBefore?: number },
): { head: string; tail: string; occurrenceISO: string } | null {
  const { header, events, footer } = splitEvents(ics);
  const master = events.find(isMaster);
  if (!master || !/^RRULE:/im.test(master)) return null;
  const ds = readProp(master, "DTSTART");
  if (!ds) return null;
  const ref = occurrenceRef(master, occurrence);
  if (ref.ms <= propToMs(ds.params, ds.value)) return null;

  const allDay = /VALUE=DATE(?!-)/i.test(ds.params);
  const floating = !allDay && !tzidOf(ds.params) && !/Z$/i.test(ds.value);
  // UNTIL is inclusive, so end one tick before the split: the day before for a
  // DATE series, one second before otherwise — in UTC unless DTSTART floats.
  const until = allDay
    ? stampOf(icalToDate(ref.value).getTime() - 86_400_000, true)
    : floating
    ? stampOf(icalToDate(ref.value).getTime() - 1000, false)
    : toIcalUtc(new Date(ref.ms - 1000).toISOString());

  const startsAtOrAfter = (ve: string) => {
    const rid = readProp(ve, "RECURRENCE-ID");
    return Boolean(rid) && propToMs(rid!.params, rid!.value) >= ref.ms;
  };
  const rules = (ve: string) => ve.match(/^RRULE:.*$/gim) ?? [];
  const swapRules = (ve: string, next: string[]) => {
    const lines = rules(ve);
    let i = 0;
    return ve.replace(/^RRULE:.*$/gim, () => next[i++] ?? lines[i - 1]);
  };

  // ── head ──
  const headMaster = swapRules(master, capRRule(rules(master), until));
  const headEvents = events.filter((ve) => !isMaster(ve) && !startsAtOrAfter(ve));
  const head = header + [headMaster, ...headEvents].join("\r\n") + footer;

  // ── tail ──
  const reUid = (ve: string) => ve.replace(/^UID:.*$/im, `UID:${opts.newUid}`);
  let tailMaster = reUid(master);
  const count = rruleCount(rules(master));
  if (count != null) {
    tailMaster = swapRules(tailMaster, recountRRule(rules(master), count - (opts.countBefore ?? 0)));
  }
  // Re-base the series on the occurrence, in the master's own form.
  const de = readProp(master, "DTEND");
  const durMs = de ? propToMs(de.params, de.value) - propToMs(ds.params, ds.value) : 0;
  tailMaster = tailMaster.replace(/^DTSTART(;[^:\r\n]*)?:.*$/im, `DTSTART${ref.params}:${ref.value}`);
  if (de) {
    const zone = masterZone(master);
    const endValue = allDay
      ? stampOf(icalToDate(ref.value).getTime() + durMs, true)
      : zone
      ? toIcalLocal(new Date(ref.ms + durMs).toISOString(), zone)
      : floating
      ? stampOf(icalToDate(ref.value).getTime() + durMs, false)
      : toIcalUtc(new Date(ref.ms + durMs).toISOString());
    tailMaster = tailMaster.replace(/^DTEND(;[^:\r\n]*)?:.*$/im, `DTEND${de.params}:${endValue}`);
  }
  const tailOverrides = events.filter((ve) => !isMaster(ve) && startsAtOrAfter(ve)).map(reUid);
  const tail = header + [tailMaster, ...tailOverrides].join("\r\n") + footer;

  return { head, tail, occurrenceISO: new Date(ref.ms).toISOString() };
}

/** Drop every per-occurrence override — a series whose RULE changed has no
 *  stable occurrence ids for them to hang on. */
export function withoutOverrides(ics: string): string {
  const { header, events, footer } = splitEvents(ics);
  return header + events.filter(isMaster).join("\r\n") + footer;
}

function rewriteAttendeeLines(text: string, email: string, partstat: string): string {
  const target = email.trim().toLowerCase();
  if (!target) return text;
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  return unfolded
    .split(/\r?\n/)
    .map((line) => {
      if (!/^ATTENDEE[;:]/i.test(line)) return line;
      const mailto = line.match(/mailto:([^;:,\s]+)/i);
      if (!mailto || mailto[1].trim().toLowerCase() !== target) return line;
      const [head, ...rest] = line.split(":");
      const value = rest.join(":");
      const params = /PARTSTAT=[^;:]*/i.test(head)
        ? head.replace(/PARTSTAT=[^;:]*/i, `PARTSTAT=${partstat}`)
        : `${head};PARTSTAT=${partstat}`;
      return `${params.replace(/;RSVP=[^;:]*/i, "")}:${value}`;
    })
    .join("\r\n");
}

/**
 * Set the user's own PARTSTAT. Omit `occurrenceStartISO` to answer the whole
 * resource (every VEVENT). Pass it to answer just that occurrence — cloning
 * the master into an override first if one doesn't exist yet, so THIS doesn't
 * rewrite the series.
 */
export function setPartstat(
  ics: string,
  email: string,
  partstat: string,
  /** The row's RECURRENCE-ID suffix or an ISO instant; omit for the series. */
  occurrence?: string,
): string {
  if (!occurrence) return rewriteAttendeeLines(ics, email, partstat);

  const working = cloneAsOverride(ics, occurrence);
  const { header, events, footer } = splitEvents(working);
  const master = events.find(isMaster);
  if (!master) return working;
  const ref = occurrenceRef(master, occurrence);
  const out = events.map((ve) => {
    if (isMaster(ve) || !isOverrideFor(ve, ref)) return ve;
    return rewriteAttendeeLines(ve, email, partstat);
  });
  return header + out.join("\r\n") + footer;
}

/** iCalendar's spelling of an RSVP. */
export function partstatFor(responseStatus: string): string | null {
  switch (responseStatus) {
    case "accepted":
      return "ACCEPTED";
    case "declined":
      return "DECLINED";
    case "tentative":
      return "TENTATIVE";
    default:
      return null;
  }
}
