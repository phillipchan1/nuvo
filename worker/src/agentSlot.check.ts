// create_slot / delete_slot on the Worker — the real executor against Postgres
// (PGlite over neon.sql).
//
// The port's create_slot read `do_date` / `start_time`, but the tool definition
// (and every MCP caller) sends `start_local`. insertOwned refused the row, so
// MCP create_slot answered {"error":"not found"} every time — with or without
// project_id, tasks or task_ids. delete_slot read `id` where toolDefs say
// `slot_id`. This pins the toolDefs.ts contract.
// Run: node --experimental-strip-types worker/src/agentSlot.check.ts

import { PGlite } from "@electric-sql/pglite";
import { handleMcpMethod, mcpToolsFromDefs } from "../../supabase/functions/_shared/mcp.ts";
import { executeOwnedTool } from "./agentExec.ts";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { makeStore } from "./store.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const LA = "America/Los_Angeles";
const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);

const ME = "00000000-0000-4000-8000-00000000d0a1";
const OTHER = "00000000-0000-4000-8000-00000000d0b2";
await db.query(`INSERT INTO users (id, email) VALUES ($1, 'slot-me@example.test'), ($2, 'slot-other@example.test')`, [ME, OTHER]);

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const DOMAIN = uid();
const PROJECT = uid();
const OTHER_PROJECT = uid();
await db.query(`INSERT INTO domains (id, user_id, name, color) VALUES ($1, $2, 'Work', '#222222')`, [DOMAIN, ME]);
await db.query(`INSERT INTO projects (id, user_id, name, domain_id) VALUES ($1, $2, 'Launch', $3)`, [PROJECT, ME, DOMAIN]);
await db.query(`INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'Not yours')`, [OTHER_PROJECT, OTHER]);

async function task(user: string, title: string, status = "inbox"): Promise<string> {
  const id = uid();
  await db.query(`INSERT INTO tasks (id, user_id, title, status, do_date, start_time, duration_minutes) VALUES ($1, $2, $3, $4, $5, $6, 45)`, [
    id, user, title, status, status === "planned" ? "2026-11-20" : null, status === "planned" ? "2026-11-20T20:00:00Z" : null,
  ]);
  return id;
}

