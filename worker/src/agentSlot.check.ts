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

// ── add_to_slot / reschedule_slot / update_slot / caps / malformed ids ──────
// The port read `id` / `task_id` / do_date / start_time where toolDefs send
// slot_id (or slot_title + date), task_ids[], tasks[] and start_local, so
// add_to_slot linked nothing it was asked to, reschedule_slot could never move
// a block, a malformed slot_id threw a Postgres uuid error, and an int4-sized
// length was a 500.
const slotCountOf = async (id: string) => Number((await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM tasks WHERE slot_id = $1`, [id])).rows[0].c);
out = await run("create_slot", { title: "Hold block", start_local: "2026-11-24T10:00", duration_minutes: 60 });
const holdId = String(out.id);

// add_to_slot by slot_id with task_ids[] and tasks[].
const c1 = await task(ME, "Add me one", "planned");
const c2 = await task(ME, "Add me two");
out = await run("add_to_slot", { slot_id: holdId, task_ids: [c1, c2], tasks: [{ title: "Brand new piece", duration_minutes: 20 }] });
ok(Array.isArray(out.added) && (out.added as unknown[]).length === 3, `add_to_slot {slot_id, task_ids, tasks} places all three (got ${JSON.stringify(out).slice(0, 120)})`);
for (const id of [c1, c2]) {
  const t = await trow(id);
  ok(t.slot_id === holdId && t.start_time === null && t.do_date === "2026-11-24" && t.status === "planned", `"${t.title}" moved into the block, untimed`);
}
ok((await slotCountOf(holdId)) === 3, "three tasks now sit in the block");
// By title (+ date).
const c3 = await task(ME, "Add by title");
out = await run("add_to_slot", { slot_title: "hold block", date: "2026-11-24", task_ids: [c3] });
ok(out.id === holdId && (await trow(c3)).slot_id === holdId, "add_to_slot resolves slot_title + date");
// The port's single task_id still works.
const c4 = await task(ME, "Legacy single");
out = await run("add_to_slot", { slot_id: holdId, task_id: c4 });
ok((await trow(c4)).slot_id === holdId, "the older single task_id is still honoured");
// Refusals: foreign task, foreign slot, nothing to add, malformed slot id, bad piece length — none write.
const theirs2 = await task(OTHER, "Their other task");
const before2 = await slotCountOf(holdId);
ok((await executeOwnedTool(me, "add_to_slot", { slot_id: holdId, task_ids: [theirs2] })) === NOT_FOUND, "add_to_slot: another owner's task reads as missing");
ok((await trow(theirs2)).slot_id === null, "…and is untouched");
const theirSlot2 = uid();
await db.query(`INSERT INTO slots (id, user_id, title, do_date, start_time, duration_minutes) VALUES ($1, $2, 'Their block', '2026-11-24', '2026-11-24T18:00:00Z', 30)`, [theirSlot2, OTHER]);
const c5 = await task(ME, "Not into theirs");
ok((await executeOwnedTool(me, "add_to_slot", { slot_id: theirSlot2, task_ids: [c5] })) === NOT_FOUND && (await trow(c5)).slot_id === null, "add_to_slot: another owner's slot reads as missing");
out = await run("add_to_slot", { slot_id: holdId });
ok(typeof out.error === "string" && /Nothing to add/.test(String(out.error)), "add_to_slot with nothing is a clear error");
ok((await executeOwnedTool(me, "add_to_slot", { slot_id: "not-a-uuid", task_ids: [c5] })) === NOT_FOUND, "add_to_slot: a malformed slot_id is missing, not a throw");
out = await run("add_to_slot", { slot_id: holdId, tasks: [{ title: "Huge", duration_minutes: 1e12 }] });
ok(typeof out.error === "string" && /1440/.test(String(out.error)), "add_to_slot: a piece over a day is a clean error");
ok((await slotCountOf(holdId)) === before2, "no add_to_slot refusal wrote anything");

// reschedule_slot: start_local in the caller's zone moves the block; children's day travels.
out = await run("reschedule_slot", { slot_id: holdId, start_local: "2026-11-25T14:30" });
s = await slot(holdId);
ok(s?.start_time === "2026-11-25T22:30Z" && s?.do_date === "2026-11-25", `reschedule_slot moves the block to 2:30pm LA on the 25th (got ${s?.start_time} ${s?.do_date})`);
ok(s?.duration_minutes === 60, "…keeping its length");
ok((await trow(c1)).do_date === "2026-11-25" && (await trow(c4)).do_date === "2026-11-25", "…and its tasks move to the new day");
out = await run("reschedule_slot", { slot_id: holdId, start_local: "2026-11-25T09:00" }, "America/New_York");
ok((await slot(holdId))?.start_time === "2026-11-25T14:00Z", "the caller's zone reads the wall time");
out = await run("reschedule_slot", { slot_id: holdId, duration_minutes: 90 });
s = await slot(holdId);
ok(s?.duration_minutes === 90 && s?.start_time === "2026-11-25T14:00Z", "duration only resizes, start untouched");
out = await run("reschedule_slot", { slot_title: "Hold block", start_local: "2026-11-25T16:00", duration_minutes: 45 });
s = await slot(holdId);
ok(s?.start_time === "2026-11-26T00:00Z" && s?.do_date === "2026-11-25" && s?.duration_minutes === 45, "reschedule by slot_title: 4pm LA stays on the 25th");
// The port's `id` spelling still resolves.
out = await run("reschedule_slot", { id: holdId, start_local: "2026-11-25T08:00" });
ok((await slot(holdId))?.start_time === "2026-11-25T16:00Z", "the older `id` still moves the block");
// A repeating occurrence moved on its own is pinned.
const recSlot = uid();
const recId = uid();
await db.query(`INSERT INTO recurrences (id, user_id, kind, freq, anchor_date, title, duration_minutes) VALUES ($1, $2, 'slot', 'weekly', '2026-11-26', 'Weekly', 60)`, [recId, ME]);
{
  await db.query(`INSERT INTO slots (id, user_id, title, do_date, start_time, duration_minutes, recurrence_id, recurrence_date) VALUES ($1, $2, 'Weekly', '2026-11-26', '2026-11-26T17:00:00Z', 60, $3, '2026-11-26')`, [recSlot, ME, recId]);
  await run("reschedule_slot", { slot_id: recSlot, start_local: "2026-11-26T11:00" });
  const pinned = (await db.query<{ o: boolean }>(`SELECT recurrence_overridden AS o FROM slots WHERE id = $1`, [recSlot])).rows[0];
  ok(pinned?.o === true, "moving one occurrence of a repeating block pins it");
}
// Refusals write nothing.
const snap = JSON.stringify(await slot(holdId));
out = await run("reschedule_slot", { slot_id: holdId, duration_minutes: 1441 });
ok(typeof out.error === "string" && /1440/.test(String(out.error)), "reschedule_slot: 1441 minutes is a clean error");
out = await run("reschedule_slot", { slot_id: holdId, duration_minutes: 1e12 });
ok(typeof out.error === "string" && /1440/.test(String(out.error)), "reschedule_slot: an int4-overflow length is a clean error, not a 500");
out = await run("reschedule_slot", { slot_id: holdId, start_local: "2026-02-30T09:00" });
ok(typeof out.error === "string" && /start_local/.test(String(out.error)), "reschedule_slot: an impossible day is refused");
out = await run("reschedule_slot", { slot_id: holdId });
ok(typeof out.error === "string" && /Nothing to change/.test(String(out.error)), "reschedule_slot with nothing is a clear error");
ok((await executeOwnedTool(me, "reschedule_slot", { slot_id: "nope", start_local: "2026-11-25T09:00" })) === NOT_FOUND, "reschedule_slot: a malformed slot_id is missing, not a throw");
ok((await executeOwnedTool(me, "reschedule_slot", { slot_id: theirSlot2, start_local: "2026-11-25T09:00" })) === NOT_FOUND, "reschedule_slot: another owner's slot reads as missing");
ok((await slot(theirSlot2))?.start_time === "2026-11-24T18:00Z", "…and stays where it was");
ok(JSON.stringify(await slot(holdId)) === snap, "no reschedule refusal moved the block");

// update_slot (Worker alias): fields and time, ownership checked first.
out = await run("update_slot", { slot_id: holdId, title: "Renamed hold", project_id: PROJECT });
s = await slot(holdId);
ok(s?.title === "Renamed hold" && s?.project_id === PROJECT, "update_slot {slot_id} writes title and project");
out = await run("update_slot", { slot_id: holdId, start_local: "2026-11-27T07:15", duration_minutes: 30 });
s = await slot(holdId);
ok(s?.start_time === "2026-11-27T15:15Z" && s?.do_date === "2026-11-27" && s?.duration_minutes === 30, "update_slot moves the block too");
const snap2 = JSON.stringify(await slot(holdId));
ok((await executeOwnedTool(me, "update_slot", { slot_id: holdId, project_id: OTHER_PROJECT, start_local: "2026-11-28T09:00" })) === NOT_FOUND, "update_slot: another owner's project is refused");
ok(JSON.stringify(await slot(holdId)) === snap2, "…before the time was written");
out = await run("update_slot", { slot_id: holdId, duration_minutes: 5000 });
ok(typeof out.error === "string" && /1440/.test(String(out.error)), "update_slot: over a day is a clean error");
ok((await executeOwnedTool(me, "update_slot", { slot_id: "x", title: "y" })) === NOT_FOUND, "update_slot: a malformed slot_id is missing, not a throw");

// create_slot: the cap too.
before = await slotCount();
out = await run("create_slot", { title: "Too long", start_local: "2026-11-20T09:00", duration_minutes: 1e12 });
ok(typeof out.error === "string" && /1440/.test(String(out.error)), "create_slot: an int4-overflow length is a clean error, not a 500");
out = await run("create_slot", { title: "Exactly a day", start_local: "2026-11-29T00:00", duration_minutes: 1440 });
ok(typeof out.id === "string", "create_slot: exactly 1440 is allowed");
out = await run("create_slot", { title: "Big piece", start_local: "2026-11-29T00:00", tasks: [{ title: "x", duration_minutes: 99999 }] });
ok(typeof out.error === "string" && /1440/.test(String(out.error)), "create_slot: a piece over a day is a clean error");
ok((await slotCount()) === before + 1, "only the valid create wrote a slot");

// delete_slot: malformed id and a title.
ok((await executeOwnedTool(me, "delete_slot", { slot_id: "not-a-uuid" })) === NOT_FOUND, "delete_slot: a malformed slot_id is missing, not a throw");
out = await run("delete_slot", { slot_title: "Renamed hold", date: "2026-11-27" });
ok(out.deleted === 1 && (await slot(holdId)) === undefined, "delete_slot resolves slot_title + date");
ok((await trow(c1)).slot_id === null, "…its tasks stay, un-blocked");

if (fails.length) {
  console.error(`agentSlot.check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`agentSlot.check: ${checks} checks passed`);
