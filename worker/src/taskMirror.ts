/**
 * Mirror a scheduled task onto the dedicated "Nuvo" calendar.
 * Owner is the verified session. A foreign or missing taskId is 404 —
 * the same response as a random id (no existence oracle).
 */
import type { Context } from "hono";
import { OPEN_CORS, json } from "./cors.ts";
import { BadRequestError, readJson, requireUuid } from "./http.ts";
import {
  mirrorDescription,
  mirrorSpan,
  mirrorTitle,
  shouldMirror,
} from "../../supabase/functions/_shared/mirror.ts";
import {
  deleteMirror,
  noteMirror,
  putMirror,
  resolveMirrorTarget,
  type MirrorDeps,
} from "./mirrorTargets.ts";
import type { Store } from "./store.ts";

type TaskRow = {
  id: string;
  user_id: string;
  title: string | null;
  notes: string | null;
  status: string | null;
  start_time: string | null;
  duration_minutes: number | null;
  google_event_id: string | null;
};

export async function handleTaskMirror(
  c: Context,
  store: Store,
  deps: Omit<MirrorDeps, "sql" | "env"> & { env: MirrorDeps["env"] },
): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (c.req.method !== "POST") return json({ error: "method not allowed" }, 405, OPEN_CORS);

  const body = await readJson<{ taskId?: string; tz?: string }>(c);
  if (!body.taskId) return json({ error: "taskId required" }, 400, OPEN_CORS);
  const taskId = requireUuid(body.taskId, "taskId");
  const tz = typeof body.tz === "string" && body.tz ? body.tz : "UTC";
  const mirror: MirrorDeps = { sql: store.sql, env: deps.env, fetchImpl: deps.fetchImpl };

  try {
    const rows = (await store.sql`
      SELECT id, user_id, title, notes, status, start_time, duration_minutes, google_event_id
      FROM tasks
      WHERE id = ${taskId}
        AND user_id = ${store.userId}
      LIMIT 1
    `) as TaskRow[];
    const task = rows[0];
    if (!task) return json({ error: "not found" }, 404, OPEN_CORS);

    const target = await resolveMirrorTarget(mirror, store.userId);
    if (!target) return json({ ok: true, skipped: "no mirror calendar" }, 200, OPEN_CORS);

    if (!shouldMirror(task, "task")) {
      if (target.provider === "icloud" || task.google_event_id) {
        await deleteMirror(mirror, target, "task", task.id, task.google_event_id);
        if (task.google_event_id) {
          await store.sql`
            UPDATE tasks
            SET google_event_id = NULL, updated_at = now()
            WHERE id = ${task.id}
              AND user_id = ${store.userId}
          `;
        }
        await noteMirror(store.sql, target.provider, "mirror-delete", "ok", store.userId);
      }
      return json({ ok: true }, 200, OPEN_CORS);
    }

    const span = mirrorSpan(task, "task");
    const eventId = await putMirror(
      mirror,
      target,
      {
        kind: "task",
        rowId: task.id,
        title: mirrorTitle(task, "Task"),
        startISO: span.startISO,
        endISO: span.endISO,
        description: mirrorDescription(task.notes),
        tz,
      },
      task.google_event_id,
    );

    if (eventId && eventId !== task.google_event_id) {
      await store.sql`
        UPDATE tasks
        SET google_event_id = ${eventId}, updated_at = now()
        WHERE id = ${task.id}
          AND user_id = ${store.userId}
      `;
    }
    await noteMirror(
      store.sql,
      target.provider,
      task.google_event_id ? "mirror-update" : "mirror-create",
      "ok",
      store.userId,
    );
    return json({ ok: true }, 200, OPEN_CORS);
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    await noteMirror(store.sql, "google", "mirror", "error", store.userId);
    return json({ error: "request failed" }, 500, OPEN_CORS);
  }
}