interface SlotRow { title: string; do_date: string; start_time: string; duration_minutes: number; project_id: string | null; user_id: string }
async function slot(id: string): Promise<SlotRow | undefined> {
  const r = await db.query<SlotRow>(
    `SELECT title, do_date::text, to_char(start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') AS start_time,
            duration_minutes, project_id::text, user_id::text FROM slots WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}
interface TaskRow { title: string; status: string; do_date: string | null; start_time: string | null; slot_id: string | null; duration_minutes: number | null }
async function trow(id: string): Promise<TaskRow> {
  const r = await db.query<TaskRow>(
    `SELECT title, status::text, do_date::text, start_time::text, slot_id::text, duration_minutes FROM tasks WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}
const slotCount = async () => Number((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM slots`)).rows[0].c);

const me = makeStore(sql, ME);
const run = async (name: string, args: Record<string, unknown>, tz = LA) =>
  JSON.parse(await executeOwnedTool(me, name, args, tz)) as Record<string, unknown>;
const NOT_FOUND = JSON.stringify({ error: "not found" });

// Friday's exact call: title + start_local + duration_minutes.
let out = await run("create_slot", { title: "Morning push", start_local: "2026-11-20T09:35", duration_minutes: 85 });
ok(typeof out.id === "string", `create_slot {title,start_local,duration_minutes} creates a slot (got ${JSON.stringify(out)})`);
let s = await slot(String(out.id));
ok(s?.start_time === "2026-11-20T17:35Z", `9:35 LA is 17:35Z (got ${s?.start_time})`);
ok(s?.do_date === "2026-11-20" && s?.duration_minutes === 85 && s?.title === "Morning push", "day, length and title written");
ok(s?.user_id === ME, "the slot is the caller's");

// With project_id.
out = await run("create_slot", { title: "Launch work", start_local: "2026-11-20T13:00", duration_minutes: 60, project_id: PROJECT });
s = await slot(String(out.id));
ok(s?.project_id === PROJECT, "project_id is written");

// With new tasks: placed inside, planned for the block's day, no own time; length sized when unstated.
out = await run("create_slot", { title: "Ship & fix", start_local: "2026-11-21T23:30", tasks: [{ title: "Update docs" }, { title: "Deploy", duration_minutes: 15 }, "Fix subdomains"] });
const shipId = String(out.id);
s = await slot(shipId);
ok(s?.duration_minutes === 90, `three unstated pieces size the block to 90m (got ${s?.duration_minutes})`);
ok(s?.do_date === "2026-11-21" && s?.start_time === "2026-11-22T07:30Z", "11:30pm LA stays on the local day");
const kids = out.tasks as { id: string; title: string }[];
ok(Array.isArray(kids) && kids.length === 3, "three tasks placed inside");
for (const k of kids ?? []) {
  const t = await trow(k.id);
  ok(t.slot_id === shipId && t.status === "planned" && t.do_date === "2026-11-21" && t.start_time === null, `"${t.title}" sits inside the block`);
}
ok((await trow(kids[1].id)).duration_minutes === 15 && (await trow(kids[0].id)).duration_minutes === 30, "piece lengths: stated, else 30m");

// With existing task_ids: moved in, own time cleared.
const a = await task(ME, "Existing A", "planned");
const b = await task(ME, "Existing B");
out = await run("create_slot", { title: "Existing work", start_local: "2026-11-20T09:35", duration_minutes: 85, task_ids: [a, b], project_id: PROJECT });
const exId = String(out.id);
ok(typeof out.id === "string" && (out.tasks as unknown[]).length === 2, "task_ids move into the new block");
for (const id of [a, b]) {
  const t = await trow(id);
  ok(t.slot_id === exId && t.start_time === null && t.status === "planned" && t.do_date === "2026-11-20", `"${t.title}" moved in, untimed`);
}

// Refusals write nothing.
let before = await slotCount();
const theirs = await task(OTHER, "Their task");
ok((await executeOwnedTool(me, "create_slot", { title: "X", start_local: "2026-11-20T09:00", task_ids: [theirs] })) === NOT_FOUND, "another owner's task id reads as missing");
ok((await trow(theirs)).slot_id === null, "…and is untouched");
ok((await executeOwnedTool(me, "create_slot", { title: "X", start_local: "2026-11-20T09:00", project_id: OTHER_PROJECT })) === NOT_FOUND, "another owner's project reads as missing");
out = await run("create_slot", { title: "X" });
ok(typeof out.error === "string" && /start_local/.test(String(out.error)), "missing start_local is a clear error, not 'not found'");
out = await run("create_slot", { title: "  ", start_local: "2026-11-20T09:00" });
ok(typeof out.error === "string" && /title/.test(String(out.error)), "missing title is a clear error");
out = await run("create_slot", { title: "X", start_local: "2026-11-20T09:00", duration_minutes: 0 });
ok(typeof out.error === "string", "a zero length is refused");
ok((await slotCount()) === before, "no refusal wrote a slot");

// delete_slot by slot_id (toolDefs) — tasks inside fall back onto the day.
ok((await executeOwnedTool(me, "delete_slot", { slot_id: exId })) === JSON.stringify({ deleted: 1 }), "delete_slot {slot_id} deletes");
ok((await slot(exId)) === undefined, "…the slot is gone");
ok((await trow(a)).slot_id === null && (await trow(a)).status === "planned", "…its tasks stay, un-blocked");
ok((await executeOwnedTool(me, "delete_slot", { id: shipId })) === JSON.stringify({ deleted: 1 }), "the older `id` spelling still deletes");
const theirSlot = uid();
await db.query(`INSERT INTO slots (id, user_id, title, do_date, start_time, duration_minutes) VALUES ($1, $2, 'Theirs', '2026-11-20', '2026-11-20T17:00:00Z', 30)`, [theirSlot, OTHER]);
ok((await executeOwnedTool(me, "delete_slot", { slot_id: theirSlot })) === NOT_FOUND && (await slot(theirSlot)) !== undefined, "another owner's slot reads as missing and stays");

// Through the MCP JSON-RPC door, the call Friday saw fail.
before = await slotCount();
const reply = await handleMcpMethod(
  { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_slot", arguments: { title: "MCP slot", start_local: "2026-11-20T09:35", duration_minutes: 85, project_id: PROJECT, tasks: [{ title: "Inside" }] } } },
  mcpToolsFromDefs(),
  (name, args) => executeOwnedTool(me, name, args, LA),
);
const text = (reply as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text ?? "";
ok(!/not found/.test(text) && typeof JSON.parse(text).id === "string", `MCP tools/call create_slot answers with the slot (got ${text.slice(0, 80)})`);
ok((await slotCount()) === before + 1, "…and wrote exactly one slot");

if (fails.length) {
  console.error(`agentSlot.check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`agentSlot.check: ${checks} checks passed`);
