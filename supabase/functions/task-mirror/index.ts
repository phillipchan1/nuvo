// Mirror scheduled tasks onto the dedicated "Nuvo" Google calendar so time
// blocks show up on the phone before any mobile UI exists.
//
// Reconciler, not a command handler: the client just says "task X changed"
// and this function makes Google match the task's current state —
//   scheduled + active/done → upsert event (✓ prefix when done)
//   unblocked / trashed / rolled → delete event
// Mirror writes are one-directional (app → Google); the app's version wins.
import { admin, handleOptions, json, logSync, requireUser } from "../_shared/admin.ts";
import { type GoogleAccount, gFetch } from "../_shared/google.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const { taskId } = await req.json();
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

    const { data: accounts } = await admin
      .from("calendar_accounts")
      .select("*")
      .eq("user_id", task.user_id)
      .eq("provider", "google")
      .not("mirror_calendar_id", "is", null)
      .limit(1);
    const account = accounts?.[0] as GoogleAccount | undefined;
    if (!account) return json({ ok: true, skipped: "no mirror calendar" });
    const calId = encodeURIComponent(account.mirror_calendar_id!);

    const shouldMirror =
      task.start_time != null && (task.status === "planned" || task.status === "done");

    if (!shouldMirror) {
      if (task.google_event_id) {
        const res = await gFetch(
          account,
          `/calendars/${calId}/events/${encodeURIComponent(task.google_event_id)}`,
          { method: "DELETE" },
        );
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          throw new Error(`mirror delete failed: ${res.status}`);
        }
        await admin.from("tasks").update({ google_event_id: null }).eq("id", task.id);
        await logSync("google", "mirror-delete", "ok", undefined, task.user_id);
      }
      return json({ ok: true });
    }

    const start = new Date(task.start_time);
    const end = new Date(start.getTime() + (task.duration_minutes ?? 30) * 60_000);
    const body = JSON.stringify({
      summary: task.status === "done" ? `✓ ${task.title}` : task.title,
      description: task.notes || undefined,
      start: { dateTime: start.toISOString(), timeZone: "America/Los_Angeles" },
      end: { dateTime: end.toISOString(), timeZone: "America/Los_Angeles" },
    });

    if (task.google_event_id) {
      const res = await gFetch(
        account,
        `/calendars/${calId}/events/${encodeURIComponent(task.google_event_id)}`,
        { method: "PATCH", body },
      );
      if (res.ok) {
        await logSync("google", "mirror-update", "ok", undefined, task.user_id);
        return json({ ok: true });
      }
      if (res.status !== 404 && res.status !== 410) {
        throw new Error(`mirror update failed: ${res.status} ${await res.text()}`);
      }
      // fall through: event vanished on Google's side — recreate
    }

    const createRes = await gFetch(account, `/calendars/${calId}/events`, {
      method: "POST",
      body,
    });
    if (!createRes.ok) throw new Error(`mirror create failed: ${createRes.status} ${await createRes.text()}`);
    const created = await createRes.json();
    await admin.from("tasks").update({ google_event_id: created.id }).eq("id", task.id);
    await logSync("google", "mirror-create", "ok", undefined, task.user_id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("google", "mirror", "error", msg);
    return json({ error: msg }, 500);
  }
});
