/**
 * Worker-side agent / MCP reads and writes. Every query is scoped by
 * `store.userId`. Calendar provider writes stay blocked.
 */
import type { AgentContext, SlateProject } from "../../supabase/functions/agent/contextShape.ts";
import { applyEffectiveStatus, projectTaskRollup } from "../../supabase/functions/agent/projectStatusCore.ts";
// The week's rules — the SAME kernel the app and the edge agent derive the week
// from. Never re-implement one here (tests/planning-kernel.test.ts).
import {
  carriedWeeks,
  fromProjectRow,
  isCompleteStatus,
  isOnSlate,
  isOpenProjectStatus,
  needsASprint,
  planningWeekStart,
  slateOrder,
  spansWeek,
} from "../../supabase/functions/_shared/planningRules.ts";
import {
  buildDaySchedule,
  buildSlotSummaries,
  computeOpenWindows,
  FALLBACK_TZ,
  fmtEvent,
  fmtTask,
  localDateISO,
  makeEventVisibility,
  startInstant,
  todayIn,
} from "../../supabase/functions/_shared/dayShape.ts";
import { completionStamp, FALLBACK_PLANNED_MINUTES } from "../../supabase/functions/_shared/completedWork.ts";
import {
  assertOwnedFks,
  contacts,
  deleteOwned,
  getOwned,
  insertOwned,
  listOwned,
  listTaskLabels,
  updateOwned,
  type PlannerTable,
  type Store,
} from "./store.ts";

const MISSING = JSON.stringify({ error: "not found" });
const FORBIDDEN_FK = JSON.stringify({ error: "not found" });
const CALENDAR_BLOCKED = JSON.stringify({
  error: "calendar provider writes stay on Supabase",
  stay_on_supabase: true,
});

export function resolveTz(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return FALLBACK_TZ;
  }
}

function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function missingSameAsRandom(_id: unknown): string {
  return MISSING;
}

export async function buildSnapshot(
  store: Store,
  rangeStart?: string,
  rangeEnd?: string,
  tz = FALLBACK_TZ,
): Promise<AgentContext> {
  const zone = resolveTz(tz);
  const today = todayIn(zone);
  const now = new Date();
  const nowMs = now.getTime();
  const start = rangeStart ?? new Date(nowMs - 7 * 86_400_000).toISOString();
  const end = rangeEnd ?? new Date(nowMs + 7 * 86_400_000).toISOString();

  const [domains, initiatives, projects, tasks, slots, labels, settingsRows, events, sprints] = await Promise.all([
    listOwned(store, "domains"),
    listOwned(store, "initiatives"),
    listOwned(store, "projects"),
    listOwned(store, "tasks"),
    listOwned(store, "slots"),
    listOwned(store, "labels"),
    listOwned(store, "user_settings"),
    store.sql`
      SELECT id, title, start_at, end_at, all_day, busy, location, calendar_id, account_id, provider_event_id, recurring_event_id
      FROM external_events
      WHERE user_id = ${store.userId}
        AND start_at < ${end}
        AND end_at > ${start}
    ` as Promise<Record<string, unknown>[]>,
    listOwned(store, "sprints"),
  ]);

  const settings = settingsRows[0] ?? null;
  const visibility = makeEventVisibility(settings);
  const visibleEvents = events
    .filter((e) => !visibility.hiddenCalendars.has(String(e.calendar_id ?? "")) && !visibility.isEventHidden(e))
    .map((e) => fmtEvent(e, today, nowMs, zone));
  const scheduled = tasks
    .filter((t) => t.start_time && (t.status === "planned" || t.status === "done"))
    .map((t) => fmtTask(t, today, nowMs, zone));
  const slotChildren = tasks
    .filter((t) => t.slot_id && t.status !== "trashed")
    .map((t) => ({
      id: String(t.id),
      title: String(t.title ?? ""),
      status: String(t.status ?? ""),
      slot_id: String(t.slot_id),
    }));
  const slotSummaries = buildSlotSummaries(slots, slotChildren, zone, nowMs);
  const todaySchedule = buildDaySchedule(visibleEvents, scheduled, slotSummaries, today);
  const todayOpenWindows = computeOpenWindows(visibleEvents, scheduled, slotSummaries, today, nowMs, zone);

  const week = weekRead(tasks, projects, sprints, today, nowMs, zone);

  const inbox = tasks.filter((t) => t.status === "inbox" && !t.trashed_at);
  const todayTasks = tasks.filter((t) => t.do_date === today && !t.start_time && t.status !== "trashed" && t.status !== "done");

  return {
    today,
    nowISO: now.toISOString(),
    nowLabel: new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(now),
    laUtcOffset:
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value?.replace("GMT", "") || "-07:00",
    rangeStart: start,
    rangeEnd: end,
    settings: settings
      ? {
          dayStartHour: Number(settings.day_start_hour ?? 6),
          dayEndHour: Number(settings.day_end_hour ?? 23),
        }
      : null,
    todaySchedule,
    todayOpenWindows,
    todaySlots: slotSummaries,
    inbox,
    todayTasks,
    recurringUpkeep: [],
    recurringSlots: [],
    scheduled,
    ...week,
    events: visibleEvents,
    writableCalendars: [],
    labels: labels.map((l) => ({ id: String(l.id), name: String(l.name ?? "") })),
    vertical: { domains, initiatives, projects },
  };
}

