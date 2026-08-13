import { admin } from "../_shared/admin.ts";
// The snapshot's shape + serializer live apart so the battery can build a
// fixture world and render it exactly the way this file renders a real one.
import type { AgentContext, OpenWindow, ScheduleItem, SlateProject, SlotSummary } from "./contextShape.ts";
export { contextToPrompt } from "./contextShape.ts";
export type { AgentContext, OpenWindow, ScheduleItem, SlateProject, SlotSummary } from "./contextShape.ts";
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
// What a day is — shared with the SPA and with any client that has to render a
// day without importing `src/`. Same rule as the planning kernel: import it,
// never re-implement it (tests/planning-kernel.test.ts fails if you do).
import {
  buildDaySchedule,
  buildSlotSummaries,
  computeOpenWindows,
  FALLBACK_TZ,
  fmtEvent,
  fmtTask,
  makeEventVisibility,
  todayIn,
  visibleEventRows,
} from "../_shared/dayShape.ts";

const TASK_COLS =
  "id, title, status, do_date, start_time, duration_minutes, deadline, priority, notes, roll_count";


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

  const [inboxRes, todayRes, scheduledRes, eventsRes, labelsRes, settingsRes, domainsRes, initiativesRes, projectsRes, accountsRes, slotsRes] = await Promise.all([
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
    // Slots in range, with what's inside them. A slot the agent can't see is
    // worse than one it can't create: it plans straight over held time.
    admin
      .from("slots")
      .select("id, title, do_date, start_time, duration_minutes, project_id, domain_id")
      .eq("user_id", userId)
      .gte("start_time", start)
      .lt("start_time", end)
      .order("start_time"),
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


  // What the user can actually see. Shared with every other day-reader so a
  // hidden calendar is hidden everywhere — "hidden is out of the ledger".
  const visibility = makeEventVisibility(settingsRes.data);
  const { hiddenCalendars } = visibility;

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
  // Hidden-filtered and de-duplicated by the shared rule (two synced accounts
  // can both see one calendar, and a provider can assign different ids to the
  // same logical event).
  const events = visibleEventRows(eventsRes.data ?? [], visibility).map((e) => {
    const meta =
      calLookup.get(`${e.account_id}:${e.calendar_id}`) ?? calLookup.get(e.calendar_id as string);
    return fmtEvent(e, today, nowMs, tz, meta);
  });

  // Slot children carry no time of their own — the slot is the block — so they
  // are read by slot_id, not by start_time.
  const slotRows = (slotsRes.data ?? []) as Record<string, unknown>[];
  const slotChildren = slotRows.length
    ? ((
        await admin
          .from("tasks")
          .select("id, title, status, slot_id")
          .eq("user_id", userId)
          .in("slot_id", slotRows.map((r) => r.id as string))
          .neq("status", "trashed")
          .order("sort_order")
      ).data ?? [])
    : [];
  const todaySlots: SlotSummary[] = buildSlotSummaries(slotRows, slotChildren, tz, nowMs);

  const todaySchedule = buildDaySchedule(events, scheduled, todaySlots, today);
  const todayOpenWindows = computeOpenWindows(events, scheduled, todaySlots, today, nowMs, tz);

  const rocks = (sprint?.big_rocks ?? []) as {
    id: string;
    project_id?: string | null;
    done_at: string | null;
    title?: string | null;
    win?: string | null;
    roll_count?: number | null;
  }[];
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
      // The verdict rides with its project — see contextShape.ts for why it is
      // no longer a top-level list.
      verdict: rock
        ? {
          id: rock.id,
          title: rock.title ?? null,
          win: rock.win ?? null,
          doneAt: rock.done_at ?? null,
          rollCount: rock.roll_count ?? 0,
        }
        : null,
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
    todayOpenWindows,
    todaySlots,
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
    // Only the project-less ones. Everything attached to a project is on that
    // project's slate entry, so there is exactly one place to read a priority.
    unattachedPriorities: rocks
      .filter((r) => !r.project_id)
      .map((r) => ({ id: r.id, title: r.title ?? null, win: r.win ?? null, doneAt: r.done_at ?? null })),
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
