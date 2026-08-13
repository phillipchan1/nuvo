/**
 * What a day looks like — one definition, for every runtime that renders one.
 *
 * This module exists for the same reason `planningRules.ts` does. Nuvo answers
 * "what is on today" in the SPA, in the agent's snapshot, and (soon) on a watch
 * that has no web view and cannot import a line of `src/`. A day shaped in three
 * places drifts in three directions: the agent once offered an hour the user had
 * already claimed, because only one of the readers counted slots as busy.
 *
 * So the rules live here and are imported, never re-implemented:
 *   • which events a user can actually see (hidden calendars, hidden series)
 *   • what counts as busy, and therefore what is open
 *   • how a time reads in the user's own zone
 *   • the words a day is described in ("3h 20m open", "fully booked")
 *
 * **Zero imports, zero Deno globals, pure.** That is load-bearing: the SPA
 * imports this file through Vite exactly as it imports `reminderRules.ts`, and a
 * `Deno.` reference here would break the browser build.
 *
 * Every formatted string is built in a caller-supplied `tz` — the
 * device-zone-not-home-zone doctrine. Never reformat these downstream; a client
 * that re-derives a time from the ISO field is the bug this prevents.
 */

/** Fallback when the client didn't say where it is — the app's established home. */
export const FALLBACK_TZ = "America/Los_Angeles";

/** A gap shorter than this isn't worth offering as a place to put work. */
export const MIN_WINDOW_MINUTES = 30;

// ---------------------------------------------------------------------------
// Types — the canonical home. `agent/contextShape.ts` re-exports them so the
// snapshot's vocabulary and the day's vocabulary cannot drift apart.
// ---------------------------------------------------------------------------

/** An open window in the day — computed, not a thing the user made. Named
 *  "window", never "slot": a Slot is a real row the user can create and drop
 *  work into, and calling both of them slots taught the model that "9am slot"
 *  meant "the gap at 9am" (Principle 11 — one name, one meaning). */
export interface OpenWindow {
  startISO: string;
  endISO: string;
  /** Pre-formatted in the user's zone */
  timeRange: string;
  minutes: number;
}

/** A Slot the user actually holds: one block of time on the calendar that owns
 *  several tasks. The tasks inside have no time of their own — the slot is the
 *  block, they're its contents. */
export interface SlotSummary {
  id: string;
  title: string;
  /** Pre-formatted in the user's zone — use verbatim. */
  timeRange: string;
  startISO: string;
  durationMinutes: number;
  localDate: string;
  past: boolean;
  projectId: string | null;
  domainId: string | null;
  /** What's in it, in order. */
  tasks: { id: string; title: string; status: string }[];
}

export interface ScheduleItem {
  kind: "event" | "task" | "slot";
  id: string;
  title: string;
  localDate: string;
  /** Pre-formatted in the user's zone — use this verbatim, never convert ISO yourself. */
  timeRange: string;
  past: boolean;
  ongoing?: boolean;
  allDay?: boolean;
  /** False when the provider marks the event *free* — it is on the day but does
   *  not consume the hour. Only meaningful for `kind: "event"`. */
  busy?: boolean;
}

// ---------------------------------------------------------------------------
// Zone-aware formatting
// ---------------------------------------------------------------------------

/** Today's calendar date in `tz`. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function localDateISO(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function fmtTimeLocal(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export function fmtTimeRange(startIso: string, endIso: string, tz: string): string {
  return `${fmtTimeLocal(startIso, tz)}–${fmtTimeLocal(endIso, tz)}`;
}

/** A zone's UTC offset in ms at a given instant (DST-correct). */
function tzOffsetMs(tz: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(atMs));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 3_600_000 + Number(m[3]) * 60_000);
}

/**
 * The UTC instant for a wall-clock time on a local date **in `tz`** —
 * "2026-08-14, 480 minutes after midnight, in America/Los_Angeles".
 *
 * The browser can do this with `new Date(y, m, d)` because its local zone *is*
 * the user's. An edge function cannot: it runs in UTC, so the naive version
 * silently reads the work window in the wrong zone. Offset is resolved at the
 * instant itself and re-checked once, so a DST boundary lands correctly.
 */
