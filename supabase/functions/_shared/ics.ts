// Subscribed iCalendar (.ics) feed → external_events rows.
//
// Read-only: the feed URL is the credential and lives in Vault. Recurring
// events (RRULE) are expanded into individual occurrences within the sync
// window using ical.js; embedded VTIMEZONEs are registered first so that
// Windows-style zone names (e.g. "Pacific Standard Time", as Exchange emits)
// resolve to the right offsets.
//
// Known limitation: per-occurrence overrides (separate VEVENTs carrying
// RECURRENCE-ID) are not stitched onto their master series. Exchange's
// published feeds don't use them, so this stays simple on purpose.
import ICAL from "npm:ical.js@2";

export interface IcsAccount {
  id: string;
  user_id: string;
  email: string;
  refresh_token_secret_id: string | null;
  needs_reconnect: boolean;
}

export interface ExternalEventRow {
  user_id: string;
  account_id: string;
  provider_event_id: string;
  calendar_id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  busy: boolean;
  raw: Record<string, unknown> | null;
  last_synced_at: string;
}

// deno-lint-ignore no-explicit-any
function busyFromVevent(ve: any): boolean {
  // Exchange marks free/busy with X-MICROSOFT-CDO-BUSYSTATUS; fall back to the
  // standard TRANSP. Anything that isn't explicitly free counts as busy.
  const cdo = String(ve.getFirstPropertyValue("x-microsoft-cdo-busystatus") ?? "").toUpperCase();
  if (cdo) return cdo !== "FREE";
  const transp = String(ve.getFirstPropertyValue("transp") ?? "").toUpperCase();
  return transp !== "TRANSPARENT";
}

// Strip VEVENTs that are clearly outside [windowStart, windowEnd] before
// handing the text to ical.js. Feeds like iCloud export the full history
// (5 000+ events) which exhausts the edge function memory budget.
// Recurring events (RRULE) are always kept because they may expand into window.
function slimFeed(text: string, windowStart: Date, windowEnd: Date): string {
  const wsMs = windowStart.getTime();
  const weMs = windowEnd.getTime();

  // Collect header lines (everything up to the first VEVENT).
  const firstVevent = text.indexOf("BEGIN:VEVENT");
  if (firstVevent === -1) return text;
  const header = text.slice(0, firstVevent);

  // Find footer after the last END:VEVENT.
  const lastEnd = text.lastIndexOf("END:VEVENT");
  const footer = lastEnd === -1 ? "\nEND:VCALENDAR\r\n" : text.slice(lastEnd + "END:VEVENT".length);

  // Split on VEVENT boundaries — handles CRLF and LF line endings.
  const blocks: string[] = [];
  const re = /BEGIN:VEVENT[\s\S]*?END:VEVENT/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const block = m[0];

    // Always keep recurring events — we can't know their window without expanding.
    if (/\nRRULE:/i.test(block) || /\r\nRRULE:/i.test(block)) {
      blocks.push(block);
      continue;
    }

    // Extract the 8-digit date from DTSTART (works for both DATE and DATETIME).
    const dtStartMatch = block.match(/DTSTART[^:\r\n]*:(\d{8})/i);
    if (!dtStartMatch) { blocks.push(block); continue; } // can't filter, keep

    const ds = dtStartMatch[1];
    const startMs = Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8));

    // Use DTEND if present, otherwise treat end = start.
    const dtEndMatch = block.match(/DTEND[^:\r\n]*:(\d{8})/i);
    const endMs = dtEndMatch
      ? Date.UTC(+dtEndMatch[1].slice(0, 4), +dtEndMatch[1].slice(4, 6) - 1, +dtEndMatch[1].slice(6, 8))
      : startMs;

    if (endMs >= wsMs && startMs <= weMs) blocks.push(block);
  }

  return header + blocks.join("\n") + footer;
}

