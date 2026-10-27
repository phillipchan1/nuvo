/**
 * Owned planner reads/writes. Every tenant filter is the tagged
 * owner clause (user_id equals store.userId) or a JOIN/EXISTS through
 * a user-owned parent. `scripts/prove-isolation-mutation.mjs` deletes
 * each of those clauses.
 */
import type { Sql } from "./db.ts";
import { openAccountRefreshToken } from "./lib/accountTokens.ts";
import type { Env } from "./env.ts";

export const PLANNER_TABLES = [
  "tasks",
  "domains",
  "projects",
  "initiatives",
  "key_results",
  "slots",
  "labels",
  "recurrences",
  "record_comments",
  "week_reviews",
  "sprints",
  "reminders",
  "event_domain_routing",
  "user_settings",
] as const;

export type PlannerTable = (typeof PLANNER_TABLES)[number];

export function isPlannerTable(name: string): name is PlannerTable {
  return (PLANNER_TABLES as readonly string[]).includes(name);
}

export interface Store {
  sql: Sql;
  userId: string;
}

export function makeStore(sql: Sql, userId: string): Store {
  return { sql, userId };
}

const OWNED_FKS: Partial<Record<PlannerTable, { field: string; table: PlannerTable }[]>> = {
  projects: [
    { field: "domain_id", table: "domains" },
    { field: "initiative_id", table: "initiatives" },
  ],
  tasks: [
    { field: "project_id", table: "projects" },
    { field: "domain_id", table: "domains" },
    { field: "slot_id", table: "slots" },
    { field: "parent_task_id", table: "tasks" },
  ],
  initiatives: [{ field: "domain_id", table: "domains" }],
  key_results: [{ field: "initiative_id", table: "initiatives" }],
  slots: [
    { field: "project_id", table: "projects" },
    { field: "domain_id", table: "domains" },
  ],
  record_comments: [
    { field: "project_id", table: "projects" },
    { field: "initiative_id", table: "initiatives" },
  ],
  event_domain_routing: [{ field: "domain_id", table: "domains" }],
};

function reminderTargetTable(kind: unknown): PlannerTable | null {
  if (kind === "task") return "tasks";
  if (kind === "slot") return "slots";
  return null;
}

async function assertOwnedReminderTarget(
  store: Store,
  row: Record<string, unknown>,
): Promise<boolean> {
  const kind = typeof row.target_kind === "string" ? row.target_kind : undefined;
  if (kind === "event") {
    const value = row.target_id;
    return value == null || value === "";
  }
  if (!("target_id" in row)) return kind == null || kind === "task" || kind === "slot";
  const value = row.target_id;
  if (value == null || value === "") return true;
  if (typeof value !== "string") return false;
  const parent = reminderTargetTable(kind ?? "task");
  if (!parent) return false;
  return (await getOwned(store, parent, value)) != null;
}

function optId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optStr(value: unknown): string | null {
  if (value == null || value === "") return null;
  return typeof value === "string" ? value : String(value);
}

function optNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asJson(sql: Sql, value: unknown) {
  return sql.json(JSON.parse(JSON.stringify(value ?? {})) as Parameters<Sql["json"]>[0]);
}

const PATCH_LOCKED = new Set(["id", "user_id", "created_at", "field_ts"]);

type ColKind = "text" | "num" | "bool" | "json" | "uuid" | "int[]" | "date[]";
type Col = { name: string; kind: ColKind; cast?: "task_status" | "task_priority" };

const TASK_COLS: Col[] = [
  { name: "title", kind: "text" },
  { name: "notes", kind: "text" },
  { name: "status", kind: "text", cast: "task_status" },
  { name: "do_date", kind: "text" },
  { name: "start_time", kind: "text" },
  { name: "duration_minutes", kind: "num" },
  { name: "deadline", kind: "text" },
  { name: "priority", kind: "text", cast: "task_priority" },
  { name: "roll_count", kind: "num" },
  { name: "completed_at", kind: "text" },
  { name: "trashed_at", kind: "text" },
  { name: "project_id", kind: "uuid" },
  { name: "domain_id", kind: "uuid" },
  { name: "slot_id", kind: "uuid" },
  { name: "parent_task_id", kind: "uuid" },
  { name: "sort_order", kind: "num" },
  { name: "source", kind: "text" },
  { name: "external_id", kind: "text" },
  { name: "google_event_id", kind: "text" },
  { name: "connection_id", kind: "uuid" },
  { name: "energy", kind: "text" },
  { name: "sprint_id", kind: "uuid" },
  { name: "initiative_id", kind: "uuid" },
  { name: "assignee", kind: "text" },
  { name: "prework", kind: "text" },
  { name: "prework_at", kind: "text" },
  { name: "recurrence_id", kind: "uuid" },
  { name: "recurrence_date", kind: "text" },
  { name: "recurrence_overridden", kind: "bool" },
  { name: "big_rock_id", kind: "text" },
  { name: "suggestion", kind: "json" },
  { name: "suggested_at", kind: "text" },
  { name: "key_result_id", kind: "uuid" },
  { name: "field_ts", kind: "json" },
];

const DOMAIN_COLS: Col[] = [
  { name: "name", kind: "text" },
  { name: "color", kind: "text" },
  { name: "intention", kind: "text" },
  { name: "weekly_target_hours", kind: "num" },
  { name: "sort_order", kind: "num" },
  { name: "charter", kind: "text" },
  { name: "context", kind: "json" },
  { name: "icon", kind: "text" },
  { name: "context_at", kind: "text" },
  { name: "field_ts", kind: "json" },
];

const PROJECT_COLS: Col[] = [
  { name: "name", kind: "text" },
  { name: "domain_id", kind: "uuid" },
  { name: "initiative_id", kind: "uuid" },
  { name: "status", kind: "text" },
  { name: "outcome", kind: "text" },
  { name: "target_date", kind: "text" },
  { name: "sort_order", kind: "num" },
  { name: "description", kind: "text" },
  { name: "start_date", kind: "text" },
  { name: "progress", kind: "num" },
  { name: "tended_at", kind: "text" },
  { name: "verification", kind: "json" },
  { name: "verified_at", kind: "text" },
  { name: "key_result_id", kind: "uuid" },
  { name: "brief", kind: "json" },
  { name: "shipped_at", kind: "text" },
  { name: "field_ts", kind: "json" },
];

const INITIATIVE_COLS: Col[] = [
  { name: "name", kind: "text" },
  { name: "domain_id", kind: "uuid" },
  { name: "outcome", kind: "text" },
  { name: "target_date", kind: "text" },
  { name: "status", kind: "text" },
  { name: "sort_order", kind: "num" },
  { name: "description", kind: "text" },
  { name: "start_date", kind: "text" },
  { name: "momentum", kind: "text" },
  { name: "progress", kind: "num" },
  { name: "tended_at", kind: "text" },
  { name: "verification", kind: "json" },
  { name: "verified_at", kind: "text" },
  { name: "brief", kind: "json" },
  { name: "field_ts", kind: "json" },
];

const KEY_RESULT_COLS: Col[] = [
  { name: "name", kind: "text" },
  { name: "initiative_id", kind: "uuid" },
  { name: "baseline_value", kind: "num" },
  { name: "current_value", kind: "num" },
  { name: "target_value", kind: "num" },
  { name: "unit", kind: "text" },
  { name: "sort_order", kind: "num" },
  { name: "field_ts", kind: "json" },
];

