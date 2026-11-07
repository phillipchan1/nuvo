import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { runCronJob } from "../worker/src/cronJobs.ts";
import { applyIsolationSchema } from "../worker/src/isolationDb.ts";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { insertTask, makeStore, rotateInboundToken, updateProject, updateTaskTitle } from "../worker/src/store.ts";

// Blocker 7 (docs/cloudflare-cutover.md): a server write on Neon must stamp
// field_ts for the fields it changed, or the SPA's per-field last-write-wins
// lets an older offline edit overwrite it. One definition —
// worker/schema/field-ts.sql — covers every writer.
const ROOT = join(import.meta.dirname, "..");
const FIELD_TS = readFileSync(join(ROOT, "worker/schema/field-ts.sql"), "utf8");
const MIGRATION_65 = readFileSync(join(ROOT, "supabase/migrations/00000000000065_stamp_unstamped_field_ts.sql"), "utf8");
const A = "11111111-1111-1111-1111-111111111111";

function fnBody(sql: string): string {
  const start = sql.search(/create or replace function public\.stamp_unstamped_field_ts/i);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end).toLowerCase().replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
}

/** neon.sql + the columns a Supabase copy carries (field_ts on the synced tables). */
async function copiedShape(): Promise<PGlite> {
  const db = new PGlite();
  await applyIsolationSchema(db);
  for (const t of ["tasks", "projects", "user_settings"]) {
    await db.exec(`ALTER TABLE public.${t} ADD COLUMN IF NOT EXISTS field_ts jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }
  await db.exec(FIELD_TS);
  return db;
}

async function stamps(db: PGlite, table: string, where: string): Promise<Record<string, string>> {
  const r = await db.query<{ field_ts: Record<string, string> }>(`SELECT field_ts FROM public.${table} WHERE ${where}`);
  return r.rows[0]!.field_ts;
}

describe("field_ts stamping for server writers (blocker 7)", () => {
  it("is Supabase's own trigger body, verbatim", () => {
    expect(fnBody(FIELD_TS).length).toBeGreaterThan(500);
    expect(fnBody(FIELD_TS)).toBe(fnBody(MIGRATION_65));
  });

  it("installs only where field_ts exists, and re-applies cleanly", async () => {
    const db = await copiedShape();
    await db.exec(FIELD_TS);
    const trig = await db.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgname LIKE '%_stamp_field_ts' ORDER BY tgname`,
    );
    expect(trig.rows.map((r) => r.tgname)).toEqual([
      "projects_stamp_field_ts",
      "tasks_stamp_field_ts",
      "user_settings_stamp_field_ts",
    ]);
    const missing = await db.query<{ count: number }>(
      readFileSync(join(ROOT, "scripts/cutover_copy.py"), "utf8").match(/FIELD_TS_TRIGGERS_MISSING_SQL = """([\s\S]*?)"""/)![1]!,
    );
    expect(Number(missing.rows[0]!.count)).toBe(0);
  });

  it("an agent/capture-style insert stamps what it set", async () => {
    const db = await copiedShape();
    const store = makeStore(makePgliteSql(db), A);
    const row = await insertTask(store, { title: "from the agent", notes: "" });
    const ts = await stamps(db, "tasks", `id = '${row!.id}'`);
    expect(ts.title).toBeTruthy();
    expect(ts.status).toBeTruthy();
    expect(ts.do_date).toBeUndefined(); // null is not a write
  });

  it("a store update stamps the field it changed, and only that field", async () => {
    const db = await copiedShape();
    const store = makeStore(makePgliteSql(db), A);
    const row = await insertTask(store, { title: "old", notes: "keep" });
    await db.query(`UPDATE tasks SET field_ts = '{"title":"2020-01-01T00:00:00Z","notes":"2020-01-01T00:00:00Z"}' WHERE id = $1`, [row!.id]);
    await updateTaskTitle(store, row!.id as string, "renamed by the agent");
    const ts = await stamps(db, "tasks", `id = '${row!.id}'`);
    expect(new Date(ts.title!).getFullYear()).toBeGreaterThan(2020);
    expect(ts.notes).toBe("2020-01-01T00:00:00Z");
  });

  it("a write that changes nothing leaves the stamp alone", async () => {
    const db = await copiedShape();
    const store = makeStore(makePgliteSql(db), A);
    const row = await insertTask(store, { title: "same", notes: "" });
    await db.query(`UPDATE tasks SET field_ts = '{"title":"2020-01-01T00:00:00Z"}' WHERE id = $1`, [row!.id]);
    await updateTaskTitle(store, row!.id as string, "same");
    expect((await stamps(db, "tasks", `id = '${row!.id}'`)).title).toBe("2020-01-01T00:00:00Z");
  });

  it("a client write that carries its own stamp keeps it (rest.ts / apply_patch)", async () => {
    const db = await copiedShape();
    const store = makeStore(makePgliteSql(db), A);
    const row = await insertTask(store, { title: "x", notes: "" });
    await db.query(
      `UPDATE tasks SET title = 'client', field_ts = field_ts || '{"title":"2031-05-05T05:05:05Z"}' WHERE id = $1`,
      [row!.id],
    );
    expect((await stamps(db, "tasks", `id = '${row!.id}'`)).title).toBe("2031-05-05T05:05:05Z");
  });

  it("the rollover cron stamps the dates it moved; settings writers stamp too", async () => {
    const db = await copiedShape();
    const sql = makePgliteSql(db);
    const store = makeStore(sql, A);
    const row = await insertTask(store, { title: "overdue", notes: "", status: "planned" });
    await db.query(`UPDATE tasks SET do_date = '2020-01-02', field_ts = '{"do_date":"2020-01-01T00:00:00Z"}' WHERE id = $1`, [row!.id]);
    const res = await runCronJob("rollover", { CUTOVER_FLIPPED: "1" }, sql);
    expect(res.status).toBe(200);
    const ts = await stamps(db, "tasks", `id = '${row!.id}'`);
    expect(new Date(ts.do_date!).getFullYear()).toBeGreaterThan(2020);
    expect(ts.roll_count).toBeTruthy();

    await rotateInboundToken(store);
    expect((await stamps(db, "user_settings", `user_id = '${A}'`)).inbound_token).toBeTruthy();

    await updateProject(store, (await db.query<{ id: string }>(`SELECT id FROM projects WHERE user_id = '${A}' LIMIT 1`)).rows[0]!.id, { name: "renamed" });
    const p = await db.query<{ field_ts: Record<string, string> }>(`SELECT field_ts FROM projects WHERE user_id = '${A}' AND name = 'renamed'`);
    expect(p.rows[0]!.field_ts.name).toBeTruthy();
  });

  it("the copy installs it after restore and dies if a table is left bare", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/cutover-migrate.yml"), "utf8");
    const restore = wf.indexOf('restore_bin,\n                      "--no-owner"');
    const install = wf.indexOf('"-f", str(field_ts)');
    expect(restore).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(restore);
    expect(wf.slice(install, install + 400)).toMatch(/FIELD_TS_TRIGGERS_MISSING_SQL[\s\S]*die\(/);
    expect(readFileSync(join(ROOT, "scripts/apply-neon-schema.mjs"), "utf8")).toContain("field-ts.sql");
  });
});
