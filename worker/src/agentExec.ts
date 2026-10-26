/**
 * Worker-side agent / MCP reads and writes. Every query is scoped by
 * `store.userId`. Calendar provider writes stay blocked.
 */
import type { AgentContext } from "../../supabase/functions/agent/contextShape.ts";
import {
  buildDaySchedule,
  buildSlotSummaries,
  computeOpenWindows,
  FALLBACK_TZ,
  fmtEvent,
  fmtTask,
  makeEventVisibility,
  todayIn,
} from "../../supabase/functions/_shared/dayShape.ts";
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

  const [domains, initiatives, projects, tasks, slots, labels, settingsRows, events] = await Promise.all([
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
    weekStart: today,
    weekSlate: [],
    needsASprint: [],
    nextWeekSlate: [],
    sprintGoal: null,
    unattachedPriorities: [],
    weekPool: [],
    events: visibleEvents,
    writableCalendars: [],
    labels: labels.map((l) => ({ id: String(l.id), name: String(l.name ?? "") })),
    vertical: { domains, initiatives, projects },
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
): Promise<string> {
  switch (name) {
    case "get_snapshot":
      return JSON.stringify(await buildSnapshot(store, asId(args.range_start) ?? undefined, asId(args.range_end) ?? undefined, resolveTz(args.timezone)));
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
      return createRow(store, "tasks", {
        title: args.title ?? args.text ?? "Untitled",
        notes: args.notes,
        status: args.status ?? "inbox",
        project_id: args.project_id,
        domain_id: args.domain_id,
        slot_id: args.slot_id,
        parent_task_id: args.parent_task_id ?? args.parent_id,
      });
    case "update_task":
      return patchRow(store, "tasks", args.id, {
        title: args.title,
        project_id: args.project_id,
        domain_id: args.domain_id,
        slot_id: args.slot_id,
        parent_task_id: args.parent_task_id,
      });
    case "complete_task":
      return setTaskStatus(store, args.id, "done");
    case "trash_task":
      return setTaskStatus(store, args.id, "trashed");
    case "move_to_inbox":
      return setTaskStatus(store, args.id, "inbox");
    case "restore_task":
      return setTaskStatus(store, args.id, "inbox");
    case "purge_task":
      return removeRow(store, "tasks", args.id);
    case "unschedule_task":
      return patchRow(store, "tasks", args.id, { project_id: undefined });
    case "plan_task":
    case "schedule_task":
    case "reschedule_task":
      return patchRow(store, "tasks", args.id, {
        title: typeof args.title === "string" ? args.title : undefined,
        project_id: args.project_id,
        domain_id: args.domain_id,
        slot_id: args.slot_id,
      });
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
