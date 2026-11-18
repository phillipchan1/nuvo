/**
 * Hand-off (D-250, docs/handoff.md) — the Worker's SQL and network half.
 *
 * Every read and write is owner-scoped (`user_id = store.userId`), and every
 * agent-side read is also connection-scoped: an agent sees only what was
 * handed to ITS token. The pure half (tools, brief, doorbell body) is
 * `supabase/functions/_shared/handoff.ts`.
 */
import {
  AGENT_NOTE_MAX,
  buildHandoffBrief,
  cleanNote,
  doorbellBody,
  OWNER_NOTE_MAX,
  parseReportOutcome,
  validDoorbellUrl,
} from "../../supabase/functions/_shared/handoff.ts";
import type { Env } from "./env.ts";
import { assertPublicFeedUrl } from "./lib/ssrf.ts";
import { outboundFetch } from "./lib/outboundFetch.ts";
import { openToken, parseTokenKeyring, sealToken, type TokenAad, type TokenKeyring } from "./secrets.ts";
import type { Store } from "./store.ts";

type Row = Record<string, unknown>;

export const DOORBELL_TIMEOUT_MS = 5_000;

export class HandoffError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v: unknown, what: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HandoffError(`${what} must be an id`);
  return v;
}

// ── Agents ───────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  takes_handoffs: boolean;
  revoked_at: string | null;
  doorbell_url: string | null;
  doorbell_key_enc: Uint8Array | null;
  doorbell_key_iv: Uint8Array | null;
  doorbell_key_version: number | null;
}

export async function getAgent(store: Store, connectionId: string): Promise<Agent | null> {
  const rows = (await store.sql`
    SELECT id, name, takes_handoffs, revoked_at, doorbell_url,
           doorbell_key_enc, doorbell_key_iv, doorbell_key_version
    FROM connections
    WHERE id = ${connectionId}
      AND user_id = ${store.userId}
      AND 'account' = ANY (scopes)
    LIMIT 1
  `) as Agent[];
  return rows[0] ?? null;
}

function doorbellAad(connectionId: string, userId: string): TokenAad {
  return { table: "connections", rowId: connectionId, userId };
}

async function ring(env: Env): Promise<TokenKeyring> {
  return parseTokenKeyring({
    TOKEN_ENC_KEY_V1: env.TOKEN_ENC_KEY_V1,
    TOKEN_ENC_KEY_V2: env.TOKEN_ENC_KEY_V2,
    TOKEN_ENC_CURRENT: env.TOKEN_ENC_CURRENT,
  });
}

/** Set (or clear, with url null) an agent's doorbell. The key is sealed; a
 *  null key keeps the one already stored, "" clears it. */
export async function setDoorbell(
  store: Store,
  env: Env,
  connectionId: string,
  rawUrl: unknown,
  rawKey: unknown,
): Promise<{ doorbell_url: string | null; has_key: boolean }> {
  const agent = await getAgent(store, uuid(connectionId, "connection_id"));
  if (!agent || agent.revoked_at) throw new HandoffError("No such token", 404);

  let url: string | null = null;
  if (rawUrl != null && rawUrl !== "") {
    const valid = validDoorbellUrl(rawUrl);
    if (!valid) throw new HandoffError("The doorbell needs an https URL");
    const pub = await assertPublicFeedUrl(valid);
    if (!pub.ok) throw new HandoffError("That doorbell host isn't allowed");
    url = valid;
  }

  if (typeof rawKey === "string" && rawKey.trim()) {
    const sealed = await sealToken(rawKey.trim(), doorbellAad(agent.id, store.userId), await ring(env));
    await store.sql`
      UPDATE connections
      SET doorbell_url = ${url},
          doorbell_key_enc = ${sealed.ciphertext},
          doorbell_key_iv = ${sealed.iv},
          doorbell_key_version = ${sealed.keyVersion},
          updated_at = now()
      WHERE id = ${agent.id} AND user_id = ${store.userId}
    `;
    return { doorbell_url: url, has_key: true };
  }
  const clearKey = rawKey === "" || url == null;
  await store.sql`
    UPDATE connections
    SET doorbell_url = ${url},
        doorbell_key_enc = CASE WHEN ${clearKey} THEN NULL ELSE doorbell_key_enc END,
        doorbell_key_iv = CASE WHEN ${clearKey} THEN NULL ELSE doorbell_key_iv END,
        doorbell_key_version = CASE WHEN ${clearKey} THEN NULL ELSE doorbell_key_version END,
        updated_at = now()
    WHERE id = ${agent.id} AND user_id = ${store.userId}
  `;
  return { doorbell_url: url, has_key: !clearKey && agent.doorbell_key_enc != null };
}

