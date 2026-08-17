import type { Energy } from "./energy";
import type { RecurrenceRule } from "./recurrence";
import type { MeetPreference } from "../../supabase/functions/_shared/conferencing.ts";
import type {
  LeadMinutes,
  ReminderAnchorKind,
  ReminderPrefs,
  ReminderTargetKind,
} from "../../supabase/functions/_shared/reminderRules.ts";
import type { SavedView } from "../../supabase/functions/_shared/taskQuery.ts";

// inbox = raw capture · backlog = processed, deliberately undated (never in
// inbox, never on Today, never rolls) · planned = dated · done/trashed.
export type TaskStatus = "inbox" | "backlog" | "planned" | "done" | "trashed";
export type TaskPriority = "none" | "low" | "medium" | "high";
export type CalendarProvider = "google" | "m365" | "ics" | "icloud";

/**
 * Passive grooming's cached guess for a raw inbox capture — where it likely
 * belongs, how long it takes, its energy register. A proposal only: the real
 * placement FKs / duration / energy stay untouched until the user accepts.
 * Written by the `enrichInbox` edge path; gated on `sig` (title+notes) staleness.
 */
export interface InboxSuggestion {
  sig: string;
  level: "project" | "initiative" | "domain" | "none";
  targetId: string | null;
  targetLabel: string;
  domainId: string | null;
  domainColor: string | null;
  durationMinutes: number | null;
  energy: Energy | null;
  rationale: string;
  confidence: number;
  /** Set once the user has accepted or dismissed it — stops re-grooming until the capture changes. */
  dismissed?: boolean;
}

export interface Task {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  notes: string;
  status: TaskStatus;
  do_date: string | null; // 'YYYY-MM-DD'
  start_time: string | null; // timestamptz ISO
  duration_minutes: number | null;
  deadline: string | null; // 'YYYY-MM-DD'
  priority: TaskPriority;
  roll_count: number;
  completed_at: string | null;
  /** When it was trashed. Sorts the trash view; cleared on restore. */
  trashed_at: string | null;
  project_id: string | null;
  initiative_id: string | null;
  domain_id: string | null;
  /** the key result this task moves — the outcome it serves, if any. */
  key_result_id: string | null;
  sprint_id: string | null;
  /** the priority (big rock) this task serves — see {@link BigRock}. */
  big_rock_id: string | null;
  energy: Energy | null;
  assignee: "me" | "agent";
  prework: string;
  prework_at: string | null;
  suggestion: InboxSuggestion | null;
  suggested_at: string | null;
  google_event_id: string | null;
  sort_order: number;
  slot_id: string | null;
  /**
   * Set when this row is a STEP of another task — a checklist item, not a task.
   *
   * A step is deliberately less than a task: it has a title, a done state and an
   * order, and is forbidden every field that would make it schedulable (the DB
   * enforces this — migration 60). It never appears on the calendar, in the
   * inbox, in capacity, or in any funnel rollup, which is what keeps the funnel
   * at four pools rather than five (Principle 10). One level only.
   */
  parent_task_id: string | null;
  /** Set when this row is one occurrence of a repeating series. */
  recurrence_id: string | null;
  recurrence_date: string | null; // the occurrence's date, 'YYYY-MM-DD'
  recurrence_overridden: boolean; // a THIS-scope edit pinned this occurrence
  task_labels?: { label_id: string }[];
}

/**
 * A Time Slot: a first-class timed container on the calendar that holds many
 * tasks. Its start/duration are independent of the tasks inside it — children
 * carry slot_id (and start_time null), ordered by sort_order. No done-state of
 * its own; progress is derived from its children (n done / m total).
 */
export interface Slot {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  do_date: string; // 'YYYY-MM-DD'
  start_time: string; // timestamptz ISO
  duration_minutes: number;
  project_id: string | null;
  domain_id: string | null;
  color: string | null;
  google_event_id: string | null;
  recurrence_id: string | null;
  recurrence_date: string | null;
  recurrence_overridden: boolean;
}

/**
 * A repeating series: the rule + the template every occurrence is stamped from.
 * Occurrences are real `tasks`/`slots` rows (materialized up to a horizon), not
 * virtual instances — see src/lib/recurrence.ts and useRecurrence.ts.
 */
