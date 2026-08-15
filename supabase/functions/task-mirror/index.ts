// Mirror scheduled tasks onto the dedicated "Nuvo" calendar so time blocks show
// up on the user's phone alongside everything else they've committed to.
//
// Reconciler, not a command handler: the client just says "task X changed"
// and this function makes the provider match the task's current state —
//   scheduled + active/done → upsert event (✓ prefix when done)
//   unblocked / trashed / rolled → delete event
//
// Mirror writes are one-directional (app → provider); the app's version wins.
// That is a deliberate model choice, not an oversight — see docs/product/
// decisions.md. What WAS an oversight, and what this now fixes, is that the
// mirror only ever existed for Google (`google-oauth/index.ts` was the one line
// that set `mirror_calendar_id`), so an iCloud-only user's blocks never left
// Nuvo at all. iCloud is a writable provider; that was an asymmetry, not a
// policy. Both live behind `_shared/mirrorTargets.ts` now.
import { admin, handleOptions, json, logSync, readSecret, requireUser } from "../_shared/admin.ts";
import { mirrorDescription, mirrorSpan, mirrorTitle, shouldMirror } from "../_shared/mirror.ts";
import { deleteMirror, putMirror, resolveMirrorTarget } from "../_shared/mirrorTargets.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const body_ = await req.json();
    const { taskId } = body_;
    if (!taskId) return json({ error: "taskId required" }, 400);

    const { data: task, error } = await admin
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();
    if (error || !task) return json({ error: "task not found" }, 404);

    // Client-invoked: the caller must own the task (service role bypasses).
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (bearer !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      const user = await requireUser(req);
      if (task.user_id !== user.id) return json({ error: "forbidden" }, 403);
    }

    const target = await resolveMirrorTarget(task.user_id, readSecret);
    if (!target) return json({ ok: true, skipped: "no mirror calendar" });

    if (!shouldMirror(task, "task")) {
      // Google needs the stored id to find its event; CalDAV derives the
      // resource from the task id, so a torn-down mirror is safe to tear down
      // again and needs no state at all.
      if (target.provider === "icloud" || task.google_event_id) {
        await deleteMirror(target, "task", task.id, task.google_event_id);
        if (task.google_event_id) {
          await admin.from("tasks").update({ google_event_id: null }).eq("id", task.id);
        }
        await logSync(target.provider, "mirror-delete", "ok", undefined, task.user_id);
      }
      return json({ ok: true });
    }

    // The zone rides the request from the device, and falls back to UTC rather
    // than to a home zone. It used to be hardcoded `America/Los_Angeles` — which
    // is one operator's own zone stamped on every user's mirrored block
    // (Principle 16), and the exact class of bug the device-zone-not-home-zone
    // doctrine was locked in for (D-082). Every write is a UTC instant either
    // way, so this only decides how Google renders and DST-shifts the block.
    const tz = typeof body_.tz === "string" && body_.tz ? body_.tz : "UTC";
    const span = mirrorSpan(task, "task");

    const eventId = await putMirror(
      target,
      {
        kind: "task",
        rowId: task.id,
        title: mirrorTitle(task, "Task"),
        startISO: span.startISO,
        endISO: span.endISO,
        // Carries the "edits here won't stick" line — the only channel that
        // reaches the user inside Google/Apple, where the mistake is made.
        description: mirrorDescription(task.notes),
        tz,
      },
      task.google_event_id,
    );

    if (eventId && eventId !== task.google_event_id) {
      await admin.from("tasks").update({ google_event_id: eventId }).eq("id", task.id);
    }
    await logSync(target.provider, task.google_event_id ? "mirror-update" : "mirror-create", "ok", undefined, task.user_id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("google", "mirror", "error", msg);
    return json({ error: msg }, 500);
  }
});