const SLOT_COLS: Col[] = [
  { name: "title", kind: "text" },
  { name: "do_date", kind: "text" },
  { name: "start_time", kind: "text" },
  { name: "duration_minutes", kind: "num" },
  { name: "project_id", kind: "uuid" },
  { name: "domain_id", kind: "uuid" },
  { name: "color", kind: "text" },
  { name: "google_event_id", kind: "text" },
  { name: "recurrence_id", kind: "uuid" },
  { name: "recurrence_date", kind: "text" },
  { name: "recurrence_overridden", kind: "bool" },
  { name: "field_ts", kind: "json" },
];

const LABEL_COLS: Col[] = [
  { name: "name", kind: "text" },
  { name: "color", kind: "text" },
  { name: "field_ts", kind: "json" },
];

const RECURRENCE_COLS: Col[] = [
  { name: "kind", kind: "text" },
  { name: "rrule", kind: "text" },
  { name: "active", kind: "bool" },
  { name: "freq", kind: "text" },
  { name: "interval", kind: "num" },
  { name: "byweekday", kind: "int[]" },
  { name: "bymonthday", kind: "num" },
  { name: "anchor_date", kind: "text" },
  { name: "until_date", kind: "text" },
  { name: "max_count", kind: "num" },
  { name: "exdates", kind: "date[]" },
  { name: "title", kind: "text" },
  { name: "duration_minutes", kind: "num" },
  { name: "time_of_day_minutes", kind: "num" },
  { name: "project_id", kind: "uuid" },
  { name: "domain_id", kind: "uuid" },
  { name: "priority", kind: "text", cast: "task_priority" },
  { name: "color", kind: "text" },
  { name: "last_materialized", kind: "text" },
  { name: "bysetpos", kind: "num" },
  { name: "bymonth", kind: "num" },
  { name: "field_ts", kind: "json" },
];

const COMMENT_COLS: Col[] = [
  { name: "body", kind: "text" },
  { name: "project_id", kind: "uuid" },
  { name: "initiative_id", kind: "uuid" },
  { name: "author_kind", kind: "text" },
  { name: "field_ts", kind: "json" },
];

const WEEK_REVIEW_COLS: Col[] = [
  { name: "week_start", kind: "text" },
  { name: "report", kind: "json" },
  { name: "field_ts", kind: "json" },
];

const SPRINT_COLS: Col[] = [
  { name: "week_start", kind: "text" },
  { name: "goal", kind: "text" },
  { name: "big_rocks", kind: "json" },
  { name: "day_contexts", kind: "json" },
  { name: "field_ts", kind: "json" },
];

const REMINDER_COLS: Col[] = [
  { name: "target_kind", kind: "text" },
  { name: "target_id", kind: "uuid" },
  { name: "anchor", kind: "text" },
  { name: "event_key", kind: "text" },
  { name: "leads", kind: "int[]" },
  { name: "field_ts", kind: "json" },
];

const ROUTING_COLS: Col[] = [
  { name: "event_key", kind: "text" },
  { name: "domain_id", kind: "uuid" },
  { name: "confidence", kind: "num" },
  { name: "routed_at", kind: "text" },
  { name: "manual_domain_id", kind: "uuid" },
  { name: "field_ts", kind: "json" },
];

const SETTINGS_COLS: Col[] = [
  { name: "theme", kind: "text" },
  { name: "day_start_hour", kind: "num" },
  { name: "day_end_hour", kind: "num" },
  { name: "week_start", kind: "num" },
  { name: "hidden_calendar_ids", kind: "json" },
  { name: "last_rollover_date", kind: "text" },
  { name: "work_start_minutes", kind: "num" },
  { name: "work_end_minutes", kind: "num" },
  { name: "hidden_events", kind: "json" },
  { name: "time_zone", kind: "text" },
  { name: "reminder_prefs", kind: "json" },
  { name: "show_weather", kind: "bool" },
  { name: "auto_add_meet", kind: "text" },
  { name: "saved_views", kind: "json" },
  { name: "default_task_duration_minutes", kind: "num" },
  { name: "calendar_fit_hours", kind: "num" },
  { name: "calendar_domain_map", kind: "json" },
  { name: "default_calendar_account_id", kind: "uuid" },
  { name: "onboarding_completed_version", kind: "num" },
  { name: "default_calendar_id", kind: "text" },
  { name: "field_ts", kind: "json" },
];

export const WRITABLE_COLUMNS: Record<PlannerTable, Col[]> = {
  tasks: TASK_COLS,
  domains: DOMAIN_COLS,
  projects: PROJECT_COLS,
  initiatives: INITIATIVE_COLS,
  key_results: KEY_RESULT_COLS,
  slots: SLOT_COLS,
  labels: LABEL_COLS,
  recurrences: RECURRENCE_COLS,
  record_comments: COMMENT_COLS,
  week_reviews: WEEK_REVIEW_COLS,
  sprints: SPRINT_COLS,
  reminders: REMINDER_COLS,
  event_domain_routing: ROUTING_COLS,
  user_settings: SETTINGS_COLS,
};

const TOUCH_UPDATED_AT = new Set<PlannerTable>([
  "tasks",
  "slots",
  "initiatives",
  "user_settings",
  "key_results",
  "recurrences",
  "record_comments",
]);

function ident(sql: Sql, name: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`invalid identifier ${name}`);
  return sql.unsafe(name);
}

