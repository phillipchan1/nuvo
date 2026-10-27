import type { Context } from "hono";
import { hasScope, resolveConnection, SCOPE_INBOX, tokenFrom, touchConnection } from "./connections.ts";
import { OPEN_CORS, json } from "./cors.ts";
import { requestIo, type AppEnv } from "./session.ts";
import { bootstrapUser, insertOwned, makeStore } from "./store.ts";

const RATE_LIMIT_PER_MIN = 60;
const INBOUND_STATUSES = new Set(["inbox", "planned", "backlog", "done", "trashed"]);
const CAPTURE_CORS = {
  ...OPEN_CORS,
  "Access-Control-Allow-Headers": `${OPEN_CORS["Access-Control-Allow-Headers"]}, idempotency-key, x-nuvo-token`,
};

function deriveState(
  t: { status: string; do_date: string | null; start_time: string | null; duration_minutes: number | null },
  nowMs: number,
): string {
  if (t.status === "trashed") return "deleted";
  if (t.status === "done") return "done";
  if (t.start_time) {
    const start = new Date(t.start_time).getTime();
    const end = start + (t.duration_minutes ?? 30) * 60_000;
    return nowMs >= start && nowMs < end ? "in_progress" : "scheduled";
  }
  if (t.do_date) return "planned";
  return t.status === "backlog" ? "backlog" : "inbox";
}

export async function handleCapture(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: CAPTURE_CORS });
  const io = await requestIo(c);
  const token = tokenFrom(c.req.raw);
  if (!token) return json({ error: "Missing bearer token" }, 401, CAPTURE_CORS);
  const conn = await resolveConnection(io.sql, token);
  if (!conn) return json({ error: "Invalid or revoked token" }, 401, CAPTURE_CORS);
  if (!hasScope(conn, SCOPE_INBOX)) {
    return json({ error: "Token lacks inbox:write scope" }, 403, CAPTURE_CORS);
  }
  const store = await bootstrapUser(makeStore(io.sql, conn.user_id), null);

  if (c.req.method === "GET") {
    const since = new URL(c.req.url).searchParams.get("since");
    const rows = (since
      ? await store.sql`
          SELECT id, external_id, title, status, do_date, start_time, duration_minutes, deadline, completed_at, updated_at
          FROM tasks
          WHERE user_id = ${store.userId}
            AND connection_id = ${conn.id}
            AND updated_at > ${since}
          ORDER BY updated_at
          LIMIT 200
        `
      : await store.sql`
          SELECT id, external_id, title, status, do_date, start_time, duration_minutes, deadline, completed_at, updated_at
          FROM tasks
          WHERE user_id = ${store.userId}
            AND connection_id = ${conn.id}
          ORDER BY updated_at
          LIMIT 200
        `) as {
      id: string;
      external_id: string | null;
      title: string;
      status: string;
      do_date: string | null;
      start_time: string | null;
      duration_minutes: number | null;
      deadline: string | null;
      completed_at: string | null;
      updated_at: string;
    }[];
    await touchConnection(io.sql, conn.id);
    const nowMs = Date.now();
    const tasks = rows.map((t) => ({
      id: t.id,
      external_id: t.external_id,
      title: t.title,
      state: deriveState(t, nowMs),
      scheduled_for: t.start_time ?? t.do_date ?? null,
      status: t.status,
      do_date: t.do_date,
      start_time: t.start_time,
      duration_minutes: t.duration_minutes,
      deadline: t.deadline,
      completed_at: t.completed_at,
      updated_at: t.updated_at,
    }));
    const cursor = tasks.length ? tasks[tasks.length - 1].updated_at : since;
    return json({ tasks, cursor }, 200, CAPTURE_CORS);
  }

  if (c.req.method !== "POST") return json({ error: "Method not allowed" }, 405, CAPTURE_CORS);

  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const recent = (await store.sql`
    SELECT count(*)::int AS n
    FROM tasks
    WHERE user_id = ${store.userId}
      AND connection_id = ${conn.id}
      AND created_at >= ${oneMinAgo}
  `) as { n: number }[];
  if (Number(recent[0]?.n ?? 0) >= RATE_LIMIT_PER_MIN) {
    return json({ error: "Rate limit exceeded — slow down" }, 429, { ...CAPTURE_CORS, "Retry-After": "60" });
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text : undefined;
  const title = typeof body.title === "string" ? body.title : undefined;
  const status = typeof body.status === "string" && INBOUND_STATUSES.has(body.status) ? body.status : null;
  const idemKey =
    c.req.header("Idempotency-Key")?.trim() ||
    (typeof body.external_id === "string" ? body.external_id.trim() : "") ||
    null;

  if (idemKey) {
    const prior = (await store.sql`
      SELECT id, title, status
      FROM tasks
      WHERE user_id = ${store.userId}
        AND connection_id = ${conn.id}
        AND external_id = ${idemKey}
      LIMIT 1
    `) as { id: string; title: string; status: string }[];
    if (prior[0]) {
      await touchConnection(io.sql, conn.id);
      if (status && status !== prior[0].status) {
        const completed = status === "done" ? new Date().toISOString() : null;
        const updated = (await store.sql`
          UPDATE tasks
          SET status = ${status}, completed_at = ${completed}, updated_at = now()
          WHERE id = ${prior[0].id}
            AND user_id = ${store.userId}
            AND connection_id = ${conn.id}
          RETURNING id, title, status
        `) as { id: string; title: string; status: string }[];
        const row = updated[0] ?? prior[0];
        return json({ id: row.id, title: row.title, status: row.status, updated: true }, 200, CAPTURE_CORS);
      }
      return json({ id: prior[0].id, title: prior[0].title, status: prior[0].status }, 200, CAPTURE_CORS);
    }
  }

  if (!text?.trim() && !title?.trim()) {
    return json({ error: "Provide `text` (free-form) or `title` (structured)" }, 400, CAPTURE_CORS);
  }

  const created = await insertOwned(store, "tasks", {
    title: (title ?? text ?? "Untitled").trim(),
    notes: typeof body.notes === "string" ? body.notes : "",
    status: status ?? "inbox",
    project_id: null,
    domain_id: null,
  });
  if (!created) return json({ error: "cannot insert" }, 400, CAPTURE_CORS);

  if (idemKey) {
    await store.sql`
      UPDATE tasks
      SET source = ${conn.app},
          connection_id = ${conn.id},
          external_id = ${idemKey}
      WHERE id = ${String(created.id)}
        AND user_id = ${store.userId}
    `;
  } else {
    await store.sql`
      UPDATE tasks
      SET source = ${conn.app},
          connection_id = ${conn.id}
      WHERE id = ${String(created.id)}
        AND user_id = ${store.userId}
    `;
  }

  await touchConnection(io.sql, conn.id);
  return json({ id: created.id, title: created.title, status: created.status }, 201, CAPTURE_CORS);
}