export interface Recurrence {
  id: string;
  user_id: string;
  kind: "task" | "slot";
  freq: RecurrenceRule["freq"];
  interval: number;
  byweekday: number[];
  bymonthday: number | null;
  /** Positional rule: the nth weekday of the month (1-4, or -1 = last).
   *  Mutually exclusive with `bymonthday` — see the recurrence kernel. */
  bysetpos: number | null;
  /** Yearly only: 1-12. Null = the anchor's own month. */
  bymonth: number | null;
  anchor_date: string; // 'YYYY-MM-DD'
  until_date: string | null;
  max_count: number | null;
  exdates: string[];
  title: string;
  duration_minutes: number;
  time_of_day_minutes: number | null; // start as minutes after midnight; null = no block
  project_id: string | null;
  domain_id: string | null;
  priority: TaskPriority;
  color: string | null;
  active: boolean;
  last_materialized: string | null;
}

/** Read a series' rule back out of its stored columns. */
export function ruleOf(r: Recurrence): RecurrenceRule {
  return {
    freq: r.freq,
    interval: r.interval,
    byweekday: r.byweekday,
    bymonthday: r.bymonthday,
    bysetpos: r.bysetpos,
    bymonth: r.bymonth,
    until: r.until_date,
    count: r.max_count,
  };
}

/**
 * Where a not-done, not-trashed task rests when it loses its date: dated →
 * planned; parented or week-committed → backlog (processed); else → inbox.
 * The single source of truth for the status state machine — every mutation
 * that un-dates or un-completes a task goes through this.
 */
export function restingStatus(
  t: Pick<Task, "do_date" | "project_id" | "initiative_id" | "domain_id" | "sprint_id">,
): TaskStatus {
  if (t.do_date) return "planned";
  if (t.project_id || t.initiative_id || t.domain_id || t.sprint_id) return "backlog";
  return "inbox";
}

/**
 * A "big rock" — one of the week's named OUTCOMES that sit above the task
 * funnel (a rock is served by tasks and time, in service of a bet). Held on
 * Today all week, read back in the Gain. Stored as `big_rocks` jsonb on the
 * sprint row, so a rock is per-week, like the goal and the lead bets. How many
 * you set is up to the week — some weeks two, some weeks five.
 */
export interface BigRock {
  id: string;
  title: string;
  /** what winning looks like — the definition of done, in one line. */
  win: string;
  /** the lead bet it serves (the up-link that powers drift reads); optional. */
  initiative_id: string | null;
  /** an existing project this priority spotlights (its work = the project's); optional. */
  project_id?: string | null;
  /** set when it's checked off as moved this week. */
  done_at: string | null;
  /** weeks it has been carried forward unfinished — a rock that won't die. */
  roll_count: number;
}

