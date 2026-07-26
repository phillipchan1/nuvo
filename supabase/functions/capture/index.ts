// Public, token-authed Capture API. Lets another app the user owns (or
// voluntarily connects — e.g. "Lead Well") keep a task in sync with a Nuvo
// user's inbox over HTTP, authenticated by a per-connection bearer token the
// user minted in Settings. Todoist/Linear "API token" model, NOT OAuth.
//
// Two-way, single-credential — the SAME token drives both directions, which is
// how Nuvo already thinks about sync (poll-based: ICS/iCloud/GitHub):
//   POST  /capture              create a task (or, with a known external_id +
//                               status, update it — the other app completing it)
//   GET   /capture?since=<ISO>  poll the tasks THIS connection created, with
//                               their current status — so the other app learns
//                               when one was completed here and closes the loop.
// Pull, not push: no callback URL, no second secret, no echo loops.
//
// Auth is abstracted from ingestion: we resolve a user_id from the credential,
// then everything downstream is credential-agnostic — a future OAuth path can
// resolve the same user_id and reuse this untouched.
//
// verify_jwt is OFF (see supabase/config.toml): the bearer is our own opaque
// token, not a Supabase JWT, so the gateway must pass it through to us.
import { admin } from "../_shared/admin.ts";
import { createTaskCore, mirrorTask, FALLBACK_TZ } from "../_shared/createTask.ts";
import type { TaskPriority } from "../_shared/nlp.ts";

// A chatty external app is the same unbounded-loop risk we've been burned by,
// pointed inward — cap writes per connection per minute.
const RATE_LIMIT_PER_MIN = 60;

// Statuses the other app is allowed to set on a task it owns. 'done' completes
// it; 'inbox'/'planned'/'backlog' reopen it; 'trashed' deletes it app-wide.
const INBOUND_STATUSES = new Set(["inbox", "planned", "backlog", "done", "trashed"]);

// Callable cross-origin from another web app. Idempotency-Key is added to the
// shared allow-list, and GET is allowed for the changes feed.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

/** sha256(token) as lowercase hex — what we store and compare against. Never
 *  reversible, so a leaked hash can't forge auth. */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function resolveTz(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return FALLBACK_TZ;
  }
}

interface Connection {
  id: string;
  user_id: string;
  app: string;
  scopes: string[];
}

/** Resolve the bearer token → a live connection, or a Response to short-circuit. */
async function authenticate(req: Request): Promise<Connection | Response> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing bearer token" }, 401);

  const tokenHash = await sha256Hex(token);
  const { data: conn } = await admin
    .from("connections")
    .select("id, user_id, app, scopes")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle<Connection>();
  // Never branch on the raw token — only the hash lookup decides.
  if (!conn) return json({ error: "Invalid or revoked token" }, 401);
  if (!conn.scopes?.includes("inbox:write")) {
    return json({ error: "Token lacks inbox:write scope" }, 403);
  }
  return conn;
}

const touch = (id: string) =>
  admin.from("connections").update({ last_used_at: new Date().toISOString() }).eq("id", id);

const DEFAULT_DURATION = 30;

interface FeedRow {
  status: string;
  do_date: string | null;
  start_time: string | null;
  duration_minutes: number | null;
}

/** Collapse Nuvo's internal task fields into ONE portable state word the other
 *  app can render as a status report — it doesn't need to know Nuvo internals:
 *    deleted · done · in_progress · scheduled · planned · backlog · inbox
 *  'in_progress' is derived (a timed block happening right now) — Nuvo has no
 *  such enum; it's the same "ongoing" notion the schedule uses. */
function deriveState(t: FeedRow, nowMs: number): string {
  if (t.status === "trashed") return "deleted";
  if (t.status === "done") return "done";
  if (t.start_time) {
    const start = new Date(t.start_time).getTime();
    const end = start + (t.duration_minutes ?? DEFAULT_DURATION) * 60_000;
    return nowMs >= start && nowMs < end ? "in_progress" : "scheduled";
  }
  if (t.do_date) return "planned";
  return t.status === "backlog" ? "backlog" : "inbox";
}

