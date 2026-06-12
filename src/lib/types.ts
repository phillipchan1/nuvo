import type { Energy } from "./energy";

// inbox = raw capture · backlog = processed, deliberately undated (never in
// inbox, never on Today, never rolls) · planned = dated · done/trashed.
export type TaskStatus = "inbox" | "backlog" | "planned" | "done" | "trashed";
export type TaskPriority = "none" | "low" | "medium" | "high";
export type CalendarProvider = "google" | "m365";

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
  energy: Energy | null;
  assignee: "me" | "agent";
  prework: string;
  prework_at: string | null;
  google_event_id: string | null;
  sort_order: number;
  slot_id: string | null;
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

/** The week as a real entity: goal + lead initiatives + Sunday review state. */
export interface Sprint {
  id: string;
  user_id: string;
  week_start: string; // Monday, 'YYYY-MM-DD'
  goal: string;
  focus_initiative_ids: string[];
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
}

export type RecurrenceScope = "THIS" | "ALL";

export interface UserSettings {
  user_id: string;
  theme: "system" | "light" | "dark";
  day_start_hour: number;
  day_end_hour: number;
  week_start: number;
  work_start_minutes: number; // compose boundary: blocks proposed inside these
  work_end_minutes: number;
  hidden_calendar_ids: string[];
  last_rollover_date: string | null;
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
