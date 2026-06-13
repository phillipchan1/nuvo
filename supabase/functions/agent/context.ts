import { admin, todayLA } from "../_shared/admin.ts";

const TASK_COLS =
  "id, title, status, do_date, start_time, duration_minutes, deadline, priority, notes, roll_count";

export interface AgentContext {
  today: string;
  /** Absolute current time, so the model can tell past from upcoming. */
  nowISO: string;
  /** Human current time in the user's zone, e.g. "Fri, 2:30 PM". */
  nowLabel: string;
  rangeStart: string;
  rangeEnd: string;
  settings: { dayStartHour: number; dayEndHour: number } | null;
  inbox: unknown[];
  todayTasks: unknown[];
  scheduled: unknown[];
  /** This week's sprint goal, if a sprint row exists. */
  sprintGoal: string | null;
  /** Tasks committed to this week's sprint and not yet done. */
  weekPool: unknown[];
  events: unknown[];
  labels: { id: string; name: string }[];
}

/** Monday of the planning week (LA calendar; Sundays plan the week ahead). */
function planningWeekStart(todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDay() === 0) dt.setUTCDate(dt.getUTCDate() + 1);
  const sinceMonday = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - sinceMonday);
  return dt.toISOString().slice(0, 10);
}

function fmtTask(t: Record<string, unknown>) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    doDate: t.do_date,
    startTime: t.start_time,
    durationMinutes: t.duration_minutes,
    deadline: t.deadline,
    priority: t.priority,
    notes: t.notes || undefined,
    rollCount: t.roll_count || 0,
  };
}

function fmtEvent(e: Record<string, unknown>, now: number) {
  const start = e.start_at ? new Date(e.start_at as string).getTime() : null;
  const end = e.end_at ? new Date(e.end_at as string).getTime() : null;
  return {
    id: e.id,
    title: e.title,
    startAt: e.start_at,
    endAt: e.end_at,
    allDay: e.all_day,
    location: e.location || undefined,
    // so the model never offers a meeting that already happened
    past: end != null ? end <= now : false,
    ongoing: start != null && end != null ? start <= now && now < end : false,
  };
}

export async function buildContext(
  userId: string,
  rangeStart?: string,
  rangeEnd?: string,
): Promise<AgentContext> {
  const today = todayLA();
  const now = new Date();
  const nowMs = now.getTime();
  const nowLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  const start = rangeStart ?? new Date(now.getTime() - 7 * 86400_000).toISOString();
  const end = rangeEnd ?? new Date(now.getTime() + 7 * 86400_000).toISOString();

  const [inboxRes, todayRes, scheduledRes, eventsRes, labelsRes, settingsRes] = await Promise.all([
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
      .select("id, title, start_at, end_at, all_day, location, calendar_id")
      .eq("user_id", userId)
      .lt("start_at", end)
      .gt("end_at", start),
    admin.from("labels").select("id, name").eq("user_id", userId).order("name"),
    admin
      .from("user_settings")
      .select("day_start_hour, day_end_hour, hidden_calendar_ids")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  // the week pool: tasks committed to this week's sprint, not done yet
  const weekStart = planningWeekStart(today);
  const { data: sprint } = await admin
    .from("sprints")
    .select("id, goal")
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

  const hiddenCalendars = new Set<string>(
    (settingsRes.data?.hidden_calendar_ids as string[] | null) ?? [],
  );

  const scheduledPast = (t: Record<string, unknown>): boolean => {
    if (!t.start_time) return false;
    const end = new Date(t.start_time as string).getTime() + ((t.duration_minutes as number) ?? 30) * 60_000;
    return end <= nowMs;
  };

  return {
    today,
    nowISO: now.toISOString(),
    nowLabel,
    rangeStart: start,
    rangeEnd: end,
    settings: settingsRes.data
      ? {
          dayStartHour: settingsRes.data.day_start_hour,
          dayEndHour: settingsRes.data.day_end_hour,
        }
      : null,
    inbox: (inboxRes.data ?? []).map(fmtTask),
    todayTasks: (todayRes.data ?? []).map(fmtTask),
    scheduled: (scheduledRes.data ?? []).map((t) => ({ ...fmtTask(t), past: scheduledPast(t) })),
    sprintGoal: sprint?.goal ?? null,
    weekPool: (weekRes.data ?? []).map(fmtTask),
    // only calendars the user hasn't toggled off in settings
    events: (eventsRes.data ?? [])
      .filter((e) => !hiddenCalendars.has(e.calendar_id as string))
      .map((e) => fmtEvent(e, nowMs)),
    labels: labelsRes.data ?? [],
  };
}

export function contextToPrompt(ctx: AgentContext): string {
  return JSON.stringify(ctx, null, 2);
}