/** A timestamp column as an ISO string — the driver hands back a `Date`. */
function isoOrNull(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  return typeof v === "string" && v ? v : null;
}

/**
 * The week, as the chat must read it — the slate, the candidates, what is queued
 * behind it, the sprint's goal and pool. The same derivation the edge agent runs
 * (supabase/functions/agent/context.ts), over the rows this Worker already
 * loaded, through the same kernel: without it, production chat was told the
 * week started today and held nothing, and said the week was unplanned over a
 * full deck.
 */
export function weekRead(
  tasks: Record<string, unknown>[],
  projectRowsRaw: Record<string, unknown>[],
  sprints: Record<string, unknown>[],
  today: string,
  nowMs: number,
  zone: string,
): Pick<AgentContext, "weekStart" | "weekSlate" | "needsASprint" | "nextWeekSlate" | "sprintGoal" | "unattachedPriorities" | "weekPool"> {
  const weekStart = planningWeekStart(today);
  const sprint = sprints.find((s) => s.week_start === weekStart) ?? null;
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
  // the effective status — the tasks decide, as in the app and the edge agent
  const projectRows = applyEffectiveStatus(
    projectRowsRaw.map(
      (p): ProjRow => ({
        id: String(p.id),
        name: String(p.name ?? ""),
        outcome: (p.outcome as string | null) ?? null,
        status: String(p.status ?? ""),
        domain_id: (p.domain_id as string | null) ?? null,
        start_date: (p.start_date as string | null) ?? null,
        target_date: (p.target_date as string | null) ?? null,
        shipped_at: isoOrNull(p.shipped_at),
      }),
    ),
    projectTaskRollup(tasks),
  );
  const nextWeekStart = new Date(new Date(weekStart + "T00:00:00Z").getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  const slateRows = projectRows
    .filter((p) => isOnSlate(fromProjectRow(p), weekStart))
    .sort((a, b) => slateOrder(fromProjectRow(a), fromProjectRow(b), weekStart));
  const needsRows = projectRows.filter((p) => needsASprint(fromProjectRow(p)));
  const nextRows = projectRows.filter((p) => isOpenProjectStatus(p.status) && spansWeek(fromProjectRow(p), nextWeekStart));

  const bySort = (a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
  const openWork = tasks.filter((t) => t.status === "backlog" || t.status === "planned").sort(bySort);
  const tasksByProject = new Map<string, Record<string, unknown>[]>();
  for (const t of openWork) {
    const pid = (t.project_id as string | null) ?? null;
    if (!pid) continue;
    tasksByProject.set(pid, [...(tasksByProject.get(pid) ?? []), t]);
  }

  const rocks = ((sprint?.big_rocks ?? []) as {
    id: string;
    project_id?: string | null;
    done_at: string | null;
    title?: string | null;
    win?: string | null;
    roll_count?: number | null;
  }[]);
  const weekSlate: SlateProject[] = slateRows.map((p) => {
    const rock = rocks.find((r) => r.project_id === p.id) ?? null;
    const work = tasksByProject.get(p.id) ?? [];
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
      carriedWeeks: carriedWeeks(fromProjectRow(p), weekStart),
      verdict: rock
        ? { id: rock.id, title: rock.title ?? null, win: rock.win ?? null, doneAt: rock.done_at ?? null, rollCount: rock.roll_count ?? 0 }
        : null,
      landed: Boolean(rock?.done_at) || shipped,
      shipped,
      openTasks: work.slice(0, 12).map((t) => ({
        id: String(t.id),
        title: String(t.title ?? ""),
        status: String(t.status ?? ""),
        durationMinutes: (t.duration_minutes as number) ?? 30,
        rollCount: (t.roll_count as number) ?? 0,
        scheduled: Boolean(t.start_time),
      })),
      openTaskCount: work.length,
      scheduledTaskCount: work.filter((t) => Boolean(t.start_time)).length,
    };
  });

  return {
    weekStart,
    weekSlate,
    needsASprint: needsRows.slice(0, 15).map((p) => ({
      id: p.id,
      name: p.name,
      outcome: p.outcome,
      domainId: p.domain_id,
      openTaskCount: (tasksByProject.get(p.id) ?? []).length,
    })),
    nextWeekSlate: nextRows.map((p) => ({ id: p.id, name: p.name, startDate: p.start_date, targetDate: p.target_date })),
    sprintGoal: (sprint?.goal as string | null) ?? null,
    unattachedPriorities: rocks
      .filter((r) => !r.project_id)
      .map((r) => ({ id: r.id, title: r.title ?? null, win: r.win ?? null, doneAt: r.done_at ?? null })),
    weekPool: sprint
      ? openWork.filter((t) => t.sprint_id === sprint.id).map((t) => fmtTask(t, today, nowMs, zone))
      : [],
  };
}

async function loadOwned(store: Store, table: PlannerTable, id: unknown): Promise<Record<string, unknown> | null> {
  const value = asId(id);
  if (!value) return null;
  return getOwned(store, table, value);
}

export async function executeOwnedTool(
  store: Store,
  name: string,
  args: Record<string, unknown>,
  tz?: string,
): Promise<string> {
  // The caller's zone reads every local wall time a tool is handed. The tool
  // definitions promise America/Los_Angeles, which is FALLBACK_TZ.
  const zone = resolveTz(tz ?? args.timezone);
  switch (name) {
    case "get_snapshot":
      return JSON.stringify(await buildSnapshot(store, asId(args.range_start) ?? undefined, asId(args.range_end) ?? undefined, zone));
    case "list_vertical":
      return JSON.stringify({
        domains: await listOwned(store, "domains"),
        initiatives: await listOwned(store, "initiatives"),
        projects: await listOwned(store, "projects"),
        key_results: await listOwned(store, "key_results"),
      });
    case "list_tasks": {
      const rows = await listOwned(store, "tasks");
      const q = typeof args.query === "string" ? args.query.toLowerCase() : "";
      const filtered = q ? rows.filter((t) => String(t.title ?? "").toLowerCase().includes(q)) : rows;
      return JSON.stringify(filtered.filter((t) => t.status !== "trashed"));
    }
    case "list_completed": {
      const rows = await listOwned(store, "tasks");
      return JSON.stringify(rows.filter((t) => t.status === "done"));
    }
    case "list_trashed_tasks": {
      const rows = await listOwned(store, "tasks");
      return JSON.stringify(rows.filter((t) => t.status === "trashed"));
    }
    case "create_task":
      return createTask(store, args, zone);
    case "update_task":
      return updateTask(store, args);
    case "complete_task":
      return onTask(store, args, (task) => setTaskStatus(store, task.id, "done"));
    case "trash_task":
      return onTask(store, args, (task) => setTaskStatus(store, task.id, "trashed"));
    case "move_to_inbox":
      // "Clearing dates and times" — an inbox task with a start_time still
      // sat on the calendar under a status that said it hadn't been placed.
      return onTask(store, args, (task) =>
        writeTask(store, task.id, {
          status: "inbox",
          do_date: null,
          start_time: null,
          ...completionStamp("inbox", new Date().toISOString()),
        }),
      );
    case "restore_task":
      return setTaskStatus(store, args.id ?? args.task_id, "inbox");
    case "purge_task":
      return removeRow(store, "tasks", args.id ?? args.task_id);
    case "plan_task": {
      const doDate = isoDate(args.do_date);
      if (!doDate) return badArg("do_date must be YYYY-MM-DD");
      return onTask(store, args, (task) =>
        writeTask(store, task.id, {
          status: "planned",
          do_date: doDate,
          start_time: null,
          ...completionStamp("planned", new Date().toISOString()),
        }),
      );
    }
    case "schedule_task":
    case "reschedule_task": {
      const startTime = startInstant(args.start_time, zone);
      if (!startTime) return badArg("start_time must be local 'YYYY-MM-DDTHH:MM' (24h)");
      const duration = args.duration_minutes == null ? null : positiveMinutes(args.duration_minutes);
      if (duration === undefined) return badArg("duration_minutes must be a positive number");
      return onTask(store, args, (task) => {
        const patch: TaskPatch = { do_date: localDateISO(startTime, zone), start_time: startTime };
        if (name === "schedule_task" || task.status !== "done") {
          // A time block is planned work. Moving an inbox task to 3pm and
          // leaving it "inbox" put it on no calendar at all.
          patch.status = "planned";
          Object.assign(patch, completionStamp("planned", new Date().toISOString()));
        }
        if (duration != null) patch.duration_minutes = duration;
        else if (name === "schedule_task" || task.duration_minutes == null) patch.duration_minutes = FALLBACK_PLANNED_MINUTES;
        return writeTask(store, task.id, patch);
      });
    }
    case "unschedule_task":
      // Off the calendar, still planned for its day.
      return onTask(store, args, (task) => writeTask(store, task.id, { start_time: null }));
    case "create_domain":
      return createRow(store, "domains", { name: args.name ?? "Untitled", color: args.color });
    case "update_domain":
      return patchRow(store, "domains", args.id, { name: args.name });
    case "delete_domain":
      return removeRow(store, "domains", args.id);
    case "create_initiative":
      return createRow(store, "initiatives", { name: args.name ?? "Untitled", domain_id: args.domain_id });
    case "update_initiative":
      return patchRow(store, "initiatives", args.id, { name: args.name, domain_id: args.domain_id });
    case "delete_initiative":
      return removeRow(store, "initiatives", args.id);
    case "create_project":
      return createRow(store, "projects", {
        name: args.name ?? "Untitled",
        domain_id: args.domain_id,
        initiative_id: args.initiative_id,
      });
    case "update_project":
      return patchRow(store, "projects", args.id, {
        name: args.name,
        domain_id: args.domain_id,
        initiative_id: args.initiative_id,
      });
    case "delete_project":
      return removeRow(store, "projects", args.id);
    case "create_key_result":
      return createRow(store, "key_results", { name: args.name ?? "Untitled", initiative_id: args.initiative_id });
    case "update_key_result":
      return patchRow(store, "key_results", args.id ?? args.key_result_id, {
        name: args.name,
        initiative_id: args.initiative_id,
      });
    case "delete_key_result":
      return removeRow(store, "key_results", args.id ?? args.key_result_id);
    case "create_slot":
      return createRow(store, "slots", {
        title: args.title ?? "",
        do_date: args.do_date,
        start_time: args.start_time,
        duration_minutes: args.duration_minutes,
        project_id: args.project_id,
        domain_id: args.domain_id,
      });
    case "reschedule_slot":
    case "update_slot":
      return patchRow(store, "slots", args.id, {
        title: args.title,
        project_id: args.project_id,
        domain_id: args.domain_id,
      });
    case "delete_slot":
      return removeRow(store, "slots", args.id);
    case "add_to_slot":
      return patchRow(store, "tasks", args.task_id ?? args.id, { slot_id: args.slot_id });
    case "add_step":
      return createRow(store, "tasks", {
        title: args.title ?? "Untitled",
        parent_task_id: args.task_id ?? args.parent_task_id,
        status: "inbox",
      });
    case "list_steps": {
      const parent = await loadOwned(store, "tasks", args.task_id ?? args.id);
      if (!parent) return missingSameAsRandom(args.task_id ?? args.id);
      const rows = await listOwned(store, "tasks");
      return JSON.stringify(rows.filter((t) => t.parent_task_id === parent.id));
    }
    case "complete_step":
      return setTaskStatus(store, args.id ?? args.step_id, "done");
    case "remove_step":
      return removeRow(store, "tasks", args.id ?? args.step_id);
    case "set_reminder":
      return createRow(store, "reminders", {
        target_kind: args.target_kind ?? "task",
        target_id: args.target_id ?? args.task_id,
      });
    case "clear_reminder":
      return removeRow(store, "reminders", args.id);
    case "list_reminders":
      return JSON.stringify(await listOwned(store, "reminders"));
    case "find_contact": {
      const q = typeof args.query === "string" ? args.query : typeof args.search === "string" ? args.search : "";
      return JSON.stringify(await contacts(store, q));
    }
    case "bulk_update_tasks": {
      const ids = Array.isArray(args.ids) ? args.ids : [];
      const out = [];
      for (const id of ids) {
        out.push(JSON.parse(await patchRow(store, "tasks", id, { title: args.title, project_id: args.project_id })));
      }
      return JSON.stringify(out);
    }
    case "search_events":
    case "read_calendar_load": {
      const rows = await store.sql`
        SELECT id, title, start_at, end_at, calendar_id
        FROM external_events
        WHERE user_id = ${store.userId}
        ORDER BY start_at
        LIMIT 50
      `;
      return JSON.stringify(rows);
    }
    case "move_event":
    case "create_calendar_event":
    case "reschedule_event":
    case "cancel_event":
    case "decline_event":
    case "duplicate_event":
    case "rsvp_event":
    case "propose_invite":
      return CALENDAR_BLOCKED;
    case "create_recurring_task":
    case "update_recurring_task":
    case "end_recurring_task":
    case "create_recurring_slot":
    case "update_recurring_slot":
    case "end_recurring_slot":
    case "create_priority":
    case "update_priority":
    case "complete_priority":
    case "delete_priority":
    case "point_at":
      return JSON.stringify({ ok: true, skipped: name });
    default:
      return JSON.stringify({ error: `unknown tool: ${name}` });
  }
}

async function createRow(
  store: Store,
  table: PlannerTable,
  row: Record<string, unknown>,
): Promise<string> {
  if (!(await assertOwnedFks(store, table, row))) return FORBIDDEN_FK;
  const created = await insertOwned(store, table, row);
  if (!created) return FORBIDDEN_FK;
  return JSON.stringify(created);
}

async function patchRow(
  store: Store,
  table: PlannerTable,
  id: unknown,
  patch: Record<string, unknown>,
): Promise<string> {
  const owned = await loadOwned(store, table, id);
  if (!owned) return missingSameAsRandom(id);
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) body[k] = v;
  }
  if (!(await assertOwnedFks(store, table, body))) return FORBIDDEN_FK;
  const updated = await updateOwned(store, table, String(owned.id), body);
  if (!updated) return FORBIDDEN_FK;
  return JSON.stringify(updated);
}

