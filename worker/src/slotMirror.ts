/**
 * Mirror a Time Slot onto the dedicated "Nuvo" calendar.
 * Owner is the verified session. A foreign or missing slotId is 404 —
 * the same response as a random id (no existence oracle).
 */
import type { Context } from "hono";
import { OPEN_CORS, json } from "./cors.ts";
import { BadRequestError, readJson, requireUuid } from "./http.ts";
import {
  mirrorDescription,
  mirrorSpan,
  mirrorTitle,
} from "../../supabase/functions/_shared/mirror.ts";
import {
  deleteMirror,
  noteMirror,
  putMirror,
  resolveMirrorTarget,
  type MirrorDeps,
} from "./mirrorTargets.ts";
import type { Store } from "./store.ts";

const SLOT_GLYPH = "🗂";

type SlotRow = {
  id: string;
  user_id: string;
  title: string | null;
  start_time: string;
  duration_minutes: number | null;
  google_event_id: string | null;
};

export async function handleSlotMirror(
  c: Context,
  store: Store,
  deps: Omit<MirrorDeps, "sql" | "env"> & { env: MirrorDeps["env"] },
): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (c.req.method !== "POST") return json({ error: "method not allowed" }, 405, OPEN_CORS);

  const body = await readJson<{ slotId?: string; deleted?: boolean; googleEventId?: string; tz?: string }>(c);
  if (!body.slotId) return json({ error: "slotId required" }, 400, OPEN_CORS);
  const slotId = requireUuid(body.slotId, "slotId");
  const tz = typeof body.tz === "string" && body.tz ? body.tz : "UTC";
  const mirror: MirrorDeps = { sql: store.sql, env: deps.env, fetchImpl: deps.fetchImpl };

  try {
    if (body.deleted) {
      const target = await resolveMirrorTarget(mirror, store.userId);
      if (!target) return json({ ok: true, skipped: "no mirror calendar" }, 200, OPEN_CORS);
      const knownId = typeof body.googleEventId === "string" ? body.googleEventId : null;
      if (target.provider === "icloud" || knownId) {
        await deleteMirror(mirror, target, "slot", slotId, knownId);
        await noteMirror(store.sql, target.provider, "slot-mirror-delete", "ok", store.userId);
      }
      return json({ ok: true }, 200, OPEN_CORS);
    }

    const rows = (await store.sql`
      SELECT id, user_id, title, start_time, duration_minutes, google_event_id
      FROM slots
      WHERE id = ${slotId}
        AND user_id = ${store.userId}
      LIMIT 1
    `) as SlotRow[];
    const slot = rows[0];
    if (!slot) return json({ error: "not found" }, 404, OPEN_CORS);

    const target = await resolveMirrorTarget(mirror, store.userId);
    if (!target) return json({ ok: true, skipped: "no mirror calendar" }, 200, OPEN_CORS);

    const span = mirrorSpan(slot, "slot");
    const existingEventId = slot.google_event_id;
    const eventId = await putMirror(
      mirror,
      target,
      {
        kind: "slot",
        rowId: slotId,
        title: `${SLOT_GLYPH} ${mirrorTitle(slot, "Time slot")}`,
        startISO: span.startISO,
        endISO: span.endISO,
        description: mirrorDescription(null),
        tz,
      },
      existingEventId,
    );

    if (eventId && eventId !== existingEventId) {
      await store.sql`
        UPDATE slots
        SET google_event_id = ${eventId}, updated_at = now()
        WHERE id = ${slotId}
          AND user_id = ${store.userId}
      `;
    }
    await noteMirror(
      store.sql,
      target.provider,
      existingEventId ? "slot-mirror-update" : "slot-mirror-create",
      "ok",
      store.userId,
    );
    return json({ ok: true }, 200, OPEN_CORS);
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    await noteMirror(store.sql, "google", "slot-mirror", "error", store.userId);
    return json({ error: "request failed" }, 500, OPEN_CORS);
  }
}
