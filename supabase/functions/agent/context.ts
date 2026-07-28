import { admin } from "../_shared/admin.ts";
import {
  buildWritableCalendars,
  offerableCalendars,
  type RawCalendarAccount,
} from "./calendars.ts";
// The week's rules — derived here from the same kernel the app derives them
// from, so "what is on this week" cannot mean two things. Never re-implement
// one of these locally; tests/planning-kernel.test.ts fails if you do.
import {
  fromProjectRow,
  isCompleteStatus,
  isOnSlate,
  isOpenProjectStatus,
  needsASprint,
  planningWeekStart,
  spansWeek,
} from "../_shared/planningRules.ts";

/** Fallback when the client didn't say where it is — the app's established home. */
const FALLBACK_TZ = "America/Los_Angeles";

/** Today's calendar date in `tz`. */
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const TASK_COLS =
  "id, title, status, do_date, start_time, duration_minutes, deadline, priority, notes, roll_count";
const MIN_SLOT_MINUTES = 30;

export interface FreeSlot {
  startISO: string;
  endISO: string;
  /** Pre-formatted in America/Los_Angeles */
  timeRange: string;
  minutes: number;
}

export interface ScheduleItem {
  kind: "event" | "task";
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
  /** Pre-filtered timed items for today (LA calendar). Primary source for "what's on today". */
  todaySchedule: ScheduleItem[];
  /** Pre-computed open windows today (≥30 min, future-only, between real busy blocks). Use this for all availability questions — never count gaps from todaySchedule yourself. */
  todayFreeSlots: FreeSlot[];
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

function localDateISO(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function fmtTimeLocal(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function fmtTimeRange(startIso: string, endIso: string, tz: string): string {
  return `${fmtTimeLocal(startIso, tz)}–${fmtTimeLocal(endIso, tz)}`;
}

function fmtTask(t: Record<string, unknown>, today: string, nowMs: number, tz: string) {
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
    startTime: t.start_time,
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

function fmtEvent(
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

function buildTodaySchedule(
  events: ReturnType<typeof fmtEvent>[],
  scheduled: ReturnType<typeof fmtTask>[],
  today: string,
): ScheduleItem[] {
  const items: ScheduleItem[] = [];

  for (const e of events) {
    if (e.localDate !== today) continue;
    items.push({
      kind: "event",
      id: e.id as string,
      title: e.title as string,
      localDate: e.localDate!,
      timeRange: e.allDay ? "all day" : (e.timeRange ?? ""),
      past: e.past,
      ongoing: e.ongoing,
      allDay: e.allDay,
    });
  }

  for (const t of scheduled) {
    if (!t.startTime || t.localDate !== today) continue;
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

  items.sort((a, b) => {
    const parse = (s: string) => {
      const m = s.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return 0;
      let h = Number(m[1]);
      const min = Number(m[2]);
      if (/PM/i.test(s) && h < 12) h += 12;
      if (/AM/i.test(s) && h === 12) h = 0;
      return h * 60 + min;
    };
    return parse(a.timeRange) - parse(b.timeRange);
  });

  return items;
}

function computeFreeSlots(
  events: ReturnType<typeof fmtEvent>[],
  scheduled: ReturnType<typeof fmtTask>[],
  today: string,
  nowMs: number,
  tz: string,
): FreeSlot[] {
  const busy: Array<{ s: number; e: number }> = [];

  for (const ev of events) {
    if (ev.localDate !== today || ev.allDay || !ev.startAt || !ev.endAt) continue;
    busy.push({ s: new Date(ev.startAt).getTime(), e: new Date(ev.endAt).getTime() });
  }
  for (const t of scheduled) {
    if (!t.startTime || t.localDate !== today) continue;
    const s = new Date(t.startTime).getTime();
    busy.push({ s, e: s + t.durationMinutes * 60_000 });
  }

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
  const slots: FreeSlot[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const gapStart = Math.max(merged[i].e, nowMs);
    const gapEnd = merged[i + 1].s;
    const mins = Math.floor((gapEnd - gapStart) / 60_000);
    if (mins < MIN_SLOT_MINUTES) continue;
    const startISO = new Date(gapStart).toISOString();
    const endISO = new Date(gapEnd).toISOString();
    slots.push({ startISO, endISO, timeRange: fmtTimeRange(startISO, endISO, tz), minutes: mins });
  }
  return slots;
}

export async function buildContext(
  userId: string,
  rangeStart?: string,
  rangeEnd?: string,
  /** The client's zone — the whole snapshot (today, now, day boundaries, every
   *  formatted time) is built in it, so the model reasons about the day the user
   *  is actually standing in. */
  tz: string = FALLBACK_TZ,
): Promise<AgentContext> {
  const today = todayIn(tz);
  const now = new Date();
  const nowMs = now.getTime();
  const nowLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  // Derive the zone's current UTC offset (handles DST automatically).
  const laOffsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const laUtcOffset = (laOffsetParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-07:00").replace("GMT", "");
  const start = rangeStart ?? new Date(now.getTime() - 7 * 86400_000).toISOString();
  const end = rangeEnd ?? new Date(now.getTime() + 7 * 86400_000).toISOString();

  const [inboxRes, todayRes, scheduledRes, eventsRes, labelsRes, settingsRes, domainsRes, initiativesRes, projectsRes, accountsRes] = await Promise.all([
    admin
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", userId)
      .eq("status", "inbox")
      .order("sort_order")
      .order("created_at"),
    admin
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", userId)
      .eq("do_date", today)
      .in("status", ["planned", "done"])
      .order("sort_order")
      .order("created_at"),
    admin
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", userId)
      .not("start_time", "is", null)
      .in("status", ["planned", "done"])
      .gte("start_time", start)
      .lt("start_time", end),
    admin
      .from("external_events")
      .select("id, title, start_at, end_at, all_day, location, calendar_id, account_id, provider_event_id, recurring_event_id")
      .eq("user_id", userId)
      .lt("start_at", end)
      .gt("end_at", start),
    admin.from("labels").select("id, name").eq("user_id", userId).order("name"),
    admin
      .from("user_settings")
      .select(
        "day_start_hour, day_end_hour, hidden_calendar_ids, hidden_events, default_calendar_account_id",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("domains").select("id, name, intention, charter, context, icon, color, weekly_target_hours").eq("user_id", userId).order("sort_order"),
    admin.from("initiatives").select("id, name, domain_id, outcome, description, status, target_date, start_date, key_results(id, name, baseline_value, current_value, target_value, unit)").eq("user_id", userId).order("sort_order"),
    admin.from("projects").select("id, name, domain_id, initiative_id, outcome, description, status, start_date, target_date, shipped_at").eq("user_id", userId).order("sort_order"),
    admin
      .from("calendar_accounts")
      .select("id, provider, email, sync_direction, calendars")
      .eq("user_id", userId),
  ]);

  const weekStart = planningWeekStart(today);
  const { data: sprint } = await admin
    .from("sprints")
    .select("id, goal, big_rocks")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  const weekRes = sprint
    ? await admin
        .from("tasks")
        .select(TASK_COLS)
        .eq("user_id", userId)
        .eq("sprint_id", sprint.id)
        .in("status", ["backlog", "planned"])
        .order("sort_order")
    : { data: [], error: null };

  if (inboxRes.error) throw new Error(inboxRes.error.message);
  if (weekRes.error) throw new Error(weekRes.error.message);
  if (todayRes.error) throw new Error(todayRes.error.message);
  if (scheduledRes.error) throw new Error(scheduledRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (labelsRes.error) throw new Error(labelsRes.error.message);
  if (settingsRes.error) throw new Error(settingsRes.error.message);
  if (domainsRes.error) throw new Error(domainsRes.error.message);
  if (initiativesRes.error) throw new Error(initiativesRes.error.message);
  if (projectsRes.error) throw new Error(projectsRes.error.message);
  if (accountsRes.error) throw new Error(accountsRes.error.message);

  // ── the week's slate — derived from the On Deck spans, exactly like the app ──
  // A "week priority" in Nuvo IS a project committed to the week; the sprint's
  // big_rocks jsonb only records the per-week verdict. So the slate has to be
  // derived here too, or the agent reads an empty rock list and tells the user
  // their week is unplanned while three projects sit on this week's column.
  type ProjRow = {
    id: string;
    name: string;
    outcome: string | null;
    status: string;
    domain_id: string | null;
    start_date: string | null;
    target_date: string | null;
    shipped_at: string | null;
  };
  const projectRows = (projectsRes.data ?? []) as ProjRow[];
  const nextWeekStart = new Date(new Date(weekStart + "T00:00:00Z").getTime() + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const slateRows = projectRows.filter((p) => isOnSlate(fromProjectRow(p), weekStart));
  const needsRows = projectRows.filter((p) => needsASprint(fromProjectRow(p)));
  const nextRows = projectRows.filter(
    (p) => isOpenProjectStatus(p.status) && spansWeek(fromProjectRow(p), nextWeekStart),
  );

  // the open work filed under the slate (and the candidates) — what "pull the
  // work for this week" actually pulls from
  const wantedProjectIds = [...new Set([...slateRows, ...needsRows].map((p) => p.id))];
  const projTasksRes = wantedProjectIds.length
    ? await admin
        .from("tasks")
        .select(`${TASK_COLS}, project_id`)
        .eq("user_id", userId)
        .in("project_id", wantedProjectIds)
        .in("status", ["backlog", "planned"])
        .order("sort_order")
    : { data: [], error: null };

  if (projTasksRes.error) throw new Error(projTasksRes.error.message);
  const tasksByProject = new Map<string, Record<string, unknown>[]>();
  for (const t of projTasksRes.data ?? []) {
    const pid = (t as Record<string, unknown>).project_id as string | null;
    if (!pid) continue;
    tasksByProject.set(pid, [...(tasksByProject.get(pid) ?? []), t as Record<string, unknown>]);
  }


  const hiddenCalendars = new Set<string>(
    (settingsRes.data?.hidden_calendar_ids as string[] | null) ?? [],
  );
  // Individually hidden events — keyed by the stable account_id:provider_event_id
  // (or account_id:series:recurring_event_id for a whole series).
  const hiddenEventKeys = new Set<string>(
    ((settingsRes.data?.hidden_events as { key: string }[] | null) ?? []).map((h) => h.key),
  );
  // deno-lint-ignore no-explicit-any
  const isEventHidden = (e: any): boolean => {
    if (hiddenEventKeys.has(`${e.account_id}:${e.provider_event_id}`)) return true;
    return e.recurring_event_id ? hiddenEventKeys.has(`${e.account_id}:series:${e.recurring_event_id}`) : false;
  };

  // Calendar name / provider lookup for events + the writable target list for
  // create/move tools ("put it on Apple Family").
  const accounts = (accountsRes.data ?? []) as RawCalendarAccount[];
  const calLookup = new Map<string, { name: string; provider: string }>();
  for (const a of accounts) {
    for (const c of a.calendars ?? []) {
      calLookup.set(`${a.id}:${c.id}`, { name: c.summary, provider: a.provider });
      // Also key by calendar_id alone — most events resolve that way in practice.
      if (!calLookup.has(c.id)) calLookup.set(c.id, { name: c.summary, provider: a.provider });
    }
  }
  // Only the calendars the user actually keeps on their board, with the default
  // marked. A hidden calendar is deliberately absent: the model can't offer what
  // it can't see, and naming one still works (see agent/calendars.ts).
  const writableCalendars = offerableCalendars(
    buildWritableCalendars(
      accounts,
      [...hiddenCalendars],
      (settingsRes.data?.default_calendar_account_id as string | null) ?? null,
    ),
  );

  const inbox = (inboxRes.data ?? []).map((t) => fmtTask(t, today, nowMs, tz));
  const todayTasks = (todayRes.data ?? [])
    .filter((t) => !t.start_time)
    .map((t) => fmtTask(t, today, nowMs, tz));
  const scheduled = (scheduledRes.data ?? []).map((t) => fmtTask(t, today, nowMs, tz));
  // Deduplicate events: same provider_event_id can appear from multiple synced
  // accounts (e.g. two Google accounts that can both see the same calendar).
  // Secondary dedup on title+start_at catches cross-account duplicates where
  // the provider assigns different IDs to the same logical event.
  const seenEventIds = new Set<string>();
  const seenEventSlots = new Set<string>();
  const events = (eventsRes.data ?? [])
    .filter((e) => !hiddenCalendars.has(e.calendar_id as string) && !isEventHidden(e))
    .filter((e) => {
      const pid = e.provider_event_id as string | null;
      if (pid) {
        if (seenEventIds.has(pid)) return false;
        seenEventIds.add(pid);
      }
      const slot = `${e.title}|${e.start_at}`;
      if (seenEventSlots.has(slot)) return false;
      seenEventSlots.add(slot);
      return true;
    })
    .map((e) => {
      const meta =
        calLookup.get(`${e.account_id}:${e.calendar_id}`) ?? calLookup.get(e.calendar_id as string);
      return fmtEvent(e, today, nowMs, tz, meta);
    });

  const todaySchedule = buildTodaySchedule(events, scheduled, today);
  const todayFreeSlots = computeFreeSlots(events, scheduled, today, nowMs, tz);

  const rocks = (sprint?.big_rocks ?? []) as { id: string; project_id?: string | null; done_at: string | null }[];
  const weekSlate: SlateProject[] = slateRows.map((p) => {
    const rock = rocks.find((r) => r.project_id === p.id) ?? null;
    const tasks = tasksByProject.get(p.id) ?? [];
    const shipped = isCompleteStatus(p.status);
    return {
      id: p.id,
      name: p.name,
      outcome: p.outcome,
      status: p.status,
      domainId: p.domain_id,
      startDate: p.start_date,
      targetDate: p.target_date,
      priorityId: rock?.id ?? null,
      // shipping the project inside the week is the loudest possible verdict
      landed: Boolean(rock?.done_at) || shipped,
      shipped,
      openTasks: tasks.slice(0, 12).map((t) => ({
        id: t.id as string,
        title: t.title as string,
        status: t.status as string,
        durationMinutes: (t.duration_minutes as number) ?? 30,
        rollCount: (t.roll_count as number) ?? 0,
        scheduled: Boolean(t.start_time),
      })),
      openTaskCount: tasks.length,
      scheduledTaskCount: tasks.filter((t) => Boolean(t.start_time)).length,
    };
  });

  return {
    today,
    nowISO: now.toISOString(),
    nowLabel,
    laUtcOffset,
    rangeStart: start,
    rangeEnd: end,
    settings: settingsRes.data
      ? {
          dayStartHour: settingsRes.data.day_start_hour,
          dayEndHour: settingsRes.data.day_end_hour,
        }
      : null,
    todaySchedule,
    todayFreeSlots,
    inbox,
    todayTasks,
    scheduled,
    weekStart,
    weekSlate,
    needsASprint: needsRows.slice(0, 15).map((p) => ({
      id: p.id,
      name: p.name,
      outcome: p.outcome,
      domainId: p.domain_id,
      openTaskCount: (tasksByProject.get(p.id) ?? []).length,
    })),
    nextWeekSlate: nextRows.map((p) => ({
      id: p.id,
      name: p.name,
      startDate: p.start_date,
      targetDate: p.target_date,
    })),
    sprintGoal: sprint?.goal ?? null,
    weekPriorities: (sprint?.big_rocks ?? []) as unknown[],
    weekPool: (weekRes.data ?? []).map((t) => fmtTask(t, today, nowMs, tz)),
    events,
    writableCalendars,
    labels: labelsRes.data ?? [],
    vertical: {
      domains: (domainsRes.data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        intention: d.intention,
        charter: d.charter || undefined,
        routingContext: d.context || undefined,
        icon: d.icon,
        color: d.color,
        weeklyTargetHours: d.weekly_target_hours,
      })),
      initiatives: (initiativesRes.data ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        domainId: i.domain_id,
        outcome: i.outcome,
        description: i.description,
        status: i.status,
        targetDate: i.target_date,
        startDate: i.start_date,
        keyResults: (i.key_results ?? []).map((k: Record<string, unknown>) => ({
          id: k.id,
          name: k.name,
          baseline: k.baseline_value,
          current: k.current_value,
          target: k.target_value,
          unit: k.unit,
        })),
      })),
      projects: (projectsRes.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        domainId: p.domain_id,
        initiativeId: p.initiative_id,
        outcome: p.outcome,
        description: p.description,
        status: p.status,
        startDate: p.start_date,
        targetDate: p.target_date,
      })),
    },
  };
}

export function contextToPrompt(ctx: AgentContext): string {
  return `Internal note for you only: "id" fields are for tool calls — never paste them in user-facing replies.

${JSON.stringify(ctx, null, 2)}`;
}
