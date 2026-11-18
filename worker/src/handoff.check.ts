// Hand-off (D-250) on the Worker — the real SQL against Postgres (PGlite over
// neon.sql), the real MCP dispatch, and a fake doorbell.
//
// What it pins: an agent sees only what was handed to ITS token; the operator's
// other agents and other accounts see nothing; done completes the task and
// keeps who did it; back returns it; the doorbell never carries the task; a
// step, a closed task, a token without the switch and someone else's task
// can't be handed.
// Run: node --experimental-strip-types worker/src/handoff.check.ts

import { PGlite } from "@electric-sql/pglite";
import { handleMcpMethod } from "../../supabase/functions/_shared/mcp.ts";
import { HANDOFF_TOOLS, buildHandoffBrief, doorbellBody, validDoorbellUrl } from "../../supabase/functions/_shared/handoff.ts";
import type { Env } from "./env.ts";
import {
  getAgent,
  getHandoffBrief,
  handTask,
  HandoffError,
  listHandoffsFor,
  recallTask,
  reportHandoff,
  setDoorbell,
} from "./handoff.ts";
import { applyIsolationSchema } from "./isolationDb.ts";
import { installDnsLookupForTests } from "./lib/ssrf.ts";
import { installOutboundFetchForTests } from "./lib/outboundFetch.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { makeStore } from "./store.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}
async function throws(p: Promise<unknown>, msg: string) {
  try {
    await p;
    ok(false, msg);
  } catch (e) {
    ok(e instanceof HandoffError, `${msg} (threw ${String(e)})`);
  }
}

// ── Pure ─────────────────────────────────────────────────────────────────────
ok(HANDOFF_TOOLS.map((t) => t.name).join() === "list_handoffs,get_handoff,report_handoff", "three agent tools");
const bell = JSON.stringify(doorbellBody(2));
ok(bell.includes("2 tasks") && bell.includes("list_handoffs"), "the doorbell says there is work and where");
ok(validDoorbellUrl("http://example.com/x") === null, "a doorbell must be https");
ok(validDoorbellUrl("https://api2.cursor.sh/automations/webhook/abc") !== null, "a Grok Bot routine URL is a doorbell");

// ── Postgres ─────────────────────────────────────────────────────────────────
const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);
const env = { TOKEN_ENC_KEY_V1: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))), APP_URL: "https://app.example.test" } as unknown as Env;

const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
await db.query(`INSERT INTO users (id, email) VALUES ($1, 'h-me@example.test'), ($2, 'h-other@example.test')`, [ME, OTHER]);
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const GROK = uid();
const CURSOR = uid();
const INBOX_TOKEN = uid();
const OTHERS_AGENT = uid();
const conn = (id: string, user: string, name: string, scopes: string, takes: boolean) =>
  db.query(
    `INSERT INTO connections (id, user_id, app, name, scopes, token_hash, takes_handoffs) VALUES ($1, $2, $3, $3, $4::text[], $5, $6)`,
    [id, user, name, scopes, `hash-${id}`, takes],
  );
await conn(GROK, ME, "Grok Bot", "{account}", true);
await conn(CURSOR, ME, "Cursor", "{account}", true);
await conn(INBOX_TOKEN, ME, "Watch", "{inbox:write}", true);
await conn(OTHERS_AGENT, OTHER, "Their bot", "{account}", true);
const QUIET = uid();
await conn(QUIET, ME, "Quiet", "{account}", false);