/** The week as a real entity: goal + lead initiatives + the three + review state. */
export interface Sprint {
  id: string;
  user_id: string;
  week_start: string; // Monday, 'YYYY-MM-DD'
  goal: string;
  focus_initiative_ids: string[];
  /** the week's big rocks — a small, varying set; see {@link BigRock}. */
  big_rocks: BigRock[];
  reviewed_at: string | null;
  /** dayISO -> compose context ('normal' | 'light' | 'travel' | 'off'). */
  day_contexts: Record<string, string>;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface CalendarInfo {
  id: string;
  summary: string;
  color: string | null;
  visible: boolean;
}

export interface CalendarAccount {
  id: string;
  provider: CalendarProvider;
  email: string;
  sync_direction: "two_way" | "read_only";
  calendars: CalendarInfo[];
  mirror_calendar_id: string | null;
  needs_reconnect: boolean;
}

export interface ExternalEvent {
  id: string;
  account_id: string;
  provider_event_id: string;
  calendar_id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  busy: boolean;
  /** Master series event ID from Google — present on recurring instances.
   *  Populated once migration 00000000000007 is applied; omitted before that. */
  recurring_event_id?: string | null;
  /** The user's own RSVP on this event (null = organizer / no attendees = confirmed). */
  self_rsvp?: AttendeeStatus | null;
}

export type RecurrenceScope = "THIS" | "FOLLOWING" | "ALL";

export interface UserSettings {
  user_id: string;
  theme: "system" | "light" | "dark";
  day_start_hour: number;
  day_end_hour: number;
  /** Hours of the day view that fill the screen before scrolling. */
  calendar_fit_hours: number;
  week_start: number;
  work_start_minutes: number; // compose boundary: blocks proposed inside these
  work_end_minutes: number;
  /** The duration a new task/slot/recurring series gets when nothing says
   *  otherwise — capture with no stated length, "Add" in Recurring upkeep, etc.
   *  Falls back to `DEFAULT_DURATION_MINUTES` (30) until the user changes it. */
  default_task_duration_minutes: number;
  hidden_calendar_ids: string[];
  /** Individually hidden events (Fantastical-style hide, not delete). Kept out of
   *  the board AND the busy/availability math. Keyed by the stable event key so a
   *  re-sync can't resurface them; title is stored for the Settings list. */
  hidden_events: HiddenEvent[];
  /** Subscribed-calendar id → domain id. Every event from that calendar is
   *  attributed to the domain (the deterministic default behind time allocation). */
  calendar_domain_map: Record<string, string>;
  last_rollover_date: string | null;
  /** Show a weather icon + high temp in calendar day headers. Requires location permission. */
  show_weather: boolean;
  /** calendar_accounts.id to use when Nuvo creates new Google Calendar events. Null = first connected account. */
  default_calendar_account_id: string | null;
  /** When Nuvo attaches a Google Meet link to events it creates — "guests"
   *  (default), "always" or "never". Google never applies its own auto-
   *  conferencing setting to API-created events, so this is the only thing that
   *  decides. Rule + values live in _shared/conferencing.ts. */
  auto_add_meet: MeetPreference;
  /** The ORIENTATION_VERSION the user last finished/skipped. Null = never seen. The
   *  welcome re-surfaces when this is null or below the current version in code. */
  onboarding_completed_version: number | null;
  /** When the app is allowed to speak first, and how far ahead. Defaults are
   *  silent (`enabled: false`); the rules live in _shared/reminderRules.ts. */
  reminder_prefs: ReminderPrefs;
  /** Named task queries. Not a pool — a view holds a question, never work.
   *  The shape and the predicate live in _shared/taskQuery.ts. */
  saved_views: SavedView[];
  /** IANA zone, kept fresh from the device. The server reads it to resolve a
   *  deadline DATE into an instant — a cron has no device to ask. Null = UTC,
   *  never a hardcoded home zone. */
  time_zone: string | null;
}

/**
 * A reminder OVERRIDE — the only reminders that are rows.
 *
 * The common case (every meeting gets a 10-minute heads-up) is derived from
 * `user_settings.reminder_prefs` and never stored, so this table holds only what
 * the user said about one specific item: a different lead, or `lead_minutes:
 * null` meaning "not this one". See `planReminders` in _shared/reminderRules.ts.
 */
export interface Reminder {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  target_kind: ReminderTargetKind;
  anchor: ReminderAnchorKind;
  /** tasks.id / slots.id — null for an external event. */
  target_id: string | null;
  /** `account_id:provider_event_id` — the resync-stable key for an event. */
  event_key: string | null;
  /** Minutes before the anchor; null = silenced for this item. */
  lead_minutes: LeadMinutes;
  fire_at: string | null;
}

/** One hidden calendar event. `key` is `account_id:provider_event_id` for a single
 *  occurrence, or `account_id:series:recurring_event_id` for a whole series. */
export interface HiddenEvent {
  key: string;
  title: string;
}

// ── Activity sources — completed work pulled from the world as actuals ────
// The second instance of the calendar-allocation pattern: GitHub merged PRs.
// See docs/activity-sources.md.

/** One repository a source can see (for the bind picker). */
export interface ActivityRepo {
  full_name: string;
  pushed_at: string | null;
  private: boolean;
}

/** A connected external feed of completed work (currently only GitHub). */
export interface ActivitySource {
  id: string;
  kind: "github";
  login: string | null;
  avatar_url: string | null;
  repos: ActivityRepo[];
  needs_reconnect: boolean;
  last_synced_at: string | null;
}

/** repo → project. A repo ≈ a project; the domain is inherited via rollup. */
export interface ActivityBinding {
  id: string;
  source_id: string;
  project_id: string;
  selector: string; // repo full_name
}

/** One unit of completed work — a merged PR. */
export interface ActivityUnit {
  id: string;
  source_id: string;
  kind: "github";
  external_id: string;
  title: string;
  url: string | null;
  selector: string | null;
  project_id: string | null;
  occurred_at: string;
}

/** Loose / quick captures when no estimate was given. */
export const DEFAULT_DURATION_MINUTES = 30;
/** Project-backed steps — matches `MIN_PROJECT_BLOCK` in compose; never stamp 20. */
export const DEFAULT_PROJECT_DURATION_MINUTES = 45;
/** Shared sitting presets — grooming, CreateRecord, task record, Plan-the-week Pull. */
export const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 180, 240] as const;
export type DurationPreset = (typeof DURATION_PRESETS)[number];

// ── Google Calendar raw event shape (subset we use) ──────────────────────
export type AttendeeStatus = "needsAction" | "accepted" | "declined" | "tentative";

export interface GoogleAttendee {
  email: string;
  displayName?: string;
  responseStatus: AttendeeStatus;
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
}