async function removeRow(store: Store, table: PlannerTable, id: unknown): Promise<string> {
  const owned = await loadOwned(store, table, id);
  if (!owned) return missingSameAsRandom(id);
  const n = await deleteOwned(store, table, String(owned.id));
  return JSON.stringify({ deleted: n });
}

async function setTaskStatus(store: Store, id: unknown, status: string): Promise<string> {
  const owned = await loadOwned(store, "tasks", id);
  if (!owned) return missingSameAsRandom(id);
  const sql = store.sql;
  const completed = status === "done" ? new Date().toISOString() : null;
  const trashed = status === "trashed" ? new Date().toISOString() : null;
  const rows = await sql`
    UPDATE tasks
    SET status = ${status},
        completed_at = ${completed},
        trashed_at = ${trashed},
        updated_at = now()
    WHERE id = ${String(owned.id)}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return JSON.stringify(rows[0] ?? { error: "not found" });
}

export async function listOwnedTaskLabels(store: Store, taskId: string) {
  return listTaskLabels(store, taskId);
}

// ── Tasks: resolve the one a tool names, and write its whole row ────────────
// The tool definitions (supabase/functions/agent/toolDefs.ts) name a task by
// `task_id` or `task_title`. The port read `args.id`, so every MCP / Shortcuts
// call that followed the definition got "not found", and the writes it did
// make had no time columns — schedule_task could not put a task on a calendar.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_STATUSES = new Set(["inbox", "backlog", "planned", "done", "trashed"]);
const PRIORITIES = new Set(["none", "low", "medium", "high"]);
const ENERGIES = new Set(["deep", "shallow", "quick", "social"]);

type TaskRow = Record<string, unknown> & { id: string };

/** Columns a tool may write on a task. Each one present in the patch is set —
 *  `null` included — and each one absent is left as it stands. */
const TASK_COLUMNS = [
  "title",
  "notes",
  "status",
  "do_date",
  "start_time",
  "duration_minutes",
  "completed_at",
  "priority",
  "deadline",
  "energy",
  "project_id",
  "initiative_id",
  "domain_id",
  "slot_id",
  "parent_task_id",
] as const;
type TaskPatch = Partial<Record<(typeof TASK_COLUMNS)[number], unknown>>;

function badArg(message: string): string {
  return JSON.stringify({ error: message });
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null;
}

/** A positive whole number of minutes; undefined when the value isn't one. */
function positiveMinutes(value: unknown): number | undefined {
  const mins = Number(value);
  return Number.isFinite(mins) && mins > 0 ? Math.round(mins) : undefined;
}

/**
 * The live task a tool names: `task_id` (or the older `id`), else a title.
 * A title resolves to an exact (case-insensitive) match first, then to the one
 * task containing it; more than one is a question back, never a pick. Trashed
 * tasks are invisible here — restore/purge resolve the trash on purpose.
 */
async function resolveTask(
  store: Store,
  args: Record<string, unknown>,
): Promise<{ task: TaskRow } | { error: string }> {
  const id = asId(args.task_id) ?? asId(args.id);
  if (id) {
    const row = UUID_RE.test(id) ? await getOwned(store, "tasks", id) : null;
    if (!row || row.status === "trashed") return { error: MISSING };
    return { task: row as TaskRow };
  }
  const title = typeof args.task_title === "string" ? args.task_title.trim() : "";
  if (!title) return { error: badArg("Provide task_id or task_title") };
  const q = title.toLowerCase();
  const live = (await listOwned(store, "tasks")).filter((t) => t.status !== "trashed");
  const exact = live.filter((t) => String(t.title ?? "").trim().toLowerCase() === q);
  const matches = exact.length ? exact : live.filter((t) => String(t.title ?? "").toLowerCase().includes(q));
  if (matches.length === 1) return { task: matches[0] as TaskRow };
  if (!matches.length) return { error: badArg(`No task matching "${title}"`) };
  return {
    error: JSON.stringify({
      error: `Multiple tasks match "${title}". Use task_id.`,
      candidates: matches.slice(0, 5).map((t) => ({ id: t.id, title: t.title, status: t.status, do_date: t.do_date })),
    }),
  };
}

async function onTask(
  store: Store,
  args: Record<string, unknown>,
  act: (task: TaskRow) => Promise<string | Record<string, unknown> | null>,
): Promise<string> {
  const found = await resolveTask(store, args);
  if ("error" in found) return found.error;
  const out = await act(found.task);
  if (out == null) return MISSING;
  return typeof out === "string" ? out : JSON.stringify(out);
}

/** One UPDATE for any subset of TASK_COLUMNS. FKs must resolve to this owner. */
async function writeTask(store: Store, id: string, patch: TaskPatch): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "tasks", patch))) return null;
  const set = (k: (typeof TASK_COLUMNS)[number]) => (k in patch ? 1 : 0);
  const val = (k: (typeof TASK_COLUMNS)[number]) => (patch[k] === undefined ? null : patch[k]) as string | number | null;
  const rows = await store.sql`
    UPDATE tasks
    SET
      title = CASE WHEN ${set("title")} = 1 THEN ${val("title")} ELSE title END,
      notes = CASE WHEN ${set("notes")} = 1 THEN ${val("notes") ?? ""} ELSE notes END,
      status = CASE WHEN ${set("status")} = 1 THEN ${val("status")} ELSE status END,
      do_date = CASE WHEN ${set("do_date")} = 1 THEN ${val("do_date")}::date ELSE do_date END,
      start_time = CASE WHEN ${set("start_time")} = 1 THEN ${val("start_time")}::timestamptz ELSE start_time END,
      duration_minutes = CASE WHEN ${set("duration_minutes")} = 1 THEN ${val("duration_minutes")}::integer ELSE duration_minutes END,
      completed_at = CASE WHEN ${set("completed_at")} = 1 THEN ${val("completed_at")}::timestamptz ELSE completed_at END,
      priority = CASE WHEN ${set("priority")} = 1 THEN ${val("priority") ?? "none"} ELSE priority END,
      deadline = CASE WHEN ${set("deadline")} = 1 THEN ${val("deadline")}::date ELSE deadline END,
      energy = CASE WHEN ${set("energy")} = 1 THEN ${val("energy")} ELSE energy END,
      project_id = CASE WHEN ${set("project_id")} = 1 THEN ${val("project_id")}::uuid ELSE project_id END,
      initiative_id = CASE WHEN ${set("initiative_id")} = 1 THEN ${val("initiative_id")}::uuid ELSE initiative_id END,
      domain_id = CASE WHEN ${set("domain_id")} = 1 THEN ${val("domain_id")}::uuid ELSE domain_id END,
      slot_id = CASE WHEN ${set("slot_id")} = 1 THEN ${val("slot_id")}::uuid ELSE slot_id END,
      parent_task_id = CASE WHEN ${set("parent_task_id")} = 1 THEN ${val("parent_task_id")}::uuid ELSE parent_task_id END,
      updated_at = now()
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows[0] ?? null;
}