/** Ring an agent's doorbell. Never throws: the outcome is the return value. */
export async function ringDoorbell(
  store: Store,
  env: Env,
  agent: Agent,
): Promise<{ rang: boolean; error: string | null }> {
  if (!agent.doorbell_url) return { rang: false, error: null };
  try {
    const pub = await assertPublicFeedUrl(agent.doorbell_url);
    if (!pub.ok) return { rang: false, error: "doorbell host not allowed" };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (agent.doorbell_key_enc && agent.doorbell_key_iv) {
      const key = await openToken(
        {
          ciphertext: new Uint8Array(agent.doorbell_key_enc),
          iv: new Uint8Array(agent.doorbell_key_iv),
          keyVersion: agent.doorbell_key_version ?? 1,
        },
        doorbellAad(agent.id, store.userId),
        await ring(env),
      );
      headers.Authorization = /^bearer\s/i.test(key) ? key : `Bearer ${key}`;
    }
    const open = await countOpen(store, agent.id);
    const res = await outboundFetch(agent.doorbell_url, {
      method: "POST",
      headers,
      body: JSON.stringify(doorbellBody(open)),
      redirect: "manual",
      signal: AbortSignal.timeout(DOORBELL_TIMEOUT_MS),
    });
    if (res.status >= 200 && res.status < 300) return { rang: true, error: null };
    return { rang: false, error: `doorbell answered ${res.status}` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { rang: false, error: "doorbell timed out" };
    return { rang: false, error: "doorbell unreachable" };
  }
}

async function countOpen(store: Store, connectionId: string): Promise<number> {
  const rows = (await store.sql`
    SELECT count(*)::int AS n FROM handoffs
    WHERE user_id = ${store.userId} AND connection_id = ${connectionId} AND outcome = 'open'
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

// ── The operator's acts ─────────────────────────────────────────────────────

async function ownedTask(store: Store, taskId: string): Promise<Row | null> {
  const rows = (await store.sql`
    SELECT * FROM tasks WHERE id = ${taskId} AND user_id = ${store.userId} LIMIT 1
  `) as Row[];
  return rows[0] ?? null;
}

async function closeOpen(store: Store, taskId: string, outcome: "recalled" | "done" | "back", agentNote = "") {
  await store.sql`
    UPDATE handoffs
    SET outcome = ${outcome}, agent_note = ${agentNote}, closed_at = now()
    WHERE user_id = ${store.userId} AND task_id = ${taskId} AND outcome = 'open'
  `;
}

/** Hand a task to an agent: mark it, take its clock time off, open the
 *  hand-off, ring the doorbell. Returns the task row and the ring outcome. */
export async function handTask(
  store: Store,
  env: Env,
  rawTaskId: unknown,
  rawConnectionId: unknown,
  rawNote: unknown,
): Promise<{ task: Row; handoff_id: string; rang: boolean; ring_error: string | null }> {
  const taskId = uuid(rawTaskId, "task_id");
  const agent = await getAgent(store, uuid(rawConnectionId, "connection_id"));
  if (!agent || agent.revoked_at || !agent.takes_handoffs) throw new HandoffError("That token doesn't take hand-offs", 404);
  const task = await ownedTask(store, taskId);
  if (!task) throw new HandoffError("No such task", 404);
  if (task.parent_task_id) throw new HandoffError("A step can't be handed off — hand off its task");
  if (task.status === "done" || task.status === "trashed") throw new HandoffError("That task is closed");

  await closeOpen(store, taskId, "recalled");
  const ins = (await store.sql`
    INSERT INTO handoffs (user_id, task_id, connection_id, note)
    VALUES (${store.userId}, ${taskId}, ${agent.id}, ${cleanNote(rawNote, OWNER_NOTE_MAX)})
    RETURNING id
  `) as { id: string }[];
  const handoffId = ins[0]!.id;
  // Its hour is no longer yours: the clock comes off, the day stays. A task in
  // a slot leaves the slot for the same reason.
  const updated = (await store.sql`
    UPDATE tasks
    SET handed_to = ${agent.id}, start_time = NULL, slot_id = NULL, updated_at = now()
    WHERE id = ${taskId} AND user_id = ${store.userId}
    RETURNING *
  `) as Row[];

  const r = await ringDoorbell(store, env, agent);
  if (agent.doorbell_url) {
    await store.sql`
      UPDATE handoffs
      SET rang_at = CASE WHEN ${r.rang} THEN now() ELSE NULL END, ring_error = ${r.error}
      WHERE id = ${handoffId} AND user_id = ${store.userId}
    `;
  }
  return { task: updated[0] ?? task, handoff_id: handoffId, rang: r.rang, ring_error: r.error };
}

/** Take a task back from its agent. Its clock time is not restored — it was
 *  cleared on purpose; the day is still there. */
export async function recallTask(store: Store, rawTaskId: unknown): Promise<Row> {
  const taskId = uuid(rawTaskId, "task_id");
  const task = await ownedTask(store, taskId);
  if (!task) throw new HandoffError("No such task", 404);
  await closeOpen(store, taskId, "recalled");
  const rows = (await store.sql`
    UPDATE tasks SET handed_to = NULL, updated_at = now()
    WHERE id = ${taskId} AND user_id = ${store.userId}
    RETURNING *
  `) as Row[];
  return rows[0] ?? task;
}

/** Ring an agent's doorbell from Settings, to test it. */
export async function testDoorbell(store: Store, env: Env, rawConnectionId: unknown) {
  const agent = await getAgent(store, uuid(rawConnectionId, "connection_id"));
  if (!agent || agent.revoked_at) throw new HandoffError("No such token", 404);
  if (!agent.doorbell_url) throw new HandoffError("No doorbell set");
  return ringDoorbell(store, env, agent);
}

// ── The agent's tools (MCP) ─────────────────────────────────────────────────

const appLink = (env: Env, taskId: string) => {
  const base = (env.APP_URL ?? "https://app.nuvo.day").replace(/\/+$/, "");
  return `${base}/?task=${taskId}`;
};

export async function listHandoffsFor(store: Store, env: Env, connectionId: string): Promise<string> {
  const rows = (await store.sql`
    SELECT h.task_id, h.note, h.created_at, t.title, t.do_date, t.deadline
    FROM handoffs h
    JOIN tasks t ON t.id = h.task_id AND t.user_id = h.user_id
    WHERE h.user_id = ${store.userId}
      AND h.connection_id = ${connectionId}
      AND h.outcome = 'open'
      AND t.status NOT IN ('done', 'trashed')
    ORDER BY h.created_at
  `) as Row[];
  return JSON.stringify({
    handoffs: rows.map((r) => ({
      task_id: r.task_id,
      title: r.title,
      note_from_operator: r.note || null,
      day: r.do_date ?? null,
      deadline: r.deadline ?? null,
      handed_at: r.created_at,
      link: appLink(env, String(r.task_id)),
    })),
    next: rows.length ? "Call get_handoff for each task_id, do the work, then report_handoff." : "Nothing is waiting.",
  });
}

async function openHandoff(store: Store, connectionId: string, taskId: string): Promise<Row | null> {
  const rows = (await store.sql`
    SELECT * FROM handoffs
    WHERE user_id = ${store.userId} AND connection_id = ${connectionId}
      AND task_id = ${taskId} AND outcome = 'open'
    ORDER BY created_at DESC LIMIT 1
  `) as Row[];
  return rows[0] ?? null;
}

const NOT_YOURS = "That task isn't handed to you (or was already answered). Call list_handoffs.";

export async function getHandoffBrief(
  store: Store,
  env: Env,
  connection: { id: string; name: string },
  rawTaskId: unknown,
): Promise<string> {
  const taskId = typeof rawTaskId === "string" && UUID_RE.test(rawTaskId) ? rawTaskId : null;
  if (!taskId) return NOT_YOURS;
  const handoff = await openHandoff(store, connection.id, taskId);
  const task = handoff ? await ownedTask(store, taskId) : null;
  if (!handoff || !task) return NOT_YOURS;
  const sql = store.sql;
  const [steps, project, projectTasks, domain, history] = await Promise.all([
    sql`SELECT title, status, sort_order FROM tasks WHERE user_id = ${store.userId} AND parent_task_id = ${taskId}`,
    task.project_id
      ? sql`SELECT name, outcome, status FROM projects WHERE id = ${String(task.project_id)} AND user_id = ${store.userId}`
      : Promise.resolve([]),
    task.project_id
      ? sql`SELECT id, title, status, completed_at, parent_task_id FROM tasks
            WHERE user_id = ${store.userId} AND project_id = ${String(task.project_id)}`
      : Promise.resolve([]),
    sql`SELECT d.name FROM domains d
        WHERE d.user_id = ${store.userId}
          AND d.id = COALESCE(
            (SELECT p.domain_id FROM projects p WHERE p.id = ${(task.project_id as string | null) ?? null} AND p.user_id = ${store.userId}),
            ${(task.domain_id as string | null) ?? null}::uuid)`,
    sql`SELECT outcome, note, agent_note, created_at, closed_at FROM handoffs
        WHERE user_id = ${store.userId} AND task_id = ${taskId} AND outcome <> 'open'
        ORDER BY created_at DESC LIMIT 10`,
  ]);
  return JSON.stringify(
    buildHandoffBrief({
      task,
      handoff,
      agentName: connection.name,
      steps: steps as Row[],
      project: ((project as Row[])[0] ?? null) as Row | null,
      projectTasks: projectTasks as Row[],
      domain: ((domain as Row[])[0] ?? null) as Row | null,
      history: history as Row[],
      link: appLink(env, taskId),
    }),
  );
}

export async function reportHandoff(
  store: Store,
  connection: { id: string; name: string },
  args: Record<string, unknown>,
): Promise<string> {
  const taskId = typeof args.task_id === "string" && UUID_RE.test(args.task_id) ? args.task_id : null;
  const outcome = parseReportOutcome(args.outcome);
  if (!outcome) return "outcome must be 'done' or 'back'.";
  if (!taskId) return NOT_YOURS;
  const handoff = await openHandoff(store, connection.id, taskId);
  if (!handoff) return NOT_YOURS;
  const note = cleanNote(args.note, AGENT_NOTE_MAX);
  await closeOpen(store, taskId, outcome, note);
  if (outcome === "done") {
    // handed_to stays: the row reads "Done by <agent>".
    await store.sql`
      UPDATE tasks
      SET status = 'done', completed_at = now(), updated_at = now()
      WHERE id = ${taskId} AND user_id = ${store.userId} AND status NOT IN ('done', 'trashed')
    `;
    return `Done. The task is complete in Nuvo and reads "Done by ${connection.name}".`;
  }
  await store.sql`
    UPDATE tasks SET handed_to = NULL, updated_at = now()
    WHERE id = ${taskId} AND user_id = ${store.userId}
  `;
  return "Handed back. The operator has it again, with your note.";
}