export function parseIcs(
  icsText: string,
  opts: {
    userId: string;
    accountId: string;
    windowStart: Date;
    windowEnd: Date;
    runStamp: string;
    /** Calendar collection id to stamp on every row (CalDAV has many); "primary" for ICS. */
    calendarId?: string;
  },
): { calName: string | null; rows: ExternalEventRow[] } {
  const { userId, accountId, windowStart, windowEnd, runStamp, calendarId = "primary" } = opts;
  const slimmed = slimFeed(icsText, windowStart, windowEnd);
  const comp = new ICAL.Component(ICAL.parse(slimmed));

  // Register embedded VTIMEZONEs so non-IANA (Windows) TZIDs resolve.
  for (const vt of comp.getAllSubcomponents("vtimezone")) {
    const tzid = String(vt.getFirstPropertyValue("tzid") ?? "");
    if (tzid && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(new ICAL.Timezone({ component: vt, tzid }));
    }
  }

  const calName = (comp.getFirstPropertyValue("x-wr-calname") as string) || null;
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const rows: ExternalEventRow[] = [];

  const add = (
    uid: string,
    title: string,
    location: string | null,
    busy: boolean,
    // deno-lint-ignore no-explicit-any
    startTime: any,
    // deno-lint-ignore no-explicit-any
    endTime: any,
    suffix: string | null,
  ) => {
    // Organizer-cancelled meetings linger in the feed titled "Canceled: …"
    // (their STATUS isn't CANCELLED). Filter here so per-occurrence overrides
    // renamed to "Canceled:" are caught too, not just whole-series masters.
    if (/^cancell?ed:/i.test((title ?? "").trim())) return;
    const startJs = startTime.toJSDate();
    const endJs = endTime ? endTime.toJSDate() : startJs;
    rows.push({
      user_id: userId,
      account_id: accountId,
      provider_event_id: suffix ? `${uid}::${suffix}` : uid,
      calendar_id: calendarId,
      title: title || "(no title)",
      start_at: startJs.toISOString(),
      end_at: endJs.toISOString(),
      all_day: Boolean(startTime.isDate),
      location: location || null,
      busy,
      raw: null,
      last_synced_at: runStamp,
    });
  };

  // Pass 1: split recurring masters / plain events from per-occurrence
  // overrides (VEVENTs carrying RECURRENCE-ID). Exchange publishes an edited
  // instance as a separate override that must REPLACE its master's generated
  // occurrence — relating them avoids showing the edited meeting twice.
  // deno-lint-ignore no-explicit-any
  const masters = new Map<string, any>();
  // deno-lint-ignore no-explicit-any
  const overrides: any[] = [];
  for (const ve of comp.getAllSubcomponents("vevent")) {
    if (String(ve.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") continue;
    const ev = new ICAL.Event(ve);
    if (!ev.startDate) continue;
    if (ve.hasProperty("recurrence-id")) {
      overrides.push(ev);
      continue;
    }
    const key = (ev.uid as string) || crypto.randomUUID();
    const prev = masters.get(key);
    if (!prev || ev.isRecurring()) masters.set(key, ev);
  }
  for (const ov of overrides) {
    const m = ov.uid ? masters.get(ov.uid) : null;
    if (m && m.isRecurring()) {
      try {
        m.relateException(ov);
        continue;
      } catch { /* malformed exception — fall through to standalone */ }
    }
    masters.set(`${ov.uid ?? crypto.randomUUID()}::ovr::${ov.recurrenceId?.toICALString() ?? ""}`, ov);
  }

  for (const event of masters.values()) {
    const uid = (event.uid as string) || crypto.randomUUID();
    const title = (event.summary as string) || "(no title)";
    // Organizer-cancelled meetings linger in the feed titled "Canceled: …"
    // (their STATUS isn't CANCELLED, so the title prefix is the only signal).
    if (/^cancell?ed:/i.test(title.trim())) continue;
    const location = (event.location as string) || null;
    const busy = busyFromVevent(event.component);

    if (event.isRecurring()) {
      const iter = event.iterator();
      // deno-lint-ignore no-explicit-any
      let next: any;
      let guard = 0;
      while ((next = iter.next()) && guard < 3000) {
        guard++;
        if (next.toJSDate().getTime() > endMs) break;
        const det = event.getOccurrenceDetails(next);
        if (det.endDate.toJSDate().getTime() < startMs) continue; // before window
        add(
          uid,
          (det.item.summary as string) || title,
          (det.item.location as string) || location,
          busy,
          det.startDate,
          det.endDate,
          next.toICALString(),
        );
      }
    } else {
      const s = event.startDate.toJSDate().getTime();
      const e = (event.endDate ? event.endDate.toJSDate() : event.startDate.toJSDate()).getTime();
      if (e < startMs || s > endMs) continue; // outside window
      add(uid, title, location, busy, event.startDate, event.endDate, null);
    }
  }

  // Collapse remaining duplicates: the upsert key first, then identical content
  // (same title + time) that the feed lists under separate UIDs.
  const seenPid = new Set<string>();
  const seenContent = new Set<string>();
  const deduped: ExternalEventRow[] = [];
  for (const r of rows) {
    if (seenPid.has(r.provider_event_id)) continue;
    const ck = `${r.title}|${r.start_at}|${r.end_at}|${r.all_day}`;
    if (seenContent.has(ck)) continue;
    seenPid.add(r.provider_event_id);
    seenContent.add(ck);
    deduped.push(r);
  }

  return { calName, rows: deduped };
}
