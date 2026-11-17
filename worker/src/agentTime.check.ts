// The agent's time-placing tools on the Worker — runs the real executor against
// Postgres (PGlite over neon.sql).
//
// The port to the Worker read `args.id` where the tool definitions say
// `task_id` / `task_title`, and wrote no time columns at all: MCP
// `schedule_task {task_id, start_time}` answered "not found", and
// `create_task {title, start_time}` made an untimed inbox task. So nothing the
// agent did (MCP, Shortcuts) could put a task on the calendar. This pins the
// contract toolDefs.ts states: a task named by id or title, a local
// "YYYY-MM-DDTHH:MM" read in the caller's zone (America/Los_Angeles unless
// told), and start_time + do_date + duration_minutes written together.
// Run: node --experimental-strip-types worker/src/agentTime.check.ts

import { PGlite } from "@electric-sql/pglite";
import { handleMcpMethod, mcpToolsFromDefs } from "../../supabase/functions/_shared/mcp.ts";
import { startInstant } from "../../supabase/functions/_shared/dayShape.ts";
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

// ── The conversion, pure ─────────────────────────────────────────────────────
const LA = "America/Los_Angeles";
ok(startInstant("2026-11-18T09:00", LA) === "2026-11-18T17:00:00.000Z", "9am LA in November is 17:00Z (PST)");
ok(startInstant("2026-07-01T09:00", LA) === "2026-07-01T16:00:00.000Z", "9am LA in July is 16:00Z (PDT)");
ok(startInstant("2026-11-18T09:00:00", LA) === "2026-11-18T17:00:00.000Z", "seconds are tolerated");
ok(startInstant("2026-11-18T09:00", "America/New_York") === "2026-11-18T14:00:00.000Z", "the caller's zone, not a constant");
ok(startInstant("2026-11-18T23:30", LA) === "2026-11-19T07:30:00.000Z", "late evening crosses UTC midnight");
ok(startInstant("2026-11-18T17:00:00Z", LA) === "2026-11-18T17:00:00.000Z", "an absolute Z instant passes through");
ok(startInstant("2026-11-18T09:00-08:00", LA) === "2026-11-18T17:00:00.000Z", "a negative offset is absolute, not local");
ok(startInstant("2026-11-18T18:00+01:00", LA) === "2026-11-18T17:00:00.000Z", "a positive offset is absolute");
ok(startInstant("2026-02-30T09:00", LA) === null, "Feb 30 is not quietly March 2");
ok(startInstant("2026-13-01T09:00", LA) === null, "month 13 is unreadable");
ok(startInstant("tomorrow 9am", LA) === null, "free text is not a time");
ok(startInstant(undefined, LA) === null, "missing is null");

// ── The tools, against Postgres ──────────────────────────────────────────────
const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);

const ME = "00000000-0000-4000-8000-00000000c0a1";
const OTHER = "00000000-0000-4000-8000-00000000c0b2";
await db.query(`INSERT INTO users (id, email) VALUES ($1, 'time-me@example.test'), ($2, 'time-other@example.test')`, [ME, OTHER]);

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const DOMAIN = uid();
const INITIATIVE = uid();
const PROJECT = uid();
const OTHER_PROJECT = uid();
await db.query(`INSERT INTO domains (id, user_id, name, color) VALUES ($1, $2, 'Work', '#222222')`, [DOMAIN, ME]);
await db.query(`INSERT INTO initiatives (id, user_id, domain_id, name) VALUES ($1, $2, $3, 'Ship it')`, [INITIATIVE, ME, DOMAIN]);
await db.query(`INSERT INTO projects (id, user_id, name, domain_id, initiative_id) VALUES ($1, $2, 'Launch', $3, $4)`, [PROJECT, ME, DOMAIN, INITIATIVE]);
await db.query(`INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'Not yours')`, [OTHER_PROJECT, OTHER]);

async function task(user: string, title: string, status = "inbox", extra: { duration?: number } = {}): Promise<string> {
  const id = uid();
  await db.query(`INSERT INTO tasks (id, user_id, title, status, duration_minutes) VALUES ($1, $2, $3, $4, $5)`, [
    id,
    user,
    title,
    status,
    extra.duration ?? null,
  ]);
  return id;
}

