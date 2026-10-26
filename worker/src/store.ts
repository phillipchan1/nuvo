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
        return sql`SELECT * FROM user_settings WHERE user_id = ${store.userId} LIMIT 1`;
    }
  })();
  return rows[0] ?? null;
}

export async function insertTask(
  store: Store,
  row: { id?: string; title: string; notes?: string; status?: string },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO tasks (id, user_id, title, notes, status)
    VALUES (${id}, ${store.userId}, ${row.title}, ${row.notes ?? ""}, ${row.status ?? "inbox"})
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
  row: { id?: string; name: string; domain_id?: string | null },
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const id = row.id ?? crypto.randomUUID();
  const rows = await sql`
    INSERT INTO projects (id, user_id, name, domain_id)
    VALUES (${id}, ${store.userId}, ${row.name}, ${row.domain_id ?? null})
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertOwned(
  store: Store,
  table: PlannerTable,
  row: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (table === "tasks") {
    return insertTask(store, {
      id: typeof row.id === "string" ? row.id : undefined,
      title: String(row.title ?? "Untitled"),
      notes: typeof row.notes === "string" ? row.notes : "",
      status: typeof row.status === "string" ? row.status : "inbox",
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
      domain_id: typeof row.domain_id === "string" ? row.domain_id : null,
    });
  }
  if (table === "user_settings") {
    const sql = store.sql;
    const rows = await sql`
      INSERT INTO user_settings (user_id, theme)
      VALUES (${store.userId}, ${typeof row.theme === "string" ? row.theme : "system"})
      ON CONFLICT (user_id) DO NOTHING
      RETURNING *
    `;
    return rows[0] ?? getOwned(store, "user_settings", store.userId);
  }
  return null;
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
  return rows[0] ?? null;
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
  return rows[0] ?? null;
}

export async function updateProjectName(
  store: Store,
  id: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  const sql = store.sql;
  const rows = await sql`
    UPDATE projects
    SET name = ${name}
    WHERE id = ${id}
      AND user_id = ${store.userId}
    RETURNING *
  `;
  return rows[0] ?? null;
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
  return rows[0] ?? null;
}

export async function updateOwned(
  store: Store,
  table: PlannerTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (table === "tasks" && typeof patch.title === "string") {
    return updateTaskTitle(store, id, patch.title);
  }
  if (table === "domains" && typeof patch.name === "string") {
    return updateDomainName(store, id, patch.name);
  }
  if (table === "projects" && typeof patch.name === "string") {
    return updateProjectName(store, id, patch.name);
  }
  if (table === "user_settings" && typeof patch.theme === "string") {
    return updateSettingsTheme(store, patch.theme);
  }
  return getOwned(store, table, id);
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
        return sql`DELETE FROM user_settings WHERE user_id = ${store.userId} RETURNING user_id AS id`;
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

export async function bootstrapUser(store: Store, email: string | null): Promise<void> {
  const sql = store.sql;
  await sql`
    INSERT INTO users (id, email)
    VALUES (${store.userId}, ${email})
    ON CONFLICT (id) DO NOTHING
  `;
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