/** A project's chain, or null when it isn't this owner's (D-088: a parented
 *  task belongs to its parent's domain, so the chain is read, never trusted). */
async function projectChain(store: Store, projectId: string): Promise<{ initiative_id: unknown; domain_id: unknown } | null> {
  if (!UUID_RE.test(projectId)) return null;
  const proj = await getOwned(store, "projects", projectId);
  return proj ? { initiative_id: proj.initiative_id ?? null, domain_id: proj.domain_id ?? null } : null;
}

/** create_task, as toolDefs.ts describes it: a dated task is planned, a timed
 *  one is on the calendar at the caller's local time, a parented-but-undated one
 *  is backlog, the rest is inbox. (Free-text `capture` is kept as the title —
 *  the Worker has no capture parser yet.) */
async function createTask(store: Store, args: Record<string, unknown>, zone: string): Promise<string> {
  const title = String(args.title ?? args.capture ?? args.text ?? "").trim() || "Untitled";

  let startTime: string | null = null;
  if (args.start_time != null && args.start_time !== "") {
    startTime = startInstant(args.start_time, zone);
    if (!startTime) return badArg("start_time must be local 'YYYY-MM-DDTHH:MM' (24h)");
  }
  let doDate: string | null = null;
  if (args.do_date != null && args.do_date !== "") {
    doDate = isoDate(args.do_date);
    if (!doDate) return badArg("do_date must be YYYY-MM-DD");
  }
  // A time names its day; a do_date that disagrees with it loses to the time.
  if (startTime) doDate = localDateISO(startTime, zone);

  let duration: number | null = null;
  if (args.duration_minutes != null) {
    const mins = positiveMinutes(args.duration_minutes);
    if (mins === undefined) return badArg("duration_minutes must be a positive number");
    duration = mins;
  }
  if (startTime && duration == null) duration = FALLBACK_PLANNED_MINUTES;

  const projectId = asId(args.project_id);
  let initiativeId = asId(args.initiative_id);
  let domainId = asId(args.domain_id);
  if (projectId) {
    const chain = await projectChain(store, projectId);
    if (!chain) return FORBIDDEN_FK;
    initiativeId = asId(chain.initiative_id) ?? initiativeId;
    domainId = asId(chain.domain_id) ?? domainId;
  }
  if (initiativeId) {
    const init = UUID_RE.test(initiativeId) ? await getOwned(store, "initiatives", initiativeId) : null;
    if (!init) return FORBIDDEN_FK;
    domainId = domainId ?? asId(init.domain_id);
  }

  const parented = Boolean(projectId || initiativeId || domainId);
  const explicit = typeof args.status === "string" && TASK_STATUSES.has(args.status) ? args.status : null;
  const status = doDate ? "planned" : (explicit ?? (parented ? "backlog" : "inbox"));
  const priority = typeof args.priority === "string" && PRIORITIES.has(args.priority) ? args.priority : "none";

  const row: TaskPatch = {
    project_id: projectId,
    domain_id: domainId,
    slot_id: asId(args.slot_id),
    parent_task_id: asId(args.parent_task_id) ?? asId(args.parent_id),
  };
  for (const k of ["project_id", "domain_id", "slot_id", "parent_task_id"] as const) {
    const v = row[k];
    if (typeof v === "string" && !UUID_RE.test(v)) return FORBIDDEN_FK;
  }
  if (!(await assertOwnedFks(store, "tasks", row))) return FORBIDDEN_FK;

  const rows = await store.sql`
    INSERT INTO tasks (
      id, user_id, title, notes, status, do_date, start_time, duration_minutes, priority,
      project_id, initiative_id, domain_id, slot_id, parent_task_id
    )
    VALUES (
      ${crypto.randomUUID()}, ${store.userId}, ${title}, ${typeof args.notes === "string" ? args.notes : ""},
      ${status}, ${doDate}, ${startTime}, ${duration}, ${priority},
      ${projectId}, ${initiativeId}, ${domainId}, ${(row.slot_id as string | null) ?? null},
      ${(row.parent_task_id as string | null) ?? null}
    )
    RETURNING *
  `;
  return rows[0] ? JSON.stringify(rows[0]) : FORBIDDEN_FK;
}

