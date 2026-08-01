// The shape of what the model is shown — the snapshot's types, and the one
// function that turns a snapshot into prompt text.
//
// Separated from context.ts (which reads the database) so a fixture world in
// the conformance battery goes through the SAME serializer the deployed agent
// uses. A battery that built its own snapshot string would be testing a chat
// that reads a document nobody sends.
//
// Zero imports, zero side effects.

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
  /** Pre-formatted in America/Los_Angeles — use this verbatim, never convert ISO yourself. */
  timeRange: string;
  past: boolean;
  ongoing?: boolean;
  allDay?: boolean;
}

/** A project committed to the planning week — the app's own definition of a
 *  week priority. Derived from the project's On Deck span, never stored. */
export interface SlateProject {
  id: string;
  name: string;
  outcome: string | null;
  status: string;
  domainId: string | null;
  startDate: string | null;
  targetDate: string | null;
  /** the stored per-week verdict, when one exists (big_rocks joined by project) */
  priorityId: string | null;
  landed: boolean;
  shipped: boolean;
  /** open work filed under it — what "pull the work" actually pulls from */
  openTasks: { id: string; title: string; status: string; durationMinutes: number; rollCount: number; scheduled: boolean }[];
  openTaskCount: number;
  scheduledTaskCount: number;
}

export interface AgentContext {
  today: string;
  /** Absolute current time, so the model can tell past from upcoming. */
  nowISO: string;
  /** Human current time in the user's zone, e.g. "Fri, 2:30 PM". */
  nowLabel: string;
  /** UTC offset for America/Los_Angeles right now, e.g. "-07:00". Use this when building start_time ISO strings for tools — user-stated times are always in this zone. */
  laUtcOffset: string;
  rangeStart: string;
  rangeEnd: string;
  settings: { dayStartHour: number; dayEndHour: number } | null;
  /** Pre-filtered timed items for today (the user's zone). Primary source for "what's on today" — events, scheduled tasks AND slots, because all three occupy the grid. */
  todaySchedule: ScheduleItem[];
  /** Pre-computed open windows today (≥30 min, future-only, between real busy blocks). Use this for all availability questions — never count gaps from todaySchedule yourself. */
  todayOpenWindows: OpenWindow[];
  /** The Slots the user holds in the loaded range — blocks of time that own several tasks. To put work inside one, use add_to_slot with its id; to hold new time, create_slot. */
  todaySlots: SlotSummary[];
  inbox: unknown[];
  /** Tasks with do_date=today but no start_time — not on the calendar. */
  todayTasks: unknown[];
  scheduled: unknown[];
  /** Monday of the planning week (Sundays plan the week ahead). */
  weekStart: string;
  /** THE WEEK'S SLATE — the projects committed to this week. This is what the
   *  app's own week surfaces show as the week's priorities, so it is the honest
   *  answer to "what am I moving this week", not weekPriorities. */
  weekSlate: SlateProject[];
  /** Open projects with no week yet — the candidates to bring in ("needs a sprint"). */
  needsASprint: { id: string; name: string; outcome: string | null; domainId: string | null; openTaskCount: number }[];
  /** Projects committed to NEXT week — what's already queued behind this one. */
  nextWeekSlate: { id: string; name: string; startDate: string | null; targetDate: string | null }[];
  /** This week's sprint goal, if a sprint row exists. */
  sprintGoal: string | null;
  /** The stored per-week VERDICT records (big_rocks). One exists only once a
   *  push has been checked off or annotated — an empty list does NOT mean the
   *  week has no priorities. Read weekSlate for that. */
  weekPriorities: unknown[];
  /** Tasks committed to this week's sprint and not yet done. */
  weekPool: unknown[];
  events: unknown[];
  /** Writable calendars the agent may create on or move events to (Google +
   *  iCloud), excluding any the user has hidden from their board. Exactly one
   *  carries `isDefault` — that's where anything unnamed goes. */
  writableCalendars: {
    accountId: string;
    provider: string;
    accountEmail: string;
    calendarId: string;
    name: string;
    isDefault?: true;
  }[];
  labels: { id: string; name: string }[];
  /** Life structure — use ids from here when creating/updating vertical entities. */
  vertical: {
    domains: unknown[];
    initiatives: unknown[];
    projects: unknown[];
  };
}


export function contextToPrompt(ctx: AgentContext): string {
  return `Internal note for you only: "id" fields are for tool calls — never paste them in user-facing replies.

${JSON.stringify(ctx, null, 2)}`;
}