const DOMAIN = uid();
const PROJECT = uid();
await db.query(`INSERT INTO domains (id, user_id, name, color) VALUES ($1, $2, 'Work', '#222222')`, [DOMAIN, ME]);
await db.query(`INSERT INTO projects (id, user_id, name, domain_id, outcome) VALUES ($1, $2, 'Q3 report', $3, 'Board has the deck')`, [PROJECT, ME, DOMAIN]);
const task = async (title: string, extra: Record<string, unknown> = {}, user = ME) => {
  const id = uid();
  const cols = ["id", "user_id", "title", ...Object.keys(extra)];
  const vals = [id, user, title, ...Object.values(extra)];
  await db.query(`INSERT INTO tasks (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals);
  return id;
};
const T1 = await task("Draft the board summary", {
  project_id: PROJECT, do_date: "2026-11-18", start_time: "2026-11-18T17:00:00Z", duration_minutes: 60, notes: "Use last quarter's format",
});
const STEP = await task("Pull the numbers", { parent_task_id: T1 });
await task("Book the room", { project_id: PROJECT });
const DONE = await task("Already done", { status: "done", completed_at: "2026-11-01T00:00:00Z" });
const THEIRS = await task("Their task", {}, OTHER);

const me = makeStore(sql, ME);
const other = makeStore(sql, OTHER);

// Doorbell: fake network, fake DNS.
const rang: { url: string; auth: string | null; body: string }[] = [];
installDnsLookupForTests(async () => ["93.184.216.34"]);
installOutboundFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
  rang.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization"), body: String(init?.body ?? "") });
  return new Response("{}", { status: 200 });
}) as typeof fetch);
const saved = await setDoorbell(me, env, GROK, "https://api2.cursor.sh/automations/webhook/r1", "crsr_secret");
ok(saved.has_key && saved.doorbell_url?.includes("/r1") === true, "doorbell saved with a key");
const keyRow = (await db.query<{ doorbell_key_enc: Uint8Array | null }>(`SELECT doorbell_key_enc FROM connections WHERE id = $1`, [GROK])).rows[0];
ok(keyRow?.doorbell_key_enc != null && !new TextDecoder().decode(keyRow.doorbell_key_enc).includes("crsr_secret"), "the key is sealed at rest");
await throws(setDoorbell(me, env, GROK, "http://insecure.example", "k"), "an http doorbell is refused");

// Hand.
const handed = await handTask(me, env, T1, GROK, "  use the Q3 numbers  ");
ok(handed.task.handed_to === GROK, "the task is with Grok Bot");
ok(handed.task.start_time === null && handed.task.do_date != null, "the clock comes off, the day stays");
ok(handed.rang && rang.length === 1, "the doorbell rang once");
ok(rang[0]?.auth === "Bearer crsr_secret", "the doorbell carries its key as a bearer");
ok(!rang[0]?.body.includes("board summary") && !rang[0]?.body.includes("Q3"), "the doorbell never carries the task or the note");

await throws(handTask(me, env, STEP, GROK, ""), "a step can't be handed");
await throws(handTask(me, env, DONE, GROK, ""), "a done task can't be handed");
await throws(handTask(me, env, T1, INBOX_TOKEN, ""), "an Inbox token isn't an agent");
await throws(handTask(me, env, T1, QUIET, ""), "a token without the switch isn't offered");
await throws(handTask(me, env, THEIRS, GROK, ""), "someone else's task can't be handed");
await throws(handTask(other, env, T1, OTHERS_AGENT, ""), "an account can't hand my task to its agent");
await throws(handTask(me, env, T1, OTHERS_AGENT, ""), "I can't hand to someone else's agent");

// The agent's side.
const grok = { id: GROK, name: "Grok Bot" };
const cursor = { id: CURSOR, name: "Cursor" };
const list = JSON.parse(await listHandoffsFor(me, env, GROK));
ok(list.handoffs.length === 1 && list.handoffs[0].task_id === T1, "Grok Bot sees its one hand-off");
ok(list.handoffs[0].note_from_operator === "use the Q3 numbers", "the note is trimmed and carried");
ok(JSON.parse(await listHandoffsFor(me, env, CURSOR)).handoffs.length === 0, "Cursor sees nothing handed to Grok Bot");
ok(JSON.parse(await listHandoffsFor(other, env, OTHERS_AGENT)).handoffs.length === 0, "another account's agent sees nothing");

const brief = JSON.parse(await getHandoffBrief(me, env, grok, T1));
ok(brief.task.title === "Draft the board summary" && brief.task.notes === "Use last quarter's format", "the brief carries the task");
ok(brief.task.steps.length === 1 && brief.task.steps[0].title === "Pull the numbers", "the brief carries its steps");
ok(brief.project?.done_means === "Board has the deck" && brief.project.other_open_work.includes("Book the room"), "the brief carries the project");
ok(brief.domain === "Work", "the brief carries the domain");
ok(brief.task.link === `https://app.example.test/?task=${T1}`, "the brief links back");
ok((await getHandoffBrief(me, env, cursor, T1)).startsWith("That task isn't handed to you"), "another agent can't read the brief");

// Back, then done.
ok((await reportHandoff(me, cursor, { task_id: T1, outcome: "done", note: "x" })).startsWith("That task isn't"), "another agent can't answer it");
await reportHandoff(me, grok, { task_id: T1, outcome: "back", note: "Need the login for the finance tool" });
let row = (await db.query<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = $1`, [T1])).rows[0]!;
ok(row.handed_to === null && row.status !== "done", "back returns the task, open");
const brief2 = await handTask(me, env, T1, GROK, "login is in 1Password");
ok(brief2.task.handed_to === GROK, "handed again");
const again = JSON.parse(await getHandoffBrief(me, env, grok, T1));
ok(again.earlier_handoffs[0]?.agent_note === "Need the login for the finance tool", "the brief says why it came back last time");
await reportHandoff(me, grok, { task_id: T1, outcome: "done", note: "Drafted in the shared doc" });
row = (await db.query<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = $1`, [T1])).rows[0]!;
ok(row.status === "done" && row.completed_at != null && row.handed_to === GROK, "done completes it and keeps who did it");
ok(JSON.parse(await listHandoffsFor(me, env, GROK)).handoffs.length === 0, "nothing left open");
ok((await reportHandoff(me, grok, { task_id: T1, outcome: "done", note: "again" })).startsWith("That task isn't"), "an answered hand-off can't be answered twice");

// Recall.
const T2 = await task("Find a venue");
await handTask(me, env, T2, CURSOR, "");
await recallTask(me, T2);
row = (await db.query<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = $1`, [T2])).rows[0]!;
ok(row.handed_to === null, "take back clears who has it");
ok(JSON.parse(await listHandoffsFor(me, env, CURSOR)).handoffs.length === 0, "a taken-back task leaves the agent's list");
await throws(recallTask(other, T2), "another account can't take back my task");

// MCP dispatch lists the tools for a token.
const agentRow = await getAgent(me, GROK);
ok(agentRow?.takes_handoffs === true && agentRow.name === "Grok Bot", "the token is the agent");
const reply = await handleMcpMethod({ jsonrpc: "2.0", id: 1, method: "tools/list" }, [...HANDOFF_TOOLS], async () => "");
ok(JSON.stringify(reply).includes("report_handoff"), "tools/list carries the hand-off tools");

// Pure brief, empty inputs.
const bare = buildHandoffBrief({ task: { id: "t", title: "" }, handoff: {}, agentName: "X", steps: [], project: null, projectTasks: [], domain: null, history: [], link: null });
ok(bare.task.title === "(untitled)" && bare.project === null && bare.note_from_operator === null, "an empty brief still reads");

if (fails.length) {
  console.error(`handoff.check: ${fails.length}/${checks} failed\n - ${fails.join("\n - ")}`);
  process.exit(1);
}
console.log(`handoff.check: ${checks} checks passed`);