function coerceCol(col: Col, value: unknown): unknown {
  if (col.kind === "json") return value ?? {};
  if (col.kind === "uuid") return optId(value);
  if (col.kind === "num") return optNum(value);
  if (col.kind === "bool") {
    if (value == null || value === "") return null;
    return value === true || value === "true";
  }
  if (col.kind === "int[]") {
    if (!Array.isArray(value)) return [];
    return value.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  }
  if (col.kind === "date[]") {
    if (!Array.isArray(value)) return [];
    return value.map((n) => String(n));
  }
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

type Frag = ReturnType<Sql>;

function valueFrag(sql: Sql, col: Col, value: unknown): Frag {
  const v = col.kind === "json" ? asJson(sql, value) : coerceCol(col, value);
  if (col.cast) return sql`${v as never}::${ident(sql, col.cast)}`;
  return sql`${v as never}`;
}

function joinFrags(sql: Sql, parts: Frag[]): Frag {
  return parts.reduce((acc, part, i) => (i === 0 ? part : sql`${acc}, ${part}`));
}

async function insertPlannerRow(
  store: Store,
  table: PlannerTable,
  row: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const names: string[] = [];
  const frags: Frag[] = [];
  if (table !== "user_settings") {
    const id = typeof row.id === "string" ? row.id : crypto.randomUUID();
    names.push("id");
    frags.push(sql`${id}`);
  }
  names.push("user_id");
  frags.push(sql`${store.userId}`);
  for (const col of WRITABLE_COLUMNS[table]) {
    if (!(col.name in row)) continue;
    names.push(col.name);
    frags.push(valueFrag(sql, col, row[col.name]));
  }
  const nameList = names.join(", ");
  const rows = await sql`
    INSERT INTO ${ident(sql, table)} (${sql.unsafe(nameList)})
    VALUES (${joinFrags(sql, frags)})
    RETURNING *
  `;
  return rows[0] ?? null;
}

async function updatePlannerRow(
  store: Store,
  table: PlannerTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const sets: Frag[] = [];
  for (const col of WRITABLE_COLUMNS[table]) {
    if (!(col.name in patch)) continue;
    sets.push(sql`${ident(sql, col.name)} = ${valueFrag(sql, col, patch[col.name])}`);
  }
  if (TOUCH_UPDATED_AT.has(table)) sets.push(sql`updated_at = now()`);
  if (!sets.length) return table === "user_settings" ? getOwned(store, table, id) : null;
  if (table === "user_settings") {
    if (id !== store.userId) return null;
    const rows = await sql`
      UPDATE user_settings
      SET ${joinFrags(sql, sets)}
      WHERE user_id = ${store.userId}
      RETURNING *
    `;
    return rows.length ? rows[0] ?? null : null;
  }
  const rows = await sql`
    UPDATE ${ident(sql, table)}
    SET ${joinFrags(sql, sets)}
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

function fieldTsMillis(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof value === "number" ? value : Date.parse(String(value));
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function decideLww(
  stored: Record<string, unknown>,
  patch: Record<string, unknown>,
  incomingTs: Record<string, unknown> | undefined,
): { next: Record<string, unknown>; applied: string[]; rejected: string[]; nextTs: Record<string, string> } {
  const now = Date.now();
  const storedTs = fieldTsMillis(stored.field_ts);
  const mineTs = fieldTsMillis(incomingTs);
  const next: Record<string, unknown> = {};
  const applied: string[] = [];
  const rejected: string[] = [];
  const nextTs: Record<string, string> = {};
  for (const [key, value] of Object.entries(storedTs)) {
    nextTs[key] = new Date(value).toISOString();
  }
  for (const key of Object.keys(patch)) {
    if (PATCH_LOCKED.has(key)) {
      rejected.push(key);
      continue;
    }
    const mine = Math.min(mineTs[key] ?? now, now);
    const theirs = storedTs[key];
    if (theirs != null && mine <= theirs) {
      rejected.push(key);
      continue;
    }
    next[key] = patch[key];
    nextTs[key] = new Date(mine).toISOString();
    applied.push(key);
  }
  return { next, applied, rejected, nextTs };
}

/** Every FK on insert / update / upsert must resolve to a row this owner can read. */
export async function assertOwnedFks(
  store: Store,
  table: PlannerTable,
  row: Record<string, unknown>,
): Promise<boolean> {
  if (table === "reminders") return assertOwnedReminderTarget(store, row);
  for (const { field, table: parent } of OWNED_FKS[table] ?? []) {
    if (!(field in row)) continue;
    const value = row[field];
    if (value == null || value === "") continue;
    if (typeof value !== "string") return false;
    if (!(await getOwned(store, parent, value))) return false;
  }
  return true;
}

export async function listOwned(
  store: Store,
  table: PlannerTable,
): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  switch (table) {
    case "tasks":
      return sql`SELECT * FROM tasks WHERE user_id = ${store.userId}`;
    case "domains":
      return sql`SELECT * FROM domains WHERE user_id = ${store.userId}`;
    case "projects":
      return sql`SELECT * FROM projects WHERE user_id = ${store.userId}`;
    case "initiatives":
      return sql`SELECT * FROM initiatives WHERE user_id = ${store.userId}`;
    case "key_results":
      return sql`SELECT * FROM key_results WHERE user_id = ${store.userId}`;
    case "slots":
      return sql`SELECT * FROM slots WHERE user_id = ${store.userId}`;
    case "labels":
      return sql`SELECT * FROM labels WHERE user_id = ${store.userId}`;
    case "recurrences":
      return sql`SELECT * FROM recurrences WHERE user_id = ${store.userId}`;
    case "record_comments":
      return sql`SELECT * FROM record_comments WHERE user_id = ${store.userId}`;
    case "week_reviews":
      return sql`SELECT * FROM week_reviews WHERE user_id = ${store.userId}`;
    case "sprints":
      return sql`SELECT * FROM sprints WHERE user_id = ${store.userId}`;
    case "reminders":
      return sql`SELECT * FROM reminders WHERE user_id = ${store.userId}`;
    case "event_domain_routing":
      return sql`SELECT * FROM event_domain_routing WHERE user_id = ${store.userId}`;
    case "user_settings":
      return sql`SELECT * FROM user_settings WHERE user_id = ${store.userId}`;
  }
}

export async function listDayScheduledTasks(
  store: Store,
  startISO: string,
  endISO: string,
): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, title, status, do_date, start_time, duration_minutes, deadline, priority, notes, roll_count
    FROM tasks
    WHERE user_id = ${store.userId}
      AND start_time IS NOT NULL
      AND status IN ('planned', 'done')
      AND start_time >= ${startISO}
      AND start_time < ${endISO}
  `;
}

export async function listDaySlots(
  store: Store,
  startISO: string,
  endISO: string,
): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, title, do_date, start_time, duration_minutes, project_id, domain_id
    FROM slots
    WHERE user_id = ${store.userId}
      AND start_time >= ${startISO}
      AND start_time < ${endISO}
    ORDER BY start_time
  `;
}

export async function getOwned(
  store: Store,
  table: PlannerTable,
  id: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await (async () => {
    switch (table) {
      case "tasks":
        return sql`SELECT * FROM tasks WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "domains":
        return sql`SELECT * FROM domains WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "projects":
        return sql`SELECT * FROM projects WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "initiatives":
        return sql`SELECT * FROM initiatives WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "key_results":
        return sql`SELECT * FROM key_results WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "slots":
        return sql`SELECT * FROM slots WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "labels":
        return sql`SELECT * FROM labels WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "recurrences":
        return sql`SELECT * FROM recurrences WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "record_comments":
        return sql`SELECT * FROM record_comments WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "week_reviews":
        return sql`SELECT * FROM week_reviews WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "sprints":
        return sql`SELECT * FROM sprints WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "reminders":
        return sql`SELECT * FROM reminders WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "event_domain_routing":
        return sql`SELECT * FROM event_domain_routing WHERE id = ${id} AND user_id = ${store.userId} LIMIT 1`;
      case "user_settings":
        // PK is user_id. Path id must be this session's owner — a foreign
        // id used to return the caller's own row (and DELETE would wipe it).
        return sql`
          SELECT * FROM user_settings
          WHERE user_id = ${store.userId}
            AND user_id = ${id}
          LIMIT 1
        `;
    }
  })();
  return rows[0] ?? null;
}

export async function insertTask(
  store: Store,
  row: Record<string, unknown> & { title: string },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "tasks", row))) return null;
  return insertPlannerRow(store, "tasks", {
    ...row,
    title: row.title,
    notes: row.notes ?? "",
    status: row.status ?? "inbox",
    priority: row.priority ?? "none",
  });
}

export async function insertDomain(
  store: Store,
  row: Record<string, unknown> & { name: string },
): Promise<Record<string, unknown> | null> {
  return insertPlannerRow(store, "domains", {
    ...row,
    name: row.name,
    color: typeof row.color === "string" ? row.color : "#6B7280",
  });
}

export async function insertProject(
  store: Store,
  row: Record<string, unknown> & { name: string },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "projects", row))) return null;
  return insertPlannerRow(store, "projects", { ...row, name: row.name });
}

export async function insertInitiative(
  store: Store,
  row: Record<string, unknown> & { name: string },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "initiatives", row))) return null;
  return insertPlannerRow(store, "initiatives", { ...row, name: row.name });
}

export async function insertKeyResult(
  store: Store,
  row: Record<string, unknown> & { name: string; initiative_id: string },
): Promise<Record<string, unknown> | null> {
  if (!row.initiative_id) return null;
  if (!(await assertOwnedFks(store, "key_results", row))) return null;
  return insertPlannerRow(store, "key_results", { ...row, name: row.name, initiative_id: row.initiative_id });
}

export async function insertSlot(
  store: Store,
  row: Record<string, unknown> & {
    title: string;
    do_date: string;
    start_time: string;
    duration_minutes: number;
  },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "slots", row))) return null;
  return insertPlannerRow(store, "slots", row);
}

export async function insertRecordComment(
  store: Store,
  row: Record<string, unknown> & { body: string },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "record_comments", row))) return null;
  return insertPlannerRow(store, "record_comments", row);
}

export async function upsertEventDomainRouting(
  store: Store,
  row: Record<string, unknown> & { event_key: string },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "event_domain_routing", row))) return null;
  const existing = await listOwned(store, "event_domain_routing");
  const hit = existing.find((r) => r.event_key === row.event_key);
  if (hit && typeof hit.id === "string") {
    return updatePlannerRow(store, "event_domain_routing", hit.id, row);
  }
  return insertPlannerRow(store, "event_domain_routing", row);
}

export async function insertLabel(
  store: Store,
  row: Record<string, unknown> & { name: string },
): Promise<Record<string, unknown> | null> {
  try {
    return await insertPlannerRow(store, "labels", row);
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function insertRecurrence(
  store: Store,
  row: Record<string, unknown> & { kind: string; rrule: string },
): Promise<Record<string, unknown> | null> {
  return insertPlannerRow(store, "recurrences", row);
}

export async function insertWeekReview(
  store: Store,
  row: Record<string, unknown> & { week_start: string },
): Promise<Record<string, unknown> | null> {
  try {
    return await insertPlannerRow(store, "week_reviews", row);
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function insertSprint(
  store: Store,
  row: Record<string, unknown> & { week_start: string },
): Promise<Record<string, unknown> | null> {
  try {
    return await insertPlannerRow(store, "sprints", row);
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function insertReminder(
  store: Store,
  row: Record<string, unknown> & { target_kind: string },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "reminders", row))) return null;
  return insertPlannerRow(store, "reminders", row);
}

export async function insertOwned(
  store: Store,
  table: PlannerTable,
  row: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, table, row))) return null;
  if (table === "tasks") {
    return insertTask(store, { ...row, title: String(row.title ?? "Untitled") });
  }
  if (table === "domains") {
    return insertDomain(store, { ...row, name: String(row.name ?? "Untitled") });
  }
  if (table === "projects") {
    return insertProject(store, { ...row, name: String(row.name ?? "Untitled") });
  }
  if (table === "initiatives") {
    return insertInitiative(store, { ...row, name: String(row.name ?? "Untitled") });
  }
  if (table === "key_results") {
    const initiativeId = optId(row.initiative_id);
    if (!initiativeId) return null;
    return insertKeyResult(store, { ...row, name: String(row.name ?? "Untitled"), initiative_id: initiativeId });
  }
  if (table === "slots") {
    if (typeof row.do_date !== "string" || typeof row.start_time !== "string") return null;
    const duration = Number(row.duration_minutes);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return insertSlot(store, {
      ...row,
      title: String(row.title ?? ""),
      do_date: row.do_date,
      start_time: row.start_time,
      duration_minutes: duration,
    });
  }
  if (table === "record_comments") {
    return insertRecordComment(store, { ...row, body: String(row.body ?? "") });
  }
  if (table === "event_domain_routing") {
    if (typeof row.event_key !== "string" || !row.event_key) return null;
    return upsertEventDomainRouting(store, { ...row, event_key: row.event_key });
  }
  if (table === "user_settings") {
    return upsertSettings(store, row);
  }
  if (table === "labels") {
    return insertLabel(store, { ...row, name: String(row.name ?? "Untitled") });
  }
  if (table === "recurrences") {
    return insertRecurrence(store, {
      ...row,
      kind: typeof row.kind === "string" ? row.kind : "task",
      rrule: typeof row.rrule === "string" ? row.rrule : "",
    });
  }
  if (table === "week_reviews") {
    if (typeof row.week_start !== "string") return null;
    return insertWeekReview(store, { ...row, week_start: row.week_start });
  }
  if (table === "sprints") {
    if (typeof row.week_start !== "string") return null;
    return insertSprint(store, { ...row, week_start: row.week_start });
  }
  if (table === "reminders") {
    return insertReminder(store, {
      ...row,
      target_kind: typeof row.target_kind === "string" ? row.target_kind : "task",
    });
  }
  return null;
}

export async function upsertOwned(
  store: Store,
  table: PlannerTable,
  row: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, table, row))) return null;
  if (typeof row.id === "string") {
    const existing = await getOwned(store, table, row.id);
    if (existing) return updateOwned(store, table, row.id, row);
    // Id is not owned (missing or foreign). Inserting under that id would
    // 23505 on a live row and leak existence vs a random unused id.
    const { id: _ignored, ...rest } = row;
    return insertOwned(store, table, rest);
  }
  try {
    return await insertOwned(store, table, row);
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && String((err as { code?: unknown }).code) === "23505";
}

export async function upsertSettings(
  store: Store,
  row: Record<string, unknown> | string,
): Promise<Record<string, unknown> | null> {
  const patch = typeof row === "string" ? { theme: row } : row;
  const existing = await getOwned(store, "user_settings", store.userId);
  if (existing) return updatePlannerRow(store, "user_settings", store.userId, patch);
  return insertPlannerRow(store, "user_settings", { ...patch, theme: patch.theme ?? "system" });
}

export async function updateTask(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "tasks", patch))) return null;
  return updatePlannerRow(store, "tasks", id, patch);
}

export async function updateTaskTitle(
  store: Store,
  id: string,
  title: string,
): Promise<Record<string, unknown> | null> {
  return updateTask(store, id, { title });
}

export async function updateDomain(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  return updatePlannerRow(store, "domains", id, patch);
}

export async function updateDomainName(
  store: Store,
  id: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  return updateDomain(store, id, { name });
}

export async function updateProjectName(
  store: Store,
  id: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  return updateProject(store, id, { name });
}

export async function updateProject(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "projects", patch))) return null;
  return updatePlannerRow(store, "projects", id, patch);
}

export async function updateSettings(
  store: Store,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  return updatePlannerRow(store, "user_settings", store.userId, patch);
}

export async function updateSettingsTheme(
  store: Store,
  theme: string,
): Promise<Record<string, unknown> | null> {
  return updateSettings(store, { theme });
}

export async function updateOwned(
  store: Store,
  table: PlannerTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, table, patch))) return null;
  if (table === "user_settings" && id !== store.userId) return null;
  if (table === "reminders") {
    const next = { ...patch };
    if ("target_id" in next && !("target_kind" in next)) {
      const existing = await getOwned(store, "reminders", id);
      if (!existing) return null;
      next.target_kind = existing.target_kind;
    }
    if (!(await assertOwnedFks(store, "reminders", next))) return null;
    return updatePlannerRow(store, table, id, next);
  }
  return updatePlannerRow(store, table, id, patch);
}

export async function updateInitiative(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "initiatives", patch))) return null;
  return updatePlannerRow(store, "initiatives", id, patch);
}

export async function updateKeyResult(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "key_results", patch))) return null;
  return updatePlannerRow(store, "key_results", id, patch);
}

export async function updateSlot(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "slots", patch))) return null;
  return updatePlannerRow(store, "slots", id, patch);
}

export async function updateRecordComment(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "record_comments", patch))) return null;
  return updatePlannerRow(store, "record_comments", id, patch);
}

export async function updateReminder(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const next = { ...patch };
  if ("target_id" in next && !("target_kind" in next)) {
    const existing = await getOwned(store, "reminders", id);
    if (!existing) return null;
    next.target_kind = existing.target_kind;
  }
  if (!(await assertOwnedFks(store, "reminders", next))) return null;
  return updatePlannerRow(store, "reminders", id, next);
}

export async function updateLabelName(
  store: Store,
  id: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  return updatePlannerRow(store, "labels", id, { name });
}

export async function updateRecurrenceRule(
  store: Store,
  id: string,
  rrule: string,
): Promise<Record<string, unknown> | null> {
  return updatePlannerRow(store, "recurrences", id, { rrule });
}

export async function updateWeekReviewReport(
  store: Store,
  id: string,
  report: unknown,
): Promise<Record<string, unknown> | null> {
  return updatePlannerRow(store, "week_reviews", id, { report });
}

export async function updateSprintWeek(
  store: Store,
  id: string,
  weekStart: string,
): Promise<Record<string, unknown> | null> {
  return updatePlannerRow(store, "sprints", id, { week_start: weekStart });
}

export async function updateTaskFks(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  return updateTask(store, id, patch);
}

export async function deleteOwned(
  store: Store,
  table: PlannerTable,
  id: string,
): Promise<number> {
  const sql = store.sql;
  const rows = await (async () => {
    switch (table) {
      case "tasks":
        return sql`DELETE FROM tasks WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "domains":
        return sql`DELETE FROM domains WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "projects":
        return sql`DELETE FROM projects WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "initiatives":
        return sql`DELETE FROM initiatives WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "key_results":
        return sql`DELETE FROM key_results WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "slots":
        return sql`DELETE FROM slots WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "labels":
        return sql`DELETE FROM labels WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "recurrences":
        return sql`DELETE FROM recurrences WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "record_comments":
        return sql`DELETE FROM record_comments WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "week_reviews":
        return sql`DELETE FROM week_reviews WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "sprints":
        return sql`DELETE FROM sprints WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "reminders":
        return sql`DELETE FROM reminders WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "event_domain_routing":
        return sql`DELETE FROM event_domain_routing WHERE id = ${id} AND user_id = ${store.userId} RETURNING id`;
      case "user_settings":
        return sql`
          DELETE FROM user_settings
          WHERE user_id = ${store.userId}
            AND user_id = ${id}
          RETURNING user_id AS id
        `;
    }
  })();
  return rows.length;
}

export async function listTaskLabels(
  store: Store,
  taskId: string,
): Promise<{ task_id: string; label_id: string }[]> {
  const sql = store.sql;
  return sql`
    SELECT tl.task_id, tl.label_id
    FROM task_labels tl
    JOIN tasks t ON t.id = tl.task_id
    WHERE tl.task_id = ${taskId}
      AND t.user_id = ${store.userId}
  `;
}

export async function insertTaskLabel(
  store: Store,
  taskId: string,
  labelId: string,
): Promise<boolean> {
  const sql = store.sql;
  const owned = await sql`
    SELECT t.id
    FROM tasks t
    WHERE t.id = ${taskId}
      AND t.user_id = ${store.userId}
    LIMIT 1
  `;
  if (!owned[0]) return false;
  const label = await sql`
    SELECT id FROM labels
    WHERE id = ${labelId}
      AND user_id = ${store.userId}
    LIMIT 1
  `;
  if (!label[0]) return false;
  await sql`
    INSERT INTO task_labels (task_id, label_id)
    VALUES (${taskId}, ${labelId})
    ON CONFLICT DO NOTHING
  `;
  return true;
}

export async function deleteTaskLabel(
  store: Store,
  taskId: string,
  labelId: string,
): Promise<number> {
  const sql = store.sql;
  const rows = await sql`
    DELETE FROM task_labels tl
    USING tasks t
    WHERE tl.task_id = ${taskId}
      AND tl.label_id = ${labelId}
      AND t.id = tl.task_id
      AND t.user_id = ${store.userId}
    RETURNING tl.task_id
  `;
  return rows.length;
}

export async function applyPatch(
  store: Store,
  table: string,
  match: Record<string, unknown>,
  patch: Record<string, unknown>,
  incomingTs?: Record<string, unknown>,
): Promise<{ applied: string[]; rejected: string[]; matched: number }> {
  if (!isPlannerTable(table)) {
    throw new Error(`apply_patch: ${table} is not a syncable table`);
  }
  if (!patch || Object.keys(patch).length === 0) {
    return { applied: [], rejected: [], matched: 0 };
  }
  const matchId = typeof match.id === "string"
    ? match.id
    : typeof match.user_id === "string"
      ? match.user_id
      : "";
  const owned = table === "user_settings"
    ? await getOwned(store, table, matchId || store.userId)
    : await getOwned(store, table, matchId);
  if (!owned) return { applied: [], rejected: [], matched: 0 };

  const { next, applied, rejected, nextTs } = decideLww(owned, patch, incomingTs);
  if (!applied.length) return { applied, rejected, matched: 1 };

  const row = await updateOwned(store, table, table === "user_settings" ? store.userId : matchId, {
    ...next,
    field_ts: nextTs,
  });
  return { applied, rejected, matched: row ? 1 : 0 };
}

export async function rotateInboundToken(store: Store): Promise<string | null> {
  const sql = store.sql;
  const token = crypto.randomUUID().replace(/-/g, "");
  const rows = await sql`
    UPDATE user_settings
    SET inbound_token = ${token}, updated_at = now()
    WHERE user_id = ${store.userId}
    RETURNING inbound_token
  `;
  return (rows[0] as { inbound_token?: string } | undefined)?.inbound_token ?? null;
}

export async function claimReminder(
  store: Store,
  reminderKey: string,
  fireAt: string,
): Promise<boolean> {
  const sql = store.sql;
  const owned = await sql`
    SELECT id FROM reminders
    WHERE id = ${reminderKey}
      AND user_id = ${store.userId}
    LIMIT 1
  `;
  if (!owned[0]) return false;
  await sql`
    INSERT INTO reminder_deliveries (user_id, reminder_key, fire_at)
    VALUES (${store.userId}, ${reminderKey}, ${fireAt})
    ON CONFLICT DO NOTHING
  `;
  return true;
}

export async function contacts(
  store: Store,
  search: string,
): Promise<{ email: string; name: string | null }[]> {
  const sql = store.sql;
  const q = `%${search.trim().toLowerCase()}%`;
  return sql`
    SELECT email, name
    FROM contacts_directory
    WHERE user_id = ${store.userId}
      AND (lower(email) LIKE ${q} OR lower(coalesce(name, '')) LIKE ${q})
    ORDER BY name NULLS LAST
    LIMIT 20
  `;
}

export type BootstrapIdentity = {
  /** Only a verified Better Auth email may adopt an existing `users` row. */
  emailVerified?: boolean;
};

/**
 * Link the Better Auth session to a planner `users` row.
 *
 * Lookup order: `users.auth_id` (the BA user id) → legacy `users.id` →
 * verified email. Unverified sessions never adopt another row (that is
 * the email+password takeover). Persist `auth_id` so a later email
 * change finds the same row instead of inserting an empty one.
 */
export async function bootstrapUser(
  store: Store,
  email: string | null,
  identity: BootstrapIdentity = {},
): Promise<Store> {
  const sql = store.sql;
  const authId = store.userId;
  const normalized = email?.trim().toLowerCase() || null;
  const verified = identity.emailVerified === true;

  const byAuth = (await sql`
    SELECT id, email FROM users WHERE auth_id = ${authId} LIMIT 1
  `) as { id: string; email: string | null }[];
  if (byAuth[0]) {
    return finishLinked(store, byAuth[0], authId, normalized);
  }

  const byId = (await sql`
    SELECT id, email FROM users WHERE id = ${authId} LIMIT 1
  `) as { id: string; email: string | null }[];
  if (byId[0]) {
    return finishLinked(store, byId[0], authId, normalized);
  }

  if (verified && normalized) {
    const byEmail = (await sql`
      SELECT id, auth_id FROM users WHERE lower(email) = ${normalized} LIMIT 1
    `) as { id: string; auth_id: string | null }[];
    const existing = byEmail[0];
    if (existing && (existing.auth_id == null || existing.auth_id === authId)) {
      await sql`
        UPDATE users
        SET auth_id = ${authId}
        WHERE id = ${existing.id}
          AND (auth_id IS NULL OR auth_id = ${authId})
      `;
      const adopted = makeStore(sql, existing.id);
      await ensureSettingsAndDomains(adopted);
      return adopted;
    }
  }

  const insertEmail = await emailForInsert(sql, normalized);

  try {
    await sql`
      INSERT INTO users (id, email, auth_id)
      VALUES (${authId}, ${insertEmail}, ${authId})
    `;
  } catch {
    const recovered = await recoverInsert(sql, authId, normalized, verified);
    if (recovered) return recovered;
    try {
      await sql`
        INSERT INTO users (id, email, auth_id)
        VALUES (${authId}, NULL, ${authId})
      `;
    } catch {
      const last = await recoverInsert(sql, authId, normalized, verified);
      if (last) return last;
      throw new Error("users insert failed");
    }
  }

  await ensureSettingsAndDomains(store);
  return store;
}

async function recoverInsert(
  sql: Sql,
  authId: string,
  normalized: string | null,
  verified: boolean,
): Promise<Store | null> {
  const racedAuth = (await sql`
    SELECT id FROM users WHERE auth_id = ${authId} LIMIT 1
  `) as { id: string }[];
  if (racedAuth[0]) {
    const adopted = makeStore(sql, racedAuth[0].id);
    await ensureSettingsAndDomains(adopted);
    return adopted;
  }
  if (verified && normalized) {
    const racedEmail = (await sql`
      SELECT id, auth_id FROM users WHERE lower(email) = ${normalized} LIMIT 1
    `) as { id: string; auth_id: string | null }[];
    const raced = racedEmail[0];
    if (raced && (raced.auth_id == null || raced.auth_id === authId)) {
      await sql`
        UPDATE users
        SET auth_id = ${authId}
        WHERE id = ${raced.id}
          AND (auth_id IS NULL OR auth_id = ${authId})
      `;
      const adopted = makeStore(sql, raced.id);
      await ensureSettingsAndDomains(adopted);
      return adopted;
    }
  }
  return null;
}

async function emailForInsert(sql: Sql, normalized: string | null): Promise<string | null> {
  if (!normalized) return null;
  const taken = (await sql`
    SELECT id FROM users WHERE lower(email) = ${normalized} LIMIT 1
  `) as { id: string }[];
  return taken[0] ? null : normalized;
}

async function finishLinked(
  store: Store,
  row: { id: string; email: string | null },
  authId: string,
  normalized: string | null,
): Promise<Store> {
  const sql = store.sql;
  const linked = row.id === store.userId ? store : makeStore(sql, row.id);
  await sql`
    UPDATE users
    SET auth_id = ${authId}
    WHERE id = ${row.id}
      AND auth_id IS NULL
  `;
  if (normalized && (row.email ?? "").toLowerCase() !== normalized) {
    const taken = (await sql`
      SELECT id FROM users
      WHERE lower(email) = ${normalized} AND id <> ${row.id}
      LIMIT 1
    `) as { id: string }[];
    if (!taken[0]) {
      await sql`UPDATE users SET email = ${normalized} WHERE id = ${row.id}`;
    }
  }
  await ensureSettingsAndDomains(linked);
  return linked;
}

// Blocked-route tables. Not on generic /api/data (token columns). Owner
// filters stay in this file so isolation-mutation can delete them.

export async function listOwnedCalendarAccounts(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, user_id, provider, email, sync_direction, calendars,
           webhook_expires_at, mirror_calendar_id, needs_reconnect,
           next_sync_at, sync_failures, created_at, updated_at
    FROM calendar_accounts
    WHERE user_id = ${store.userId}
  `;
}