interface Placed {
  title: string;
  status: string;
  do_date: string | null;
  start_time: string | null;
  duration_minutes: number | null;
  completed_at: string | null;
  priority: string;
  project_id: string | null;
  initiative_id: string | null;
  domain_id: string | null;
}
async function row(id: string): Promise<Placed> {
  const r = await db.query<Placed>(
    `SELECT title, status::text, do_date::text,
            to_char(start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') AS start_time,
            duration_minutes, completed_at::text, priority::text, project_id::text, initiative_id::text, domain_id::text
     FROM tasks WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

const me = makeStore(sql, ME);
const run = async (name: string, args: Record<string, unknown>, tz?: string) =>
  JSON.parse(await executeOwnedTool(me, name, args, tz)) as Record<string, unknown>;

const brief = await task(ME, "Write the brief");
const david = await task(ME, "Call David");
const davidBack = await task(ME, "Call David back");
const long = await task(ME, "Deep work block", "backlog", { duration: 120 });
const finished = await task(ME, "Already done", "done");
const theirs = await task(OTHER, "Their secret task");

// schedule_task by task_id — the exact call that answered "not found".
let out = await run("schedule_task", { task_id: brief, start_time: "2026-11-18T09:00" });
let r = await row(brief);
ok(out.id === brief, "schedule_task by task_id returns the task, not 'not found'");
ok(r.start_time === "2026-11-18T17:00Z", `schedule_task writes start_time in UTC (got ${r.start_time})`);
ok(r.do_date === "2026-11-18", "schedule_task writes the local day as do_date");
ok(r.status === "planned", "a scheduled task is planned");
ok(r.duration_minutes === 30, "duration defaults to 30m");

// A late-evening block belongs to the LOCAL day, not the UTC one.
await run("schedule_task", { task_id: brief, start_time: "2026-11-18T23:30", duration_minutes: 60 });
r = await row(brief);
ok(r.start_time === "2026-11-19T07:30Z" && r.do_date === "2026-11-18", "11:30pm LA stays on the 18th");
ok(r.duration_minutes === 60, "an explicit duration is written");

// By title: exact (case-insensitive) beats substring; more than one is a question.
out = await run("schedule_task", { task_title: "call david", start_time: "2026-11-19T14:00", duration_minutes: 45 });
ok(out.id === david, "an exact title match wins over a longer one containing it");
ok((await row(david)).start_time === "2026-11-19T22:00Z", "scheduled by title at 2pm LA");
ok((await row(davidBack)).start_time === null, "the other David task is untouched");
out = await run("schedule_task", { task_title: "David", start_time: "2026-11-19T15:00" });
ok(typeof out.error === "string" && Array.isArray(out.candidates) && out.candidates.length === 2, "an ambiguous title asks back with candidates");
ok((await row(davidBack)).start_time === null, "…and writes nothing");
out = await run("schedule_task", { task_title: "No such thing", start_time: "2026-11-19T15:00" });
ok(typeof out.error === "string" && /No task matching/.test(String(out.error)), "an unknown title says so");
out = await run("schedule_task", { start_time: "2026-11-19T15:00" });
ok(out.error === "Provide task_id or task_title", "no task named is an error");

// The caller's zone (MCP's `timezone` arg / the app's tz) reads the wall time.
const travel = await task(ME, "Call from New York");
await run("schedule_task", { task_id: travel, start_time: "2026-11-18T09:00" }, "America/New_York");
ok((await row(travel)).start_time === "2026-11-18T14:00Z", "9am in New York is 14:00Z");
await run("schedule_task", { task_id: travel, start_time: "2026-11-18T09:00", timezone: "America/Chicago" });
ok((await row(travel)).start_time === "2026-11-18T15:00Z", "args.timezone is honoured when no tz is passed");

// reschedule_task moves the block and keeps a duration it wasn't told to change.
out = await run("reschedule_task", { task_title: "Call David", start_time: "2026-11-20T10:30" });
r = await row(david);
ok(out.id === david && r.start_time === "2026-11-20T18:30Z" && r.do_date === "2026-11-20", "reschedule_task moves the block");
ok(r.duration_minutes === 45, "reschedule keeps the duration it wasn't given");
await run("reschedule_task", { task_id: long, start_time: "2026-11-20T08:00" });
r = await row(long);
ok(r.status === "planned" && r.duration_minutes === 120, "rescheduling backlog work plans it at its own length");
await run("reschedule_task", { task_id: finished, start_time: "2026-11-17T08:00" });
ok((await row(finished)).status === "done", "rescheduling done work keeps it done");

// Bad input writes nothing.
const before = await row(david);
out = await run("schedule_task", { task_id: david, start_time: "next tuesday" });
ok(typeof out.error === "string", "an unreadable start_time is an error");
out = await run("schedule_task", { task_id: david, start_time: "2026-11-21T09:00", duration_minutes: -5 });
ok(typeof out.error === "string", "a negative duration is an error");
ok(JSON.stringify(await row(david)) === JSON.stringify(before), "…and neither wrote anything");

// unschedule keeps the day; plan_task sets a day with no time; move_to_inbox clears both.
await run("unschedule_task", { task_id: david });
r = await row(david);
ok(r.start_time === null && r.do_date === "2026-11-20" && r.status === "planned", "unschedule_task keeps it planned for its day");
await run("plan_task", { task_title: "Call David back", do_date: "2026-11-21" });
r = await row(davidBack);
ok(r.status === "planned" && r.do_date === "2026-11-21" && r.start_time === null, "plan_task by title plans a day");
out = await run("plan_task", { task_id: davidBack, do_date: "Friday" });
ok(typeof out.error === "string", "plan_task needs a real date");
await run("move_to_inbox", { task_id: brief });
r = await row(brief);
ok(r.status === "inbox" && r.do_date === null && r.start_time === null, "move_to_inbox clears date and time");
await run("complete_task", { task_title: "Write the brief" });
ok((await row(brief)).status === "done" && (await row(brief)).completed_at != null, "complete_task resolves by title");

// create_task with a time lands on the calendar, not in the inbox.
out = await run("create_task", { title: "Dentist", start_time: "2026-11-24T15:00" });
r = await row(String(out.id));
ok(r.status === "planned", `create_task with start_time is planned (got ${r.status})`);
ok(r.start_time === "2026-11-24T23:00Z" && r.do_date === "2026-11-24", "create_task writes start_time and its local day");
ok(r.duration_minutes === 30, "create_task defaults a timed task to 30m");
out = await run("create_task", { title: "Pay rent", do_date: "2026-12-01", priority: "high" });
r = await row(String(out.id));
ok(r.status === "planned" && r.do_date === "2026-12-01" && r.start_time === null && r.priority === "high", "create_task with do_date plans the day");
out = await run("create_task", { title: "Draft launch copy", project_id: PROJECT });
r = await row(String(out.id));
ok(r.status === "backlog" && r.domain_id === DOMAIN && r.initiative_id === INITIATIVE, "a project's task takes its chain and lands in backlog");
out = await run("create_task", { title: "Loose thought" });
ok((await row(String(out.id))).status === "inbox", "a bare capture is inbox");
out = await run("create_task", { title: "Bad time", start_time: "3pm" });
ok(typeof out.error === "string", "create_task refuses an unreadable start_time");

// update_task: its own attributes, by id or title, more than one at once.
out = await run("update_task", { task_id: davidBack, title: "Call David back re: contract", duration_minutes: 20, project_id: PROJECT });
r = await row(davidBack);
ok(r.title === "Call David back re: contract", "update_task writes the title");
ok(r.duration_minutes === 20, "…and the duration in the same call");
ok(r.project_id === PROJECT && r.domain_id === DOMAIN && r.initiative_id === INITIATIVE, "…and files it with the project's chain");
out = await run("update_task", { task_id: davidBack, duration_minutes: 0 });
ok(typeof out.error === "string" && (await row(davidBack)).duration_minutes === 20, "a zero duration is refused");

// Isolation: another owner's task or project is exactly a random id.
const random = "00000000-0000-4000-8000-ffffffffffff";
const theirsOut = await executeOwnedTool(me, "schedule_task", { task_id: theirs, start_time: "2026-11-18T09:00" });
const randomOut = await executeOwnedTool(me, "schedule_task", { task_id: random, start_time: "2026-11-18T09:00" });
ok(theirsOut === randomOut && theirsOut === JSON.stringify({ error: "not found" }), "another owner's task reads as missing");
ok((await row(theirs)).start_time === null && (await row(theirs)).status === "inbox", "…and is untouched");
ok((await executeOwnedTool(me, "schedule_task", { task_id: "not-a-uuid", start_time: "2026-11-18T09:00" })) === randomOut, "a non-uuid id is missing, not a 500");
out = await run("schedule_task", { task_title: "Their secret task", start_time: "2026-11-18T09:00" });
ok(typeof out.error === "string" && !("candidates" in out), "titles only search this owner's tasks");
ok((await executeOwnedTool(me, "create_task", { title: "Plant", project_id: OTHER_PROJECT })) === randomOut, "create_task can't file under another owner's project");
ok((await executeOwnedTool(me, "update_task", { task_id: davidBack, project_id: OTHER_PROJECT })) === randomOut, "update_task can't either");

// Through the MCP JSON-RPC door, the same call the session saw fail.
const mcpTask = await task(ME, "MCP placed");
const reply = await handleMcpMethod(
  {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "schedule_task", arguments: { task_id: mcpTask, start_time: "2026-11-25T11:00", duration_minutes: 50 } },
  },
  mcpToolsFromDefs(),
  (name, args) => executeOwnedTool(me, name, args, LA),
);
const text = (reply as { result?: { content?: { text?: string }[]; isError?: boolean } }).result?.content?.[0]?.text ?? "";
r = await row(mcpTask);
ok(!/not found/.test(text) && JSON.parse(text).id === mcpTask, "MCP tools/call schedule_task answers with the task");
ok(r.start_time === "2026-11-25T19:00Z" && r.do_date === "2026-11-25" && r.duration_minutes === 50, "…and placed it at 11am LA for 50m");

if (fails.length) {
  console.error(`agentTime.check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`agentTime.check: ${checks} checks passed`);
