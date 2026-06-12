import { admin, todayLA } from "../_shared/admin.ts";

const TASK_COLS =
  "id, title, status, do_date, start_time, duration_minutes, deadline, priority, notes, roll_count";

export interface AgentContext {
  today: string;
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

function fmtEvent(e: Record<string, unknown>) {
  return {
    id: e.id,
    title: e.title,
    startAt: e.start_at,
    endAt: e.end_at,
    allDay: e.all_day,
    location: e.location || undefined,
  };
}

export async function buildContext(
  userId: string,
  rangeStart?: string,
  rangeEnd?: string,
): Promise<AgentContext> {
  const today = todayLA();
  const now = new Date();
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
      .select("id, title, start_at, end_at, all_day, location")
      .eq("user_id", userId)
      .lt("start_at", end)
      .gt("end_at", start),
    admin.from("labels").select("id, name").eq("user_id", userId).order("name"),
    admin
      .from("user_settings")
      .select("day_start_hour, day_end_hour")
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

  return {
    today,
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
    scheduled: (scheduledRes.data ?? []).map(fmtTask),
    sprintGoal: sprint?.goal ?? null,
    weekPool: (weekRes.data ?? []).map(fmtTask),
    events: (eventsRes.data ?? []).map(fmtEvent),
    labels: labelsRes.data ?? [],
  };
}

export function contextToPrompt(ctx: AgentContext): string {
  return JSON.stringify(ctx, null, 2);
}
