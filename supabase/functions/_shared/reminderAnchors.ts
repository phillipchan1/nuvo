/**
 * Turning rows into reminder anchors — one implementation, both runtimes.
 *
 * This lived in `src/lib/reminders.ts` while reminders only fired in the
 * browser. Background delivery moved it here, and the reason is the whole point
 * of the kernel pattern: the server dispatcher and the open app must agree on
 * **which reminders exist and exactly when each one fires**, down to the second.
 * They race for the same claim (`claim_reminder`), and a claim key is built from
 * the fire instant — so two implementations that disagree by one second would
 * both "win" and the user would be told twice.
 *
 * The one thing that made this hard to share is the deadline: a date, not an
 * instant. "Due today" has to mean 9am *somewhere*, and the browser could lean
 * on the device's own clock while Deno cannot. So the local-time resolver takes
 * an IANA zone explicitly and computes the offset via `Intl` — the same
 * mechanism `src/lib/timezone.ts` already trusts, and DST-correct because the
 * offset is read AT the instant in question rather than assumed.
 *
 * Zero imports beyond the rules themselves. No `Date.now()` — the caller passes
 * the clock, so a test and a cron get the same answers.
 */

import { reminderKey, type ReminderAnchor } from "./reminderRules.ts";

/** How far ahead anchors are built. The longest lead is a day, so two days of
 *  runway covers every reminder that could still fire — and bounds the work. */
export const REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The shapes the builder needs. Deliberately narrower than the app's row types
 *  so the dispatcher can hand it plain PostgREST rows without a mapping layer. */
export interface AnchorTask {
  id: string;
  title: string;
  status: string;
  start_time: string | null;
  deadline: string | null;
}

export interface AnchorSlot {
  id: string;
  title: string;
  start_time: string;
}

export interface AnchorEvent {
  id: string;
  account_id: string;
  provider_event_id: string;
  title: string;
  start_at: string;
  all_day: boolean;
  location: string | null;
  self_rsvp?: string | null;
  recurring_event_id?: string | null;
}

export interface AnchorInputs {
  tasks: AnchorTask[];
  slots: AnchorSlot[];
  events: AnchorEvent[];
  /** `user_settings.hidden_events` keys. A hidden event is out of the busy math,
   *  so it is out of the reminder set too — the same doctrine as the ledger. */
  hiddenKeys: ReadonlySet<string>;
  /** Minutes after local midnight a deadline speaks on its day. */
  deadlineTimeMinutes: number;
  /** IANA zone the deadline is resolved in. Empty/unknown falls back to UTC —
   *  never to a hardcoded home zone. */
  timeZone?: string | null;
  nowMs: number;
  windowMs?: number;
  /** Optional trailing clause on a task's reminder (a project name). */
  detailForTask?: (t: AnchorTask) => string | null;
}

/**
 * The instant at which a local wall-clock time occurs in `timeZone`.
 *
 * `Date.UTC(...)` gives the instant as if the wall clock were UTC; the zone's
 * offset at that moment is then subtracted. Read at the instant rather than
 * assumed, so the hour after a DST change is right rather than an hour out.
 */
export function instantForLocalTime(
  dateISO: string,
  minutesAfterMidnight: number,
  timeZone?: string | null,
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return NaN;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    + minutesAfterMidnight * 60_000;
  const zone = timeZone || "UTC";
  if (zone === "UTC") return asUtc;
  return asUtc - zoneOffsetMs(asUtc, zone);
}

/** A zone's offset from UTC at an instant, in ms. Positive east of Greenwich. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  try {
    // `en-CA` gives YYYY-MM-DD; `hourCycle: h23` avoids the "24" some engines
    // emit at midnight, which parses as the wrong day.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(instantMs))) parts[p.type] = p.value;
    const asIfUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return asIfUtc - instantMs;
  } catch {
    // An unknown zone must not silently become one operator's own.
    return 0;
  }
}

/** `account_id:provider_event_id` — the resync-stable identity of an event. */
export function eventKeyOf(e: Pick<AnchorEvent, "account_id" | "provider_event_id">): string {
  return `${e.account_id}:${e.provider_event_id}`;
}

function eventIsHidden(e: AnchorEvent, hidden: ReadonlySet<string>): boolean {
  if (hidden.size === 0) return false;
  if (hidden.has(eventKeyOf(e))) return true;
  return e.recurring_event_id ? hidden.has(`${e.account_id}:series:${e.recurring_event_id}`) : false;
}

export function buildReminderAnchors(input: AnchorInputs): ReminderAnchor[] {
  const { tasks, slots, events, hiddenKeys, deadlineTimeMinutes, nowMs } = input;
  const horizon = nowMs + (input.windowMs ?? REMINDER_WINDOW_MS);
  // A reminder is only ever about the near future. Anything already well past is
  // the delivery loop's problem (its grace window), not the anchor list's.
  const inWindow = (ms: number) => Number.isFinite(ms) && ms <= horizon && ms > nowMs - 60 * 60_000;

  const out: ReminderAnchor[] = [];

  for (const t of tasks) {
    if (t.status === "done" || t.status === "trashed") continue;

    if (t.start_time) {
      const atMs = Date.parse(t.start_time);
      if (inWindow(atMs)) {
        out.push({
          key: reminderKey("task", t.id, "start"),
          targetKind: "task",
          targetId: t.id,
          anchor: "start",
          atMs,
          title: t.title,
          detail: input.detailForTask?.(t) ?? null,
        });
      }
    }

    if (t.deadline) {
      const atMs = instantForLocalTime(t.deadline, deadlineTimeMinutes, input.timeZone);
      if (inWindow(atMs)) {
        out.push({
          key: reminderKey("task", t.id, "deadline"),
          targetKind: "task",
          targetId: t.id,
          anchor: "deadline",
          atMs,
          title: t.title,
          detail: input.detailForTask?.(t) ?? null,
        });
      }
    }
  }

  for (const s of slots) {
    const atMs = Date.parse(s.start_time);
    if (!inWindow(atMs)) continue;
    out.push({
      key: reminderKey("slot", s.id, "start"),
      targetKind: "slot",
      targetId: s.id,
      anchor: "start",
      atMs,
      title: s.title || "Block",
      detail: null,
    });
  }

  for (const e of events) {
    // An all-day event has no moment to be early for, a declined one isn't
    // yours, and a hidden one is already out of the busy math.
    if (e.all_day) continue;
    if (e.self_rsvp === "declined") continue;
    if (eventIsHidden(e, hiddenKeys)) continue;
    const atMs = Date.parse(e.start_at);
    if (!inWindow(atMs)) continue;
    out.push({
      // Keyed by the PROVIDER key, not the mirror row id: a resync renumbers
      // `external_events.id`, and a reminder pinned to it would silently detach
      // — and, worse, would claim under a key the other side can't reproduce.
      key: reminderKey("event", eventKeyOf(e), "start"),
      targetKind: "event",
      targetId: e.id,
      anchor: "start",
      atMs,
      title: e.title || "Untitled event",
      detail: e.location || null,
    });
  }

  return out;
}