// ── GET /capture?since=<ISO> — the status feed (Nuvo → other app) ───────────
// Returns the tasks THIS connection created — each with a portable `state`
// (scheduled / in_progress / done …) and its scheduling — changed since the
// cursor. The other app persists `cursor` and polls, so it can show a real
// status report (not just done/not-done) and mirror completions back.
async function handleGet(req: Request, conn: Connection): Promise<Response> {
  const since = new URL(req.url).searchParams.get("since");
  let q = admin
    .from("tasks")
    .select("id, external_id, title, status, do_date, start_time, duration_minutes, deadline, completed_at, updated_at")
    .eq("connection_id", conn.id)
    .order("updated_at", { ascending: true })
    .limit(200);
  if (since) q = q.gt("updated_at", since);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);

  await touch(conn.id);
  const nowMs = Date.now();
  const tasks = (data ?? []).map((t) => ({
    id: t.id,
    external_id: t.external_id,
    title: t.title,
    state: deriveState(t as FeedRow, nowMs),        // portable status word
    scheduled_for: t.start_time ?? t.do_date ?? null, // when it's set for, if any
    status: t.status,                                // raw Nuvo status
    do_date: t.do_date,
    start_time: t.start_time,
    duration_minutes: t.duration_minutes,
    deadline: t.deadline,
    completed_at: t.completed_at,
    updated_at: t.updated_at,
  }));
  // Cursor = newest row returned; unchanged when nothing new (idempotent poll).
  const cursor = tasks.length ? tasks[tasks.length - 1].updated_at : (since ?? null);
  return json({ tasks, cursor }, 200);
}

// ── POST /capture — create, or update a known task (other app → Nuvo) ───────
async function handlePost(req: Request, conn: Connection): Promise<Response> {
  // Rate limit: this connection's writes in the trailing minute.
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", conn.id)
    .gte("created_at", oneMinAgo);
  if ((count ?? 0) >= RATE_LIMIT_PER_MIN) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded — slow down" }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60", ...cors } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text : undefined;
  const title = typeof body.title === "string" ? body.title : undefined;
  const status = typeof body.status === "string" && INBOUND_STATUSES.has(body.status) ? body.status : null;

  const idemKey =
    req.headers.get("Idempotency-Key")?.trim() ||
    (typeof body.external_id === "string" ? body.external_id.trim() : "") ||
    null;

  // Known external_id → this is an UPDATE (or an idempotent replay), not a new
  // task. The other app marking its task done lands here.
  if (idemKey) {
    const { data: prior } = await admin
      .from("tasks")
      .select("id, title, status")
      .eq("connection_id", conn.id)
      .eq("external_id", idemKey)
      .maybeSingle();
    if (prior) {
      await touch(conn.id);
      if (status && status !== prior.status) {
        const patch: Record<string, unknown> = {
          status,
          completed_at: status === "done" ? new Date().toISOString() : null,
        };
        const { data: updated, error } = await admin
          .from("tasks")
          .update(patch)
          .eq("id", prior.id)
          .eq("connection_id", conn.id) // defense-in-depth: only this connection's row
          .select("id, title, status")
          .single();
        if (error) return json({ error: error.message }, 500);
        await mirrorTask(prior.id); // reflect complete/trash onto the calendar mirror
        return json({ id: updated.id, title: updated.title, status: updated.status, updated: true }, 200);
      }
      // No actionable change — idempotent no-op.
      return json({ id: prior.id, title: prior.title, status: prior.status }, 200);
    }
  }

  // No prior row → CREATE. Needs text or a structured title.
  if (!text?.trim() && !title?.trim()) {
    return json({ error: "Provide `text` (free-form) or `title` (structured)" }, 400);
  }

  let created;
  try {
    created = await createTaskCore({
      userId: conn.user_id, // ONLY from the connection — never the request body
      tz: resolveTz(body.tz),
      capture: text,
      title,
      doDate: typeof body.do_date === "string" ? body.do_date : undefined,
      startTime: typeof body.start_time === "string" ? body.start_time : undefined,
      durationMinutes: typeof body.duration_minutes === "number" ? body.duration_minutes : undefined,
      priority: typeof body.priority === "string" ? (body.priority as TaskPriority) : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      source: (typeof body.source === "string" && body.source) || conn.app,
      connectionId: conn.id,
      externalId: idemKey,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Lost an idempotency race (unique (connection_id, external_id)) — return
    // the row the concurrent insert won.
    if (idemKey && /duplicate key|tasks_connection_external_id_idx/i.test(msg)) {
      const { data: prior } = await admin
        .from("tasks")
        .select("id, title, status")
        .eq("connection_id", conn.id)
        .eq("external_id", idemKey)
        .maybeSingle();
      if (prior) return json({ id: prior.id, title: prior.title, status: prior.status }, 200);
    }
    throw e;
  }

  await touch(conn.id);
  return json({ id: created.id, title: created.title, status: created.status }, 201);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const conn = await authenticate(req);
    if (conn instanceof Response) return conn;

    if (req.method === "GET") return await handleGet(req, conn);
    if (req.method === "POST") return await handlePost(req, conn);
    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[capture]", msg);
    return json({ error: msg }, 500);
  }
});