export async function getOwnedCalendarAccount(
  store: Store,
  id: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    SELECT * FROM calendar_accounts
    WHERE id = ${id} AND user_id = ${store.userId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function insertCalendarAccount(
  store: Store,
  row: { id?: string; provider: string; email: string; sync_direction?: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO calendar_accounts (id, user_id, provider, email, sync_direction)
    VALUES (${id}, ${store.userId}, ${row.provider}, ${row.email}, ${row.sync_direction ?? "read_only"})
    RETURNING id, user_id, provider, email, sync_direction
  `;
  return rows[0] ?? null;
}

export async function deleteOwnedCalendarAccount(store: Store, id: string): Promise<number> {
  const sql = store.sql;
  const rows = await sql`
    DELETE FROM calendar_accounts
    WHERE id = ${id} AND user_id = ${store.userId}
    RETURNING id
  `;
  return rows.length;
}

export async function listOwnedExternalEvents(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, user_id, account_id, provider_event_id, calendar_id, title,
           start_at, end_at, all_day, location, busy, self_rsvp, recurring_event_id, raw
    FROM external_events
    WHERE user_id = ${store.userId}
  `;
}

export async function getOwnedExternalEvent(
  store: Store,
  id: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    SELECT id, user_id, account_id, provider_event_id, calendar_id, title,
           start_at, end_at, all_day, location, busy, self_rsvp, recurring_event_id, raw
    FROM external_events
    WHERE id = ${id} AND user_id = ${store.userId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function insertExternalEvent(
  store: Store,
  row: {
    id?: string;
    account_id: string;
    title: string;
    start_at: string;
    end_at: string;
    calendar_id?: string;
    provider_event_id?: string;
  },
): Promise<Record<string, unknown> | null> {
  if (!(await getOwnedCalendarAccount(store, row.account_id))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO external_events (
      id, user_id, account_id, title, start_at, end_at, calendar_id, provider_event_id
    ) VALUES (
      ${id}, ${store.userId}, ${row.account_id}, ${row.title},
      ${row.start_at}, ${row.end_at}, ${row.calendar_id ?? "primary"},
      ${row.provider_event_id ?? id}
    )
    RETURNING id, user_id, account_id, title
  `;
  return rows[0] ?? null;
}

export async function listOwnedPushSubscriptions(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, user_id, endpoint, label, time_zone, failure_count
    FROM push_subscriptions
    WHERE user_id = ${store.userId}
  `;
}

export type PushSubscriptionWrite = {
  id?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string | null;
  time_zone?: string | null;
  last_seen_at?: string | null;
  failure_count?: number;
  created_at?: string | null;
  updated_at?: string | null;
};

/** Full-row upsert. ON CONFLICT (id) never takes another user's row. */
export async function insertPushSubscription(
  store: Store,
  row: PushSubscriptionWrite,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const rows = await sql`
    INSERT INTO push_subscriptions (
      id, user_id, created_at, updated_at, endpoint, p256dh, auth,
      label, time_zone, last_seen_at, failure_count
    ) VALUES (
      ${id}, ${store.userId}, ${row.created_at ?? now}, ${row.updated_at ?? now},
      ${row.endpoint}, ${row.p256dh}, ${row.auth}, ${row.label ?? null},
      ${row.time_zone ?? null}, ${row.last_seen_at ?? null}, ${row.failure_count ?? 0}
    )
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at,
      endpoint = EXCLUDED.endpoint,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      label = EXCLUDED.label,
      time_zone = EXCLUDED.time_zone,
      last_seen_at = EXCLUDED.last_seen_at,
      failure_count = EXCLUDED.failure_count
    WHERE push_subscriptions.user_id = ${store.userId}
    RETURNING id, user_id, endpoint
  `;
  return rows[0] ?? null;
}

/**
 * Same order as cutover: delete rows missing from the incoming set, then
 * full-row upsert. Scoped to the session user — never another tenant.
 */
export async function resyncOwnedPushSubscriptions(
  store: Store,
  rows: PushSubscriptionWrite[],
): Promise<{ deleted: number; upserted: number }> {
  const sql = store.sql;
  const keep = rows.map((row) => row.id).filter((id): id is string => Boolean(id));
  const gone = keep.length
    ? await sql`
        DELETE FROM push_subscriptions
        WHERE user_id = ${store.userId}
          AND NOT (id = ANY(${keep}))
        RETURNING id
      `
    : await sql`
        DELETE FROM push_subscriptions
        WHERE user_id = ${store.userId}
        RETURNING id
      `;
  let upserted = 0;
  for (const row of rows) {
    if (await insertPushSubscription(store, row)) upserted += 1;
  }
  return { deleted: gone.length, upserted };
}

export async function updateOwnedExternalEvent(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const current = await getOwnedExternalEvent(store, id);
  const sql = store.sql;
  const startAt = typeof patch.start_at === "string" ? patch.start_at : (current?.start_at as string | undefined) ?? null;
  const endAt = typeof patch.end_at === "string" ? patch.end_at : (current?.end_at as string | undefined) ?? null;
  const title = typeof patch.title === "string" ? patch.title : (current?.title as string | null | undefined) ?? null;
  const allDay = typeof patch.all_day === "boolean" ? patch.all_day : (current?.all_day as boolean | null | undefined) ?? null;
  const location = typeof patch.location === "string" || patch.location === null
    ? patch.location
    : (current?.location as string | null | undefined) ?? null;
  const busy = typeof patch.busy === "boolean" ? patch.busy : (current?.busy as boolean | null | undefined) ?? null;
  const rows = await sql`
    UPDATE external_events
    SET start_at = ${startAt}, end_at = ${endAt}, title = ${title},
        all_day = ${allDay}, location = ${location}, busy = ${busy}
    WHERE id = ${id} AND user_id = ${store.userId}
    RETURNING id, user_id, account_id, start_at, end_at, title, all_day, location, busy
  `;
  return rows[0] ?? null;
}

export async function listOwnedActivitySources(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, user_id, kind, login, avatar_url, repos, needs_reconnect, last_synced_at
    FROM activity_sources
    WHERE user_id = ${store.userId}
  `;
}

export async function getOwnedActivitySource(
  store: Store,
  id: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    SELECT id, user_id, kind, login
    FROM activity_sources
    WHERE id = ${id} AND user_id = ${store.userId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function insertActivitySource(
  store: Store,
  row: { id?: string; kind?: string; login?: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO activity_sources (id, user_id, kind, login)
    VALUES (${id}, ${store.userId}, ${row.kind ?? "github"}, ${row.login ?? null})
    RETURNING id, user_id, kind, login
  `;
  return rows[0] ?? null;
}

export async function listOwnedActivityBindings(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, user_id, source_id, project_id, selector
    FROM activity_bindings
    WHERE user_id = ${store.userId}
  `;
}

export async function insertActivityBinding(
  store: Store,
  row: { id?: string; source_id: string; project_id: string; selector: string },
): Promise<Record<string, unknown> | null> {
  if (!(await getOwnedActivitySource(store, row.source_id))) return null;
  if (!(await getOwned(store, "projects", row.project_id))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO activity_bindings (id, user_id, source_id, project_id, selector)
    VALUES (${id}, ${store.userId}, ${row.source_id}, ${row.project_id}, ${row.selector})
    RETURNING id, user_id, source_id, project_id
  `;
  return rows[0] ?? null;
}

export async function listOwnedActivityUnits(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, user_id, source_id, kind, external_id, title, url, selector, project_id, occurred_at
    FROM activity_units
    WHERE user_id = ${store.userId}
  `;
}

export async function insertActivityUnit(
  store: Store,
  row: {
    id?: string;
    source_id: string;
    external_id: string;
    title: string;
    occurred_at: string;
    project_id?: string | null;
  },
): Promise<Record<string, unknown> | null> {
  if (!(await getOwnedActivitySource(store, row.source_id))) return null;
  if (row.project_id && !(await getOwned(store, "projects", row.project_id))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO activity_units (
      id, user_id, source_id, external_id, title, occurred_at, project_id
    ) VALUES (
      ${id}, ${store.userId}, ${row.source_id}, ${row.external_id},
      ${row.title}, ${row.occurred_at}, ${row.project_id ?? null}
    )
    RETURNING id, user_id, source_id
  `;
  return rows[0] ?? null;
}

export async function upsertAppleIdentity(
  store: Store,
  row: { apple_user_id?: string; email?: string; is_private_relay?: boolean },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    INSERT INTO apple_identities (user_id, apple_user_id, email, is_private_relay)
    VALUES (${store.userId}, ${row.apple_user_id ?? null}, ${row.email ?? null}, ${row.is_private_relay ?? false})
    ON CONFLICT (user_id) DO UPDATE SET
      apple_user_id = COALESCE(EXCLUDED.apple_user_id, apple_identities.apple_user_id),
      email = COALESCE(EXCLUDED.email, apple_identities.email),
      is_private_relay = EXCLUDED.is_private_relay
    RETURNING user_id, apple_user_id, email, is_private_relay
  `;
  return rows[0] ?? null;
}

export async function listOwnedConnections(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, user_id, app, name, scopes, last_four, created_at, last_used_at, revoked_at
    FROM connections
    WHERE user_id = ${store.userId}
  `;
}

export async function insertConnection(
  store: Store,
  row: {
    id?: string;
    app: string;
    name: string;
    token_hash: string;
    last_four?: string;
    scopes?: unknown;
  },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = Array.isArray(row.scopes)
    ? await sql`
        INSERT INTO connections (id, user_id, app, name, token_hash, last_four, scopes)
        VALUES (
          ${id}, ${store.userId}, ${row.app}, ${row.name}, ${row.token_hash},
          ${row.last_four ?? null}, ${JSON.stringify(row.scopes)}::jsonb
        )
        RETURNING id, user_id, app, name, last_four, scopes
      `
    : await sql`
        INSERT INTO connections (id, user_id, app, name, token_hash, last_four)
        VALUES (${id}, ${store.userId}, ${row.app}, ${row.name}, ${row.token_hash}, ${row.last_four ?? null})
        RETURNING id, user_id, app, name, last_four, scopes
      `;
  return rows[0] ?? null;
}

export async function updateOwnedConnection(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const revoked = typeof patch.revoked_at === "string" || patch.revoked_at === null
    ? patch.revoked_at
    : undefined;
  if (revoked === undefined) return null;
  const rows = await sql`
    UPDATE connections
    SET revoked_at = ${revoked}
    WHERE id = ${id} AND user_id = ${store.userId}
    RETURNING id, user_id, app, name, revoked_at
  `;
  return rows[0] ?? null;
}

export async function deleteOwnedActivityBinding(store: Store, id: string): Promise<number> {
  const sql = store.sql;
  const rows = await sql`
    DELETE FROM activity_bindings
    WHERE id = ${id} AND user_id = ${store.userId}
    RETURNING id
  `;
  return rows.length;
}

export async function deleteOwnedPushByEndpoint(store: Store, endpoint: string): Promise<number> {
  const sql = store.sql;
  const rows = await sql`
    DELETE FROM push_subscriptions
    WHERE user_id = ${store.userId} AND endpoint = ${endpoint}
    RETURNING id
  `;
  return rows.length;
}

export async function listOwnedInboundEmails(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT email_id, user_id, subject, received_at
    FROM inbound_emails
    WHERE user_id = ${store.userId}
  `;
}

export async function insertInboundEmail(
  store: Store,
  row: { email_id: string; subject?: string; from_address?: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    INSERT INTO inbound_emails (email_id, user_id, subject, from_address)
    VALUES (${row.email_id}, ${store.userId}, ${row.subject ?? null}, ${row.from_address ?? null})
    RETURNING email_id, user_id
  `;
  return rows[0] ?? null;
}

export async function listOwnedSyncLog(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, user_id, provider, operation, status
    FROM sync_log
    WHERE user_id = ${store.userId}
  `;
}

async function ensureSettingsAndDomains(store: Store): Promise<void> {
  const sql = store.sql;
  await sql`
    INSERT INTO user_settings (user_id)
    VALUES (${store.userId})
    ON CONFLICT (user_id) DO NOTHING
  `;
  const existing = await sql`
    SELECT count(*)::int AS n FROM domains
    WHERE user_id = ${store.userId}
  `;
  if (Number((existing[0] as { n?: number } | undefined)?.n ?? 0) > 0) return;
  await sql`
    INSERT INTO domains (user_id, name, color) VALUES
      (${store.userId}, 'Work', '#2563EB'),
      (${store.userId}, 'Personal', '#7C3AED'),
      (${store.userId}, 'Health', '#0D9488'),
      (${store.userId}, 'Family', '#DB2777')
  `;
}

export type AppleIdentityRow = {
  user_id: string;
  apple_user_id: string | null;
  email: string | null;
  given_name: string | null;
  family_name: string | null;
  is_private_relay: boolean;
  refresh_token_enc: Uint8Array | null;
  refresh_token_iv: Uint8Array | null;
  key_version: number | null;
};

export async function getOwnedAppleIdentity(store: Store): Promise<AppleIdentityRow | null> {
  const sql = store.sql;
  const rows = await sql`
    SELECT user_id, apple_user_id, email, given_name, family_name, is_private_relay,
           refresh_token_enc, refresh_token_iv, key_version
    FROM apple_identities
    WHERE user_id = ${store.userId}
    ORDER BY apple_user_id DESC NULLS LAST
    LIMIT 1
  `;
  return (rows[0] as AppleIdentityRow | undefined) ?? null;
}

export async function appleUserIdTakenByOther(store: Store, appleUserId: string): Promise<boolean> {
  const sql = store.sql;
  const rows = await sql`
    SELECT user_id FROM apple_identities
    WHERE apple_user_id = ${appleUserId}
      AND user_id <> ${store.userId}
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

export async function upsertOwnedAppleIdentity(
  store: Store,
  profile: {
    apple_user_id: string | null;
    email: string | null;
    given_name: string | null;
    family_name: string | null;
    is_private_relay: boolean;
  },
  sealed?: { enc: Uint8Array; iv: Uint8Array; keyVersion: number } | null,
): Promise<void> {
  const sql = store.sql;
  if (sealed) {
    await sql`
      INSERT INTO apple_identities (
        user_id, apple_user_id, email, given_name, family_name, is_private_relay,
        refresh_token_enc, refresh_token_iv, key_version, updated_at
      )
      VALUES (
        ${store.userId}, ${profile.apple_user_id}, ${profile.email},
        ${profile.given_name}, ${profile.family_name}, ${profile.is_private_relay},
        ${sealed.enc}, ${sealed.iv}, ${sealed.keyVersion}, now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        apple_user_id = EXCLUDED.apple_user_id,
        email = EXCLUDED.email,
        given_name = EXCLUDED.given_name,
        family_name = EXCLUDED.family_name,
        is_private_relay = EXCLUDED.is_private_relay,
        refresh_token_enc = EXCLUDED.refresh_token_enc,
        refresh_token_iv = EXCLUDED.refresh_token_iv,
        key_version = EXCLUDED.key_version,
        updated_at = now()
    `;
    return;
  }
  await sql`
    INSERT INTO apple_identities (
      user_id, apple_user_id, email, given_name, family_name, is_private_relay, updated_at
    )
    VALUES (
      ${store.userId}, ${profile.apple_user_id}, ${profile.email},
      ${profile.given_name}, ${profile.family_name}, ${profile.is_private_relay}, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      apple_user_id = EXCLUDED.apple_user_id,
      email = EXCLUDED.email,
      given_name = EXCLUDED.given_name,
      family_name = EXCLUDED.family_name,
      is_private_relay = EXCLUDED.is_private_relay,
      updated_at = now()
  `;
}

export async function linkOwnedAppleAccount(
  sql: Store["sql"],
  authUserId: string,
  appleUserId: string,
): Promise<void> {
  const existing = await sql`
    SELECT id FROM account
    WHERE "userId" = ${authUserId}
      AND "providerId" = 'apple'
      AND "accountId" = ${appleUserId}
    LIMIT 1
  `;
  if ((existing[0] as { id?: string } | undefined)?.id) return;
  const taken = await sql`
    SELECT id FROM account
    WHERE "providerId" = 'apple' AND "accountId" = ${appleUserId}
    LIMIT 1
  `;
  if (taken[0]) return;
  await sql`
    INSERT INTO account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${appleUserId}, 'apple', ${authUserId}, now(), now())
  `;
}

export type OwnedAppleAccountToken = {
  id: string;
  userId: string;
  refreshToken: string;
};

export async function ownedAppleAccountTokenRow(
  sql: Store["sql"],
  authUserId: string,
  appleUserId?: string,
): Promise<OwnedAppleAccountToken | null> {
  const rows = appleUserId
    ? await sql`
        SELECT id, "userId", "refreshToken" FROM account
        WHERE "userId" = ${authUserId}
          AND "providerId" = 'apple'
          AND "accountId" = ${appleUserId}
        LIMIT 1
      `
    : await sql`
        SELECT id, "userId", "refreshToken" FROM account
        WHERE "userId" = ${authUserId}
          AND "providerId" = 'apple'
        LIMIT 1
      `;
  const row = rows[0] as
    | { id?: string; userId?: string; refreshToken?: string | null }
    | undefined;
  if (!row?.id || !row.userId || typeof row.refreshToken !== "string" || !row.refreshToken) {
    return null;
  }
  return { id: row.id, userId: row.userId, refreshToken: row.refreshToken };
}

export async function ownedAppleRefreshToken(
  sql: Store["sql"],
  env: Env,
  authUserId: string,
  appleUserId?: string,
): Promise<string | null> {
  const row = await ownedAppleAccountTokenRow(sql, authUserId, appleUserId);
  if (!row) return null;
  return openAccountRefreshToken(env, row.refreshToken, { id: row.id, userId: row.userId });
}

/** Planner `users` + Better Auth `"user"` (session, account cascade) in one txn. */
export async function wipeOwnedAccount(
  sql: Store["sql"],
  ids: { plannerUserId: string; authUserId: string },
): Promise<{ planner: number; auth: number }> {
  return sql.begin(async (tx) => {
    const planner = await tx`
      DELETE FROM users WHERE id = ${ids.plannerUserId} RETURNING id
    `;
    const auth = await tx`
      DELETE FROM "user" WHERE id = ${ids.authUserId} RETURNING id
    `;
    return { planner: planner.length, auth: auth.length };
  });
}