/** update_task: the task's own attributes. Placement is plan/schedule_task. */
async function updateTask(store: Store, args: Record<string, unknown>): Promise<string> {
  const patch: TaskPatch = {};
  if (typeof args.title === "string" && args.title.trim()) patch.title = args.title.trim();
  if (typeof args.notes === "string") patch.notes = args.notes;
  if (args.priority !== undefined) {
    if (typeof args.priority !== "string" || !PRIORITIES.has(args.priority)) return badArg("priority must be none, low, medium or high");
    patch.priority = args.priority;
  }
  if (args.deadline !== undefined) {
    if (args.deadline === "" || args.deadline === null) patch.deadline = null;
    else {
      const d = isoDate(args.deadline);
      if (!d) return badArg("deadline must be YYYY-MM-DD, or empty to clear");
      patch.deadline = d;
    }
  }
  if (args.duration_minutes !== undefined) {
    const mins = positiveMinutes(args.duration_minutes);
    if (mins === undefined) return badArg("duration_minutes must be a positive number");
    patch.duration_minutes = mins;
  }
  if (args.energy !== undefined) {
    if (args.energy === "" || args.energy === null) patch.energy = null;
    else if (typeof args.energy === "string" && ENERGIES.has(args.energy)) patch.energy = args.energy;
    else return badArg("energy must be deep, shallow, quick or social");
  }
  // Filing carries the whole chain (D-088) — never a project with a stale domain.
  if (args.project_id !== undefined) {
    const pid = asId(args.project_id);
    if (pid) {
      const chain = await projectChain(store, pid);
      if (!chain) return FORBIDDEN_FK;
      patch.project_id = pid;
      patch.initiative_id = chain.initiative_id;
      patch.domain_id = chain.domain_id;
    } else {
      patch.project_id = null;
      patch.initiative_id = null;
    }
  } else if (args.domain_id !== undefined) {
    const did = asId(args.domain_id);
    if (did && !UUID_RE.test(did)) return FORBIDDEN_FK;
    patch.domain_id = did;
  }
  for (const k of ["slot_id", "parent_task_id"] as const) {
    if (args[k] === undefined) continue;
    const v = asId(args[k]);
    if (v && !UUID_RE.test(v)) return FORBIDDEN_FK;
    patch[k] = v;
  }
  if (!Object.keys(patch).length) return badArg("No fields to update");
  return onTask(store, args, (task) => writeTask(store, task.id, patch));
}
