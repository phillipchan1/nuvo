/**
 * Postgres round-trip for every planner writable column, including enum
 * casts for complete / trash. Skips when DATABASE_URL is unset (local).
 * CI always sets it (postgres:17).
 *
 * Run: DATABASE_URL=… node --experimental-strip-types worker/src/storeColumns.check.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { postgresSsl } from "./db.ts";
import {
  applyPatch,
  getOwned,
  insertOwned,
  makeStore,
  PLANNER_TABLES,
  updateOwned,
  WRITABLE_COLUMNS,
  type PlannerTable,
} from "./store.ts";

const dbUrl = (process.env.DATABASE_URL ?? "").trim();
if (!dbUrl) {
  console.log("storeColumns: skipped (DATABASE_URL unset)");
  process.exit(0);
}

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const neon = readFileSync(join(here, "../schema/neon.sql"), "utf8");
const sql = postgres(dbUrl, { max: 1, ssl: postgresSsl(dbUrl) });

const USER = "cccccccc-0000-4000-8000-000000000001";
const ids = {
  domain: "cccccccc-0000-4000-8000-000000000010",
  initiative: "cccccccc-0000-4000-8000-000000000011",
  project: "cccccccc-0000-4000-8000-000000000012",
  keyResult: "cccccccc-0000-4000-8000-000000000013",
  slot: "cccccccc-0000-4000-8000-000000000014",
  task: "cccccccc-0000-4000-8000-000000000015",
  label: "cccccccc-0000-4000-8000-000000000016",
  recurrence: "cccccccc-0000-4000-8000-000000000017",
  comment: "cccccccc-0000-4000-8000-000000000018",
  weekReview: "cccccccc-0000-4000-8000-000000000019",
  sprint: "cccccccc-0000-4000-8000-00000000001a",
  reminder: "cccccccc-0000-4000-8000-00000000001b",
  routing: "cccccccc-0000-4000-8000-00000000001c",
  calendar: "cccccccc-0000-4000-8000-00000000001d",
  childTask: "cccccccc-0000-4000-8000-00000000001e",
  connection: "cccccccc-0000-4000-8000-00000000001f",
};

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function same(got: unknown, want: unknown): boolean {
  if (want == null) return got == null;
  if (typeof want === "number") return Number(got) === want;
  if (typeof want === "boolean") return got === true || got === "true" || got === "t";
  if (Array.isArray(want)) {
    const gotArr = Array.isArray(got) ? got : typeof got === "string" ? JSON.parse(got) : null;
    return JSON.stringify(gotArr) === JSON.stringify(want);
  }
  if (typeof want === "object") {
    const parsed = typeof got === "string" ? JSON.parse(got) : got;
    return JSON.stringify(parsed) === JSON.stringify(want);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(want)) {
    return iso(got).startsWith(String(want).slice(0, 10));
  }
  return String(got) === String(want);
}

function sample(table: PlannerTable, col: (typeof WRITABLE_COLUMNS)[PlannerTable][number], flip: boolean): unknown {
  const n = flip ? 1 : 0;
  if (col.cast === "task_status") return flip ? "planned" : "inbox";
  if (col.cast === "task_priority") return flip ? "high" : "low";
  if (col.kind === "bool") return flip;
  if (col.kind === "num") return flip ? 9 : 3;
  if (col.kind === "int[]") return flip ? [1, 4] : [2];
  if (col.kind === "date[]") return flip ? ["2026-11-01"] : ["2026-10-27"];
  if (col.kind === "json") return flip ? { k: col.name, n } : { k: col.name };
  if (col.kind === "uuid") {
    if (col.name === "domain_id" || col.name === "manual_domain_id") return ids.domain;
    if (col.name === "initiative_id") return ids.initiative;
    if (col.name === "project_id") return ids.project;
    if (col.name === "key_result_id") return ids.keyResult;
    if (col.name === "slot_id") return ids.slot;
    if (col.name === "sprint_id") return ids.sprint;
    if (col.name === "recurrence_id") return ids.recurrence;
    if (col.name === "parent_task_id") return ids.task;
    if (col.name === "target_id") return ids.task;
    if (col.name === "connection_id") return ids.connection;
    if (col.name === "default_calendar_account_id") return ids.calendar;
    return null;
  }
  if (col.name === "theme") return flip ? "dark" : "light";
  if (col.name === "status" && table !== "tasks") return flip ? "paused" : "active";
  if (col.name === "target_kind") return "task";
  if (col.name === "author_kind") return flip ? "nuvo" : "user";
  if (col.name === "kind") return flip ? "slot" : "task";
  if (col.name === "freq") return flip ? "daily" : "weekly";
  if (col.name === "energy") return flip ? "high" : "low";
  if (col.name === "assignee") return flip ? "me" : "other";
  if (col.name === "auto_add_meet") return flip ? "always" : "guests";
  if (
    col.name.endsWith("_date") ||
    col.name === "do_date" ||
    col.name === "deadline" ||
    col.name === "anchor_date" ||
    col.name === "until_date" ||
    col.name === "last_materialized" ||
    col.name === "last_rollover_date" ||
    col.name === "week_start"
  ) {
    return flip ? "2026-11-02" : "2026-10-27";
  }
  if (col.name.endsWith("_at") || col.name === "start_time" || col.name === "routed_at") {
    return flip ? "2026-11-02T15:00:00.000Z" : "2026-10-27T16:00:00.000Z";
  }
  if (col.name === "event_key") return flip ? "evt-b" : "evt-a";
  return flip ? `${col.name}-b` : `${col.name}-a`;
}

function seedRow(table: PlannerTable): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (table !== "user_settings") {
    const idByTable: Partial<Record<PlannerTable, string>> = {
      domains: ids.domain,
      initiatives: ids.initiative,
      projects: ids.project,
      key_results: ids.keyResult,
      slots: ids.slot,
      tasks: ids.task,
      labels: ids.label,
      recurrences: ids.recurrence,
      record_comments: ids.comment,
      week_reviews: ids.weekReview,
      sprints: ids.sprint,
      reminders: ids.reminder,
      event_domain_routing: ids.routing,
    };
    row.id = idByTable[table];
  }
  for (const col of WRITABLE_COLUMNS[table]) {
    if (col.name === "parent_task_id") continue;
    if (col.name === "sprint_id" && table === "tasks") continue;
    if (col.name === "recurrence_id" && (table === "tasks" || table === "slots")) continue;
    if (col.name === "key_result_id" && (table === "tasks" || table === "projects")) continue;
    row[col.name] = sample(table, col, false);
  }
  if (table === "slots") {
    row.do_date = "2026-10-27";
    row.start_time = "2026-10-27T16:00:00.000Z";
    row.duration_minutes = 30;
  }
  if (table === "key_results") row.initiative_id = ids.initiative;
  if (table === "reminders") {
    row.target_kind = "task";
    row.target_id = ids.task;
  }
  if (table === "event_domain_routing") row.event_key = "evt-a";
  return row;
}

const order: PlannerTable[] = [
  "domains",
  "initiatives",
  "projects",
  "key_results",
  "slots",
  "labels",
  "recurrences",
  "sprints",
  "tasks",
  "record_comments",
  "week_reviews",
  "reminders",
  "event_domain_routing",
  "user_settings",
];

try {
  await sql.unsafe(neon);

  await sql`DELETE FROM users WHERE id = ${USER}`;
  await sql`INSERT INTO users (id, email) VALUES (${USER}, 'store-columns@example.test')`;
  await sql`
    INSERT INTO calendar_accounts (id, user_id, provider, email)
    VALUES (${ids.calendar}, ${USER}, 'google', 'store-columns@example.test')
  `;
  const connectionHash = `hash-${USER}`;
  await sql`
    INSERT INTO connections (id, user_id, app, name, token_hash, last_four)
    VALUES (${ids.connection}, ${USER}, 'test', 'store-columns', ${connectionHash}, 'col1')
  `;

  const store = makeStore(sql, USER);
  const rowIds: Partial<Record<PlannerTable, string>> = { user_settings: USER };

  for (const table of order) {
    const inserted = await insertOwned(store, table, seedRow(table));
    ok(inserted != null, `${table}: insert`);
    const id = table === "user_settings" ? USER : String(inserted?.id ?? "");
    rowIds[table] = id;
    ok(Boolean(id), `${table}: has id`);
  }

  const child = await insertOwned(store, "tasks", {
    id: ids.childTask,
    title: "child",
    parent_task_id: ids.task,
  });
  ok(child != null, "child task insert");
  const childPatched = await updateOwned(store, "tasks", ids.childTask, { parent_task_id: ids.task });
  ok(childPatched != null && same(childPatched.parent_task_id, ids.task), "tasks.parent_task_id: stored");

  for (const table of PLANNER_TABLES) {
    const id = rowIds[table];
    if (!id) {
      ok(false, `${table}: missing row for column walk`);
      continue;
    }
    for (const col of WRITABLE_COLUMNS[table]) {
      if (col.name === "parent_task_id") continue;
      const want = sample(table, col, true);
      const patched = await updateOwned(store, table, id, { [col.name]: want });
      ok(patched != null, `${table}.${col.name}: update`);
      const got = patched?.[col.name];
      ok(same(got, want), `${table}.${col.name}: stored ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
      const reread = await getOwned(store, table, id);
      ok(same(reread?.[col.name], want), `${table}.${col.name}: reread`);
    }
  }

  const done = await applyPatch(store, "tasks", { id: ids.task }, {
    status: "done",
    completed_at: "2026-10-27T18:00:00.000Z",
  });
  ok(done.applied.includes("status"), "complete: apply_patch status");
  const doneRow = await getOwned(store, "tasks", ids.task);
  ok(doneRow?.status === "done", `complete: status is done (got ${String(doneRow?.status)})`);

  const trash = await applyPatch(store, "tasks", { id: ids.task }, {
    status: "trashed",
    trashed_at: "2026-10-27T18:05:00.000Z",
  });
  ok(trash.applied.includes("status"), "trash: apply_patch status");
  const trashRow = await getOwned(store, "tasks", ids.task);
  ok(trashRow?.status === "trashed", `trash: status is trashed (got ${String(trashRow?.status)})`);

  const backlog = await applyPatch(store, "tasks", { id: ids.task }, { status: "backlog" });
  ok(backlog.applied.includes("status"), "backlog: apply_patch status");
  const backlogRow = await getOwned(store, "tasks", ids.task);
  ok(backlogRow?.status === "backlog", `backlog: status is backlog (got ${String(backlogRow?.status)})`);
} finally {
  await sql.end({ timeout: 2 });
}

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