export interface GoogleRawEvent {
  attendees?: GoogleAttendee[];
  /** `self` is Google's flag for "you are the organizer" — the difference
   *  between leaving a meeting and cancelling it for everyone. */
  organizer?: { email: string; displayName?: string; self?: boolean };
  description?: string;
  htmlLink?: string;
  /** Legacy join link. Google still sets it on older events and on some events
   *  created by other clients, so reading only `conferenceData` misses meetings
   *  that really do have a link — read both through `joinUrl()`. */
  hangoutLink?: string;
  conferenceData?: {
    conferenceSolution?: { name?: string };
    entryPoints?: Array<{
      entryPointType: "video" | "phone" | "more" | string;
      uri: string;
      label?: string;
    }>;
  };
  /** Present on a Google recurring instance; absent otherwise. */
  recurringEventId?: string;
  /** Present on the series master; instances synced with singleEvents=true omit this. */
  recurrence?: string[];
}

// ── Microsoft Graph raw event shape (subset we use) ───────────────────────
// m365-sync stores the Graph event resource verbatim in `raw` — a different
// vocabulary from Google's (attendees[].emailAddress.address vs .email,
// body.content vs description, onlineMeeting.joinUrl vs hangoutLink…).
// `bodyPreview` is a Graph-exclusive key present on every event resource
// (even as ""), so its presence is what tells `normalizeRawEvent` which
// shape it's holding.
export interface GraphAttendee {
  emailAddress?: { address?: string; name?: string };
  status?: { response?: string };
  type?: "required" | "optional" | "resource";
}

export interface GraphRawEvent {
  bodyPreview?: string;
  attendees?: GraphAttendee[];
  organizer?: { emailAddress?: { address?: string; name?: string } };
  body?: { contentType?: "text" | "html"; content?: string };
  webLink?: string;
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingProvider?: string;
  /** Present on a Graph recurring instance; absent otherwise. */
  seriesMasterId?: string;
}

export type ProviderRawEvent = GoogleRawEvent | GraphRawEvent;

function mapGraphResponseStatus(response: string | undefined): AttendeeStatus {
  switch (response) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    default:
      return "needsAction";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Every consumer of `external_events.raw` (SlideOver's EventPopover,
 * MobileEventSheet, `joinUrl`/`conferenceName` in `conferencing.ts`) only
 * understands Google's field names. Rather than teach each of them both
 * provider vocabularies, normalize Microsoft Graph's shape into Google's
 * once, at the read boundary (`useEventDetails`) — Google payloads pass
 * through untouched.
 *
 * `ownerEmail` (the connected account's own address) resolves what Graph
 * doesn't mark directly: Google flags the calendar owner's own attendee row
 * with `self: true` and its own event's `organizer.self`; Graph has neither,
 * so we match by email instead.
 */
export function normalizeRawEvent(
  raw: ProviderRawEvent | null | undefined,
  ownerEmail?: string | null,
): GoogleRawEvent | null {
  if (!raw) return null;
  if (!("bodyPreview" in raw)) return raw as GoogleRawEvent;

  const g = raw as GraphRawEvent;
  const owner = ownerEmail?.toLowerCase();
  const organizerEmail = g.organizer?.emailAddress?.address;

  const attendees: GoogleAttendee[] | undefined = g.attendees?.map((a) => {
    const email = a.emailAddress?.address ?? "";
    return {
      email,
      displayName: a.emailAddress?.name,
      responseStatus: mapGraphResponseStatus(a.status?.response),
      self: owner ? email.toLowerCase() === owner : undefined,
      organizer: organizerEmail ? email.toLowerCase() === organizerEmail.toLowerCase() : undefined,
      optional: a.type === "optional",
    };
  });

  const description =
    g.body?.contentType === "html"
      ? g.body.content
      : g.body?.content || g.bodyPreview
        ? escapeHtml(g.body?.content ?? g.bodyPreview ?? "").replace(/\n/g, "<br>")
        : undefined;

  const joinLink = g.onlineMeeting?.joinUrl;

  return {
    attendees,
    organizer: organizerEmail
      ? {
          email: organizerEmail,
          displayName: g.organizer?.emailAddress?.name,
          self: owner ? organizerEmail.toLowerCase() === owner : undefined,
        }
      : undefined,
    description,
    htmlLink: g.webLink,
    conferenceData: joinLink
      ? {
          conferenceSolution: {
            name: g.onlineMeetingProvider === "teamsForBusiness" ? "Microsoft Teams" : "online meeting",
          },
          entryPoints: [{ entryPointType: "video", uri: joinLink }],
        }
      : undefined,
    recurringEventId: g.seriesMasterId,
  };
}