export function zonedInstant(dateISO: string, minutesAfterMidnight: number, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return NaN;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, minutesAfterMidnight);
  const off1 = tzOffsetMs(tz, guess);
  const ms = guess - off1;
  const off2 = tzOffsetMs(tz, ms);
  return off2 === off1 ? ms : guess - off2;
}

/**
 * Convert a local datetime string ("YYYY-MM-DDTHH:MM") in `tz` to a UTC ISO
 * string. Done server-side to avoid LLM midnight-rollover errors.
 *
 * `tz` is the CALLER'S zone, passed per request — never a constant. The app
 * renders every instant in the device zone ("a 9am block should read as 9am
 * wherever you wake up"), so "3pm" from someone standing in Chicago means 3pm
 * in Chicago. Hardcoding Pacific here silently landed every agent-created block
 * at the wrong hour while travelling.
 */
export function localToUtc(localStr: string, tz: string): string {
  // Treat the local string as UTC to get a reference point, then compute the
  // real zone→UTC offset at that approximate moment and apply it.
  const asIfUtc = new Date(localStr + ":00Z");
  const zoned = asIfUtc
    .toLocaleString("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    })
    .replace(", ", "T");
  const offsetMs = asIfUtc.getTime() - new Date(zoned + "Z").getTime();
  return new Date(asIfUtc.getTime() + offsetMs).toISOString();
}

/** Minutes as a human duration: "45m", "3h", "3h 20m". */
export function fmtMins(mins: number): string {
  if (mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// ---------------------------------------------------------------------------
// Row → day-shaped record
// ---------------------------------------------------------------------------

export function fmtTask(t: Record<string, unknown>, today: string, nowMs: number, tz: string) {
  const startTime = t.start_time as string | null;
  const duration = (t.duration_minutes as number) ?? 30;
  let past = false;
  let ongoing = false;
  let localDate: string | undefined;
  let timeRange: string | undefined;

  if (startTime) {
    const startMs = new Date(startTime).getTime();
    const endMs = startMs + duration * 60_000;
    past = endMs <= nowMs;
    ongoing = startMs <= nowMs && nowMs < endMs;
    localDate = localDateISO(startTime, tz);
    timeRange = fmtTimeRange(startTime, new Date(endMs).toISOString(), tz);
  }

  return {
    id: t.id,
    title: t.title,
    status: t.status,
    doDate: t.do_date,
    // The narrowed local, not the raw `unknown` column — downstream readers do
    // date math on this.
    startTime,
    durationMinutes: duration,
    deadline: t.deadline,
    priority: t.priority,
    notes: t.notes || undefined,
    rollCount: t.roll_count || 0,
    localDate,
    timeRange,
    isToday: localDate === today,
    past,
    ongoing,
  };
}

export function fmtEvent(
  e: Record<string, unknown>,
  today: string,
  now: number,
  tz: string,
  calMeta?: { name?: string; provider?: string },
) {
  const startAt = e.start_at as string;
  const endAt = e.end_at as string;
  const start = startAt ? new Date(startAt).getTime() : null;
  const end = endAt ? new Date(endAt).getTime() : null;
  const localDate = startAt ? localDateISO(startAt, tz) : undefined;
  const allDay = Boolean(e.all_day);

  return {
    id: e.id,
    title: e.title,
    startAt,
    endAt,
    allDay,
    // "Free" on the provider means it does not consume your time. Absent means
    // busy: a caller whose query omits the column must not have its whole
    // calendar silently turn transparent.
    busy: e.busy !== false,
    location: e.location || undefined,
    calendarName: calMeta?.name,
    provider: calMeta?.provider,
    localDate,
    timeRange: startAt && endAt && !allDay ? fmtTimeRange(startAt, endAt, tz) : undefined,
    isToday: localDate === today,
    past: end != null ? end <= now : false,
    ongoing: start != null && end != null ? start <= now && now < end : false,
  };
}

export type DayEvent = ReturnType<typeof fmtEvent>;
export type DayTask = ReturnType<typeof fmtTask>;

// ---------------------------------------------------------------------------
// Visibility — "hidden is out of the ledger"
// ---------------------------------------------------------------------------

/** The slice of `user_settings` that decides what a user can see. */
export interface DayVisibilitySettings {
  hidden_calendar_ids?: string[] | null;
  hidden_events?: { key: string }[] | null;
}

export interface EventVisibility {
  hiddenCalendars: Set<string>;
  isEventHidden: (e: Record<string, unknown>) => boolean;
}

export function makeEventVisibility(settings: DayVisibilitySettings | null | undefined): EventVisibility {
  const hiddenCalendars = new Set<string>(settings?.hidden_calendar_ids ?? []);
  // Individually hidden events — keyed by the stable account_id:provider_event_id
  // (or account_id:series:recurring_event_id for a whole series).
  const hiddenEventKeys = new Set<string>((settings?.hidden_events ?? []).map((h) => h.key));
  const isEventHidden = (e: Record<string, unknown>): boolean => {
    if (hiddenEventKeys.has(`${e.account_id}:${e.provider_event_id}`)) return true;
    return e.recurring_event_id
      ? hiddenEventKeys.has(`${e.account_id}:series:${e.recurring_event_id}`)
      : false;
  };
  return { hiddenCalendars, isEventHidden };
}

/**
 * Hidden-filter + de-duplicate raw `external_events` rows.
 *
 * Two dedup passes, both earned: the same `provider_event_id` arrives from
 * multiple synced accounts (two Google accounts that can both see one calendar),
 * and a secondary `title|start_at` pass catches cross-account duplicates where
 * the provider assigned different ids to the same logical event.
 */
export function visibleEventRows<T extends Record<string, unknown>>(
  rows: T[],
  vis: EventVisibility,
): T[] {
  const seenIds = new Set<string>();
  const seenSlots = new Set<string>();
  return rows
    .filter((e) => !vis.hiddenCalendars.has(e.calendar_id as string) && !vis.isEventHidden(e))
    .filter((e) => {
      const pid = e.provider_event_id as string | null;
      if (pid) {
        if (seenIds.has(pid)) return false;
        seenIds.add(pid);
      }
      const slot = `${e.title}|${e.start_at}`;
      if (seenSlots.has(slot)) return false;
      seenSlots.add(slot);
      return true;
    });
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** Slot children carry no time of their own — the slot is the block — so they
 *  are read by `slot_id`, never by `start_time`. */
export function buildSlotSummaries(
  slotRows: Record<string, unknown>[],
  slotChildren: Record<string, unknown>[],
  tz: string,
  nowMs: number,
): SlotSummary[] {
  return slotRows.map((r) => {
    const startISO = new Date(r.start_time as string).toISOString();
    const duration = (r.duration_minutes as number) ?? 60;
    const endMs = new Date(startISO).getTime() + duration * 60_000;
    return {
      id: r.id as string,
      title: (r.title as string) || "Untitled block",
      timeRange: fmtTimeRange(startISO, new Date(endMs).toISOString(), tz),
      startISO,
      durationMinutes: duration,
      localDate: localDateISO(startISO, tz),
      past: endMs <= nowMs,
      projectId: (r.project_id as string | null) ?? null,
      domainId: (r.domain_id as string | null) ?? null,
      tasks: slotChildren
        .filter((t) => t.slot_id === r.id)
        .map((t) => ({ id: t.id as string, title: t.title as string, status: t.status as string })),
    };
  });
}

// ---------------------------------------------------------------------------
// The day itself
// ---------------------------------------------------------------------------

/** Everything on one calendar date, in clock order. */
export function buildDaySchedule(
  events: DayEvent[],
  scheduled: DayTask[],
  slots: SlotSummary[],
  date: string,
): ScheduleItem[] {
  const items: ScheduleItem[] = [];

  for (const e of events) {
    if (e.localDate !== date) continue;
    items.push({
      kind: "event",
      id: e.id as string,
      title: e.title as string,
      localDate: e.localDate!,
      timeRange: e.allDay ? "all day" : (e.timeRange ?? ""),
      past: e.past,
      ongoing: e.ongoing,
      allDay: e.allDay,
      busy: e.busy,
    });
  }

  for (const t of scheduled) {
    if (!t.startTime || t.localDate !== date) continue;
    items.push({
      kind: "task",
      id: t.id as string,
      title: t.title as string,
      localDate: t.localDate!,
      timeRange: t.timeRange ?? "",
      past: t.past,
      ongoing: t.ongoing,
    });
  }

  // A slot holds the grid exactly like an event does. Leaving them out told the
  // model an hour was open when the user had already claimed it.
  for (const s of slots) {
    if (s.localDate !== date) continue;
    items.push({
      kind: "slot",
      id: s.id,
      title: s.title,
      localDate: s.localDate,
      timeRange: s.timeRange,
      past: s.past,
    });
  }

  items.sort((a, b) => {
    const parse = (s: string) => {
      // Only the START half. Testing AM/PM against the whole range let the
      // meridiem of the *end* time decide: "11:00 AM–12:00 PM" saw a PM and
      // sorted an 11am block as 11pm, dropping it below the afternoon.
      const start = s.split("–")[0];
      const m = start.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return 0;
      let h = Number(m[1]);
      const min = Number(m[2]);
      if (/PM/i.test(start) && h < 12) h += 12;
      if (/AM/i.test(start) && h === 12) h = 0;
      return h * 60 + min;
    };
    return parse(a.timeRange) - parse(b.timeRange);
  });

  return items;
}

/** The gaps between what's already claimed. Future-only: a window that has
 *  already passed is not somewhere work can go. */
/**
 * What is already claimed on a date. One definition, so every reader agrees
 * about the same hour.
 *
 * All-day events are deliberately excluded — an all-day "Conference" marks the
 * day, it doesn't block 9am specifically. Events the provider marks **free**
 * are excluded too: that is the rule `toBusyBlocks` has always applied in the
 * SPA, and an out-of-office or a birthday should not eat your open hours.
 * Slots ARE included: the whole point of holding one is that nothing else gets
 * offered that hour.
 */
export function busyIntervalsFor(
  events: DayEvent[],
  scheduled: DayTask[],
  slots: SlotSummary[],
  date: string,
): Array<{ startMs: number; endMs: number }> {
  const busy: Array<{ startMs: number; endMs: number }> = [];

  for (const ev of events) {
    if (ev.localDate !== date || ev.allDay || !ev.busy || !ev.startAt || !ev.endAt) continue;
    busy.push({ startMs: new Date(ev.startAt).getTime(), endMs: new Date(ev.endAt).getTime() });
  }
  for (const t of scheduled) {
    if (!t.startTime || t.localDate !== date) continue;
    const s = new Date(t.startTime).getTime();
    busy.push({ startMs: s, endMs: s + t.durationMinutes * 60_000 });
  }
  for (const sl of slots) {
    if (sl.localDate !== date) continue;
    const s = new Date(sl.startISO).getTime();
    busy.push({ startMs: s, endMs: s + sl.durationMinutes * 60_000 });
  }

  return busy;
}

export function computeOpenWindows(
  events: DayEvent[],
  scheduled: DayTask[],
  slots: SlotSummary[],
  date: string,
  nowMs: number,
  tz: string,
): OpenWindow[] {
  const busy = busyIntervalsFor(events, scheduled, slots, date).map((b) => ({
    s: b.startMs,
    e: b.endMs,
  }));

  if (busy.length < 2) return [];

  busy.sort((a, b) => a.s - b.s);

  // Merge overlapping intervals
  const merged: Array<{ s: number; e: number }> = [];
  for (const b of busy) {
    if (merged.length && b.s < merged[merged.length - 1].e) {
      merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, b.e);
    } else {
      merged.push({ ...b });
    }
  }

  // Find gaps between consecutive busy blocks, future-only
  const windows: OpenWindow[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const gapStart = Math.max(merged[i].e, nowMs);
    const gapEnd = merged[i + 1].s;
    const mins = Math.floor((gapEnd - gapStart) / 60_000);
    if (mins < MIN_WINDOW_MINUTES) continue;
    const startISO = new Date(gapStart).toISOString();
    const endISO = new Date(gapEnd).toISOString();
    windows.push({ startISO, endISO, timeRange: fmtTimeRange(startISO, endISO, tz), minutes: mins });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// How much room is left — the *other* open-time question
// ---------------------------------------------------------------------------
//
// Note there are deliberately two, and they answer different things:
//
//   computeOpenWindows  — the gaps BETWEEN commitments ("I have 40 minutes,
//                         what fits?"). Needs two blocks to have a gap between
//                         them, so a day with one meeting has no windows.
//   openSpans           — unclaimed minutes INSIDE the working window ("how
//                         much room does this day have?"). A day with one
//                         meeting is mostly open, and this says so.
//
// They used to live in different runtimes under the same intuition, which is
// how the agent could call a day empty of windows while the phone called it
// three hours open. Both live here now, named apart.

/** A span of unclaimed time. Milliseconds in, milliseconds out — the callers
 *  wrap it in whatever date type they use. */
export interface OpenSpan {
  startMs: number;
  endMs: number;
  mins: number;
}

/** Spans shorter than this aren't worth offering as focus time. */
export const MIN_GAP_MINUTES = 10;

/**
 * Walk a working window from the present forward, collecting the open spans
 * between commitments. If you're mid-meeting the first span starts when it ends
 * — you can't focus during it.
 *
 * `busy` may overlap and need not be sorted.
 */
export function openSpans(
  busy: Array<{ startMs: number; endMs: number }>,
  windowStartMs: number,
  windowEndMs: number,
  nowMs: number,
  minGapMinutes: number = MIN_GAP_MINUTES,
): OpenSpan[] {
  const sorted = [...busy].sort((a, b) => a.startMs - b.startMs);
  const current = sorted.find((b) => b.startMs <= nowMs && nowMs < b.endMs);

  let cursor = Math.max(nowMs, windowStartMs);
  if (current) cursor = Math.max(cursor, current.endMs);

  const spans: OpenSpan[] = [];
  const push = (startMs: number, endMs: number) => {
    const mins = Math.round((endMs - startMs) / 60_000);
    if (mins >= minGapMinutes) spans.push({ startMs, endMs, mins });
  };

  for (const b of sorted) {
    if (b.endMs <= cursor || b.startMs >= windowEndMs) continue;
    if (b.startMs > cursor) push(cursor, b.startMs);
    if (b.endMs > cursor) cursor = b.endMs;
  }
  if (cursor < windowEndMs) push(cursor, windowEndMs);

  return spans;
}

/** Total unclaimed minutes in the working window — what a day's readout counts. */
export function openMinutes(spans: OpenSpan[]): number {
  return spans.reduce((s, g) => s + g.mins, 0);
}

// ---------------------------------------------------------------------------
// The voice
// ---------------------------------------------------------------------------

export interface DayReadoutInput {
  /** Timed items + all-day items on the day. */
  busyCount: number;
  /** Minutes still open. */
  openMins: number;
  /** Today, but the working window has already closed. */
  isPast: boolean;
  /** A day before today. */
  isBygone: boolean;
}

/**
 * How a day describes itself, in one phrase. Shared so the phone, the desk and
 * the wrist say the *same words* about the same day — a surface that invents its
 * own phrasing is how one screen reads "fully booked" while another reads
 * "wide open" (Principle 11).
 *
 * `accent` means the phrase is worth `--signal`: only a live day with room left.
 */
export function dayReadout(d: DayReadoutInput): { text: string; accent: boolean } {
  const text = d.isBygone
    ? d.busyCount > 0
      ? `${d.busyCount} scheduled`
      : ""
    : d.isPast
      ? "done for today"
      : d.openMins > 0
        ? `${fmtMins(d.openMins)} open`
        : d.busyCount > 0
          ? "fully booked"
          : "wide open";
  return { text, accent: !d.isBygone && !d.isPast && d.openMins > 0 };
}
