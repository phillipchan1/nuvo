/**
 * Owned planner reads/writes. Every tenant filter is the tagged
 * owner clause (user_id equals store.userId) or a JOIN/EXISTS through
 * a user-owned parent. `scripts/prove-isolation-mutation.mjs` deletes
 * each of those clauses.
 */
import type { Sql } from "./db.ts";

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
  row: {
    id?: string;
    title: string;
    notes?: string;
    status?: string;
    project_id?: string | null;
    domain_id?: string | null;
    slot_id?: string | null;
    parent_task_id?: string | null;
  },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "tasks", row))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO tasks (id, user_id, title, notes, status, project_id, domain_id, slot_id, parent_task_id)
    VALUES (
      ${id}, ${store.userId}, ${row.title}, ${row.notes ?? ""}, ${row.status ?? "inbox"},
      ${row.project_id ?? null}, ${row.domain_id ?? null}, ${row.slot_id ?? null}, ${row.parent_task_id ?? null}
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertDomain(
  store: Store,
  row: { id?: string; name: string; color?: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO domains (id, user_id, name, color)
    VALUES (${id}, ${store.userId}, ${row.name}, ${row.color ?? "#6B7280"})
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertProject(
  store: Store,
  row: { id?: string; name: string; domain_id?: string | null; initiative_id?: string | null },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "projects", row))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO projects (id, user_id, name, domain_id, initiative_id)
    VALUES (${id}, ${store.userId}, ${row.name}, ${row.domain_id ?? null}, ${row.initiative_id ?? null})
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertInitiative(
  store: Store,
  row: { id?: string; name: string; domain_id?: string | null },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "initiatives", row))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO initiatives (id, user_id, name, domain_id)
    VALUES (${id}, ${store.userId}, ${row.name}, ${row.domain_id ?? null})
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertKeyResult(
  store: Store,
  row: { id?: string; name: string; initiative_id: string },
): Promise<Record<string, unknown> | null> {
  if (!row.initiative_id) return null;
  if (!(await assertOwnedFks(store, "key_results", row))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO key_results (id, user_id, name, initiative_id)
    VALUES (${id}, ${store.userId}, ${row.name}, ${row.initiative_id})
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertSlot(
  store: Store,
  row: {
    id?: string;
    title: string;
    do_date: string;
    start_time: string;
    duration_minutes: number;
    project_id?: string | null;
    domain_id?: string | null;
  },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "slots", row))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO slots (id, user_id, title, do_date, start_time, duration_minutes, project_id, domain_id)
    VALUES (
      ${id}, ${store.userId}, ${row.title}, ${row.do_date}, ${row.start_time},
      ${row.duration_minutes}, ${row.project_id ?? null}, ${row.domain_id ?? null}
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertRecordComment(
  store: Store,
  row: { id?: string; body: string; project_id?: string | null; initiative_id?: string | null },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "record_comments", row))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO record_comments (id, user_id, body, project_id, initiative_id)
    VALUES (${id}, ${store.userId}, ${row.body}, ${row.project_id ?? null}, ${row.initiative_id ?? null})
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function upsertEventDomainRouting(
  store: Store,
  row: { id?: string; event_key: string; domain_id?: string | null },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "event_domain_routing", row))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO event_domain_routing (id, user_id, event_key, domain_id)
    VALUES (${id}, ${store.userId}, ${row.event_key}, ${row.domain_id ?? null})
    ON CONFLICT (user_id, event_key) DO UPDATE
    SET domain_id = EXCLUDED.domain_id
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function insertLabel(
  store: Store,
  row: { id?: string; name: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  try {
    const rows = await sql`
      INSERT INTO labels (id, user_id, name)
      VALUES (${id}, ${store.userId}, ${row.name})
      RETURNING *
    `;
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function insertRecurrence(
  store: Store,
  row: { id?: string; kind: string; rrule: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO recurrences (id, user_id, kind, rrule)
    VALUES (${id}, ${store.userId}, ${row.kind}, ${row.rrule})
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertWeekReview(
  store: Store,
  row: { id?: string; week_start: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  try {
    const rows = await sql`
      INSERT INTO week_reviews (id, user_id, week_start)
      VALUES (${id}, ${store.userId}, ${row.week_start})
      RETURNING *
    `;
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function insertSprint(
  store: Store,
  row: { id?: string; week_start: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  try {
    const rows = await sql`
      INSERT INTO sprints (id, user_id, week_start)
      VALUES (${id}, ${store.userId}, ${row.week_start})
      RETURNING *
    `;
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function insertReminder(
  store: Store,
  row: { id?: string; target_kind: string; target_id?: string | null },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "reminders", row))) return null;
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO reminders (id, user_id, target_kind, target_id)
    VALUES (${id}, ${store.userId}, ${row.target_kind}, ${row.target_id ?? null})
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertOwned(
  store: Store,
  table: PlannerTable,
  row: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, table, row))) return null;
  if (table === "tasks") {
    return insertTask(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      title: String(row.title ?? "Untitled"),
      notes: typeof row.notes === "string" ? row.notes : "",
      status: typeof row.status === "string" ? row.status : "inbox",
      project_id: optId(row.project_id),
      domain_id: optId(row.domain_id),
      slot_id: optId(row.slot_id),
      parent_task_id: optId(row.parent_task_id),
    });
  }
  if (table === "domains") {
    return insertDomain(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      name: String(row.name ?? "Untitled"),
      color: typeof row.color === "string" ? row.color : undefined,
    });
  }
  if (table === "projects") {
    return insertProject(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      name: String(row.name ?? "Untitled"),
      domain_id: optId(row.domain_id),
      initiative_id: optId(row.initiative_id),
    });
  }
  if (table === "initiatives") {
    return insertInitiative(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      name: String(row.name ?? "Untitled"),
      domain_id: optId(row.domain_id),
    });
  }
  if (table === "key_results") {
    const initiativeId = optId(row.initiative_id);
    if (!initiativeId) return null;
    return insertKeyResult(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      name: String(row.name ?? "Untitled"),
      initiative_id: initiativeId,
    });
  }
  if (table === "slots") {
    if (typeof row.do_date !== "string" || typeof row.start_time !== "string") return null;
    const duration = Number(row.duration_minutes);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return insertSlot(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      title: String(row.title ?? ""),
      do_date: row.do_date,
      start_time: row.start_time,
      duration_minutes: duration,
      project_id: optId(row.project_id),
      domain_id: optId(row.domain_id),
    });
  }
  if (table === "record_comments") {
    return insertRecordComment(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      body: String(row.body ?? ""),
      project_id: optId(row.project_id),
      initiative_id: optId(row.initiative_id),
    });
  }
  if (table === "event_domain_routing") {
    if (typeof row.event_key !== "string" || !row.event_key) return null;
    return upsertEventDomainRouting(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      event_key: row.event_key,
      domain_id: optId(row.domain_id),
    });
  }
  if (table === "user_settings") {
    return upsertSettings(store, typeof row.theme === "string" ? row.theme : "system");
  }
  if (table === "labels") {
    return insertLabel(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      name: String(row.name ?? "Untitled"),
    });
  }
  if (table === "recurrences") {
    return insertRecurrence(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      kind: typeof row.kind === "string" ? row.kind : "task",
      rrule: typeof row.rrule === "string" ? row.rrule : "",
    });
  }
  if (table === "week_reviews") {
    if (typeof row.week_start !== "string") return null;
    return insertWeekReview(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      week_start: row.week_start,
    });
  }
  if (table === "sprints") {
    if (typeof row.week_start !== "string") return null;
    return insertSprint(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      week_start: row.week_start,
    });
  }
  if (table === "reminders") {
    return insertReminder(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      target_kind: typeof row.target_kind === "string" ? row.target_kind : "task",
      target_id: optId(row.target_id),
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
  theme: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    INSERT INTO user_settings (user_id, theme)
    VALUES (${store.userId}, ${theme})
    ON CONFLICT (user_id) DO UPDATE
    SET theme = EXCLUDED.theme, updated_at = now()
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateTaskTitle(
  store: Store,
  id: string,
  title: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    UPDATE tasks
    SET title = ${title}, updated_at = now()
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateDomainName(
  store: Store,
  id: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    UPDATE domains
    SET name = ${name}
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
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
  patch: { name?: string; domain_id?: string | null; initiative_id?: string | null },
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "projects", patch))) return null;
  const sql = store.sql;
  const setName = typeof patch.name === "string" ? 1 : 0;
  const setDomain = "domain_id" in patch ? 1 : 0;
  const setInit = "initiative_id" in patch ? 1 : 0;
  const name = typeof patch.name === "string" ? patch.name : "";
  const domainId = patch.domain_id ?? null;
  const initiativeId = patch.initiative_id ?? null;
  const rows = await sql`
    UPDATE projects
    SET
      name = CASE WHEN ${setName} = 1 THEN ${name} ELSE name END,
      domain_id = CASE WHEN ${setDomain} = 1 THEN ${domainId} ELSE domain_id END,
      initiative_id = CASE WHEN ${setInit} = 1 THEN ${initiativeId} ELSE initiative_id END
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateSettingsTheme(
  store: Store,
  theme: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    UPDATE user_settings
    SET theme = ${theme}, updated_at = now()
    WHERE user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateOwned(
  store: Store,
  table: PlannerTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, table, patch))) return null;
  if (table === "tasks") {
    if (typeof patch.title === "string") return updateTaskTitle(store, id, patch.title);
    if ("project_id" in patch || "domain_id" in patch || "slot_id" in patch || "parent_task_id" in patch) {
      return updateTaskFks(store, id, patch);
    }
    return null;
  }
  if (table === "domains") {
    if (typeof patch.name !== "string") return null;
    return updateDomainName(store, id, patch.name);
  }
  if (table === "projects") {
    const hasName = typeof patch.name === "string";
    const hasFk = "domain_id" in patch || "initiative_id" in patch;
    if (!hasName && !hasFk) return null;
    return updateProject(store, id, {
      name: hasName ? String(patch.name) : undefined,
      domain_id: "domain_id" in patch ? optId(patch.domain_id) : undefined,
      initiative_id: "initiative_id" in patch ? optId(patch.initiative_id) : undefined,
    });
  }
  if (table === "user_settings") {
    if (id !== store.userId) return null;
    if (typeof patch.theme !== "string") return null;
    return updateSettingsTheme(store, patch.theme);
  }
  if (table === "event_domain_routing" && "domain_id" in patch) {
    const current = await getOwned(store, table, id);
    if (!current || typeof current.event_key !== "string") return null;
    return upsertEventDomainRouting(store, {
      id,
      event_key: current.event_key,
      domain_id: optId(patch.domain_id),
    });
  }
  if (table === "initiatives") {
    return updateInitiative(store, id, patch);
  }
  if (table === "key_results") {
    return updateKeyResult(store, id, patch);
  }
  if (table === "slots") {
    return updateSlot(store, id, patch);
  }
  if (table === "record_comments") {
    return updateRecordComment(store, id, patch);
  }
  if (table === "reminders") {
    return updateReminder(store, id, patch);
  }
  if (table === "labels") {
    if (typeof patch.name !== "string") return null;
    return updateLabelName(store, id, patch.name);
  }
  if (table === "recurrences") {
    if (typeof patch.rrule !== "string") return null;
    return updateRecurrenceRule(store, id, patch.rrule);
  }
  if (table === "week_reviews" && patch.report != null) {
    return updateWeekReviewReport(store, id, patch.report);
  }
  if (table === "sprints" && typeof patch.week_start === "string") {
    return updateSprintWeek(store, id, patch.week_start);
  }
  return null;
}

export async function updateInitiative(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "initiatives", patch))) return null;
  const hasName = typeof patch.name === "string";
  const hasFk = "domain_id" in patch;
  if (!hasName && !hasFk) return null;
  const sql = store.sql;
  const setName = hasName ? 1 : 0;
  const setDomain = hasFk ? 1 : 0;
  const name = hasName ? String(patch.name) : "";
  const domainId = optId(patch.domain_id);
  const rows = await sql`
    UPDATE initiatives
    SET
      name = CASE WHEN ${setName} = 1 THEN ${name} ELSE name END,
      domain_id = CASE WHEN ${setDomain} = 1 THEN ${domainId} ELSE domain_id END
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateKeyResult(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "key_results", patch))) return null;
  const hasName = typeof patch.name === "string";
  const hasFk = "initiative_id" in patch;
  if (!hasName && !hasFk) return null;
  const sql = store.sql;
  const setName = hasName ? 1 : 0;
  const setInit = hasFk ? 1 : 0;
  const name = hasName ? String(patch.name) : "";
  const initiativeId = optId(patch.initiative_id);
  const rows = await sql`
    UPDATE key_results
    SET
      name = CASE WHEN ${setName} = 1 THEN ${name} ELSE name END,
      initiative_id = CASE WHEN ${setInit} = 1 THEN ${initiativeId} ELSE initiative_id END
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateSlot(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "slots", patch))) return null;
  const hasTitle = typeof patch.title === "string";
  const hasProject = "project_id" in patch;
  const hasDomain = "domain_id" in patch;
  if (!hasTitle && !hasProject && !hasDomain) return null;
  const sql = store.sql;
  const setTitle = hasTitle ? 1 : 0;
  const setProject = hasProject ? 1 : 0;
  const setDomain = hasDomain ? 1 : 0;
  const title = hasTitle ? String(patch.title) : "";
  const projectId = optId(patch.project_id);
  const domainId = optId(patch.domain_id);
  const rows = await sql`
    UPDATE slots
    SET
      title = CASE WHEN ${setTitle} = 1 THEN ${title} ELSE title END,
      project_id = CASE WHEN ${setProject} = 1 THEN ${projectId} ELSE project_id END,
      domain_id = CASE WHEN ${setDomain} = 1 THEN ${domainId} ELSE domain_id END,
      updated_at = now()
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateRecordComment(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "record_comments", patch))) return null;
  const hasBody = typeof patch.body === "string";
  const hasProject = "project_id" in patch;
  const hasInit = "initiative_id" in patch;
  if (!hasBody && !hasProject && !hasInit) return null;
  const sql = store.sql;
  const setBody = hasBody ? 1 : 0;
  const setProject = hasProject ? 1 : 0;
  const setInit = hasInit ? 1 : 0;
  const body = hasBody ? String(patch.body) : "";
  const projectId = optId(patch.project_id);
  const initiativeId = optId(patch.initiative_id);
  const rows = await sql`
    UPDATE record_comments
    SET
      body = CASE WHEN ${setBody} = 1 THEN ${body} ELSE body END,
      project_id = CASE WHEN ${setProject} = 1 THEN ${projectId} ELSE project_id END,
      initiative_id = CASE WHEN ${setInit} = 1 THEN ${initiativeId} ELSE initiative_id END
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
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
  const hasAnchor = typeof patch.anchor === "string";
  const hasTarget = "target_id" in patch;
  if (!hasAnchor && !hasTarget) return null;
  const sql = store.sql;
  const setAnchor = hasAnchor ? 1 : 0;
  const setTarget = hasTarget ? 1 : 0;
  const anchor = hasAnchor ? String(patch.anchor) : "";
  const targetId = optId(patch.target_id);
  const rows = await sql`
    UPDATE reminders
    SET
      anchor = CASE WHEN ${setAnchor} = 1 THEN ${anchor} ELSE anchor END,
      target_id = CASE WHEN ${setTarget} = 1 THEN ${targetId} ELSE target_id END
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateLabelName(
  store: Store,
  id: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    UPDATE labels
    SET name = ${name}
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateRecurrenceRule(
  store: Store,
  id: string,
  rrule: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    UPDATE recurrences
    SET rrule = ${rrule}
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateWeekReviewReport(
  store: Store,
  id: string,
  report: unknown,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const payload = JSON.stringify(report ?? {});
  const rows = await sql`
    UPDATE week_reviews
    SET report = ${payload}::jsonb
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateSprintWeek(
  store: Store,
  id: string,
  weekStart: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    UPDATE sprints
    SET week_start = ${weekStart}
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
}

export async function updateTaskFks(
  store: Store,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!(await assertOwnedFks(store, "tasks", patch))) return null;
  const sql = store.sql;
  const setProject = "project_id" in patch ? 1 : 0;
  const setDomain = "domain_id" in patch ? 1 : 0;
  const setSlot = "slot_id" in patch ? 1 : 0;
  const setParent = "parent_task_id" in patch ? 1 : 0;
  const projectId = optId(patch.project_id);
  const domainId = optId(patch.domain_id);
  const slotId = optId(patch.slot_id);
  const parentId = optId(patch.parent_task_id);
  const rows = await sql`
    UPDATE tasks
    SET
      project_id = CASE WHEN ${setProject} = 1 THEN ${projectId} ELSE project_id END,
      domain_id = CASE WHEN ${setDomain} = 1 THEN ${domainId} ELSE domain_id END,
      slot_id = CASE WHEN ${setSlot} = 1 THEN ${slotId} ELSE slot_id END,
      parent_task_id = CASE WHEN ${setParent} = 1 THEN ${parentId} ELSE parent_task_id END,
      updated_at = now()
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows.length ? rows[0] ?? null : null;
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
): Promise<{ applied: string[]; rejected: string[]; matched: number }> {
  if (!isPlannerTable(table)) {
    throw new Error(`apply_patch: ${table} is not a syncable table`);
  }
  const rejected: string[] = [];
  const title = typeof patch.title === "string" ? patch.title : null;
  const name = typeof patch.name === "string" ? patch.name : null;
  const theme = typeof patch.theme === "string" ? patch.theme : null;
  for (const key of Object.keys(patch)) {
    if (key === "id" || key === "user_id" || key === "created_at" || key === "field_ts") {
      rejected.push(key);
    }
  }
  const matchId = typeof match.id === "string" ? match.id : "";
  if (table === "tasks" && title) {
    const row = await updateTaskTitle(store, matchId, title);
    return { applied: row ? ["title"] : [], rejected, matched: row ? 1 : 0 };
  }
  if (table === "domains" && name) {
    const row = await updateDomainName(store, matchId, name);
    return { applied: row ? ["name"] : [], rejected, matched: row ? 1 : 0 };
  }
  if (table === "projects" && name) {
    const row = await updateProjectName(store, matchId, name);
    return { applied: row ? ["name"] : [], rejected, matched: row ? 1 : 0 };
  }
  if (table === "user_settings" && theme) {
    if (matchId && matchId !== store.userId) {
      return { applied: [], rejected, matched: 0 };
    }
    const row = await updateSettingsTheme(store, theme);
    return { applied: row ? ["theme"] : [], rejected, matched: row ? 1 : 0 };
  }
  return { applied: [], rejected, matched: 0 };
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
    SELECT id, user_id, account_id, title, start_at, end_at, all_day, calendar_id
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
    SELECT id, user_id, account_id, title, start_at, end_at
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

export async function insertPushSubscription(
  store: Store,
  row: { id?: string; endpoint: string; p256dh: string; auth: string; label?: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, label)
    VALUES (${id}, ${store.userId}, ${row.endpoint}, ${row.p256dh}, ${row.auth}, ${row.label ?? null})
    RETURNING id, user_id, endpoint
  `;
  return rows[0] ?? null;
}

export async function listOwnedActivitySources(store: Store): Promise<Record<string, unknown>[]> {
  const sql = store.sql;
  return sql`
    SELECT id, user_id, kind, login, needs_reconnect
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
    SELECT id, user_id, source_id, title, external_id, project_id
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
    SELECT id, user_id, app, name, last_four, revoked_at
    FROM connections
    WHERE user_id = ${store.userId}
  `;
}

export async function insertConnection(
  store: Store,
  row: { id?: string; app: string; name: string; token_hash: string; last_four?: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO connections (id, user_id, app, name, token_hash, last_four)
    VALUES (${id}, ${store.userId}, ${row.app}, ${row.name}, ${row.token_hash}, ${row.last_four ?? null})
    RETURNING id, user_id, app, name
  `;
  return rows[0] ?? null;
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

export async function ownedAppleRefreshToken(
  sql: Store["sql"],
  authUserId: string,
  appleUserId?: string,
): Promise<string | null> {
  const rows = appleUserId
    ? await sql`
        SELECT "refreshToken" FROM account
        WHERE "userId" = ${authUserId}
          AND "providerId" = 'apple'
          AND "accountId" = ${appleUserId}
        LIMIT 1
      `
    : await sql`
        SELECT "refreshToken" FROM account
        WHERE "userId" = ${authUserId}
          AND "providerId" = 'apple'
        LIMIT 1
      `;
  const token = (rows[0] as { refreshToken?: string | null } | undefined)?.refreshToken;
  return typeof token === "string" && token ? token : null;
}

export async function wipePlannerUser(store: Store): Promise<number> {
  const sql = store.sql;
  const rows = await sql`
    DELETE FROM users WHERE id = ${store.userId} RETURNING id
  `;
  return rows.length;
}

export async function wipeBetterAuthUser(sql: Store["sql"], authUserId: string): Promise<number> {
  const rows = await sql`
    DELETE FROM "user" WHERE id = ${authUserId} RETURNING id
  `;
  return rows.length;
}
