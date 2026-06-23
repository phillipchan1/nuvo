import type { Energy } from "./energy";
import type { RecurrenceRule } from "./recurrence";

// inbox = raw capture · backlog = processed, deliberately undated (never in
// inbox, never on Today, never rolls) · planned = dated · done/trashed.
export type TaskStatus = "inbox" | "backlog" | "planned" | "done" | "trashed";
export type TaskPriority = "none" | "low" | "medium" | "high";
export type CalendarProvider = "google" | "m365" | "ics";

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
  project_id: string | null;
  initiative_id: string | null;
  domain_id: string | null;
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
  hidden_calendar_ids: string[];
  /** Individually hidden events (Fantastical-style hide, not delete). Kept out of
   *  the board AND the busy/availability math. Keyed by the stable event key so a
   *  re-sync can't resurface them; title is stored for the Settings list. */
  hidden_events: HiddenEvent[];
  /** Subscribed-calendar id → domain id. Every event from that calendar is
   *  attributed to the domain (the deterministic default behind time allocation). */
  calendar_domain_map: Record<string, string>;
  last_rollover_date: string | null;
}

/** One hidden calendar event. `key` is `account_id:provider_event_id` for a single
 *  occurrence, or `account_id:series:recurring_event_id` for a whole series. */
export interface HiddenEvent {
  key: string;
  title: string;
}

export const DEFAULT_DURATION_MINUTES = 30;

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
  organizer?: { email: string; displayName?: string };
  description?: string;
  htmlLink?: string;
  conferenceData?: {
    conferenceSolution?: { name?: string };
    entryPoints?: Array<{
      entryPointType: "video" | "phone" | "more" | string;
      uri: string;
      label?: string;
    }>;
  };
}
