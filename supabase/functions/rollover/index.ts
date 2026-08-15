// Midnight rollover — the trust-critical feature. Every incomplete task with
// do_date < today (LA) moves to today, loses its time block, keeps its
// duration, and gains a roll count. Mirror events for rolled blocks are
// removed from the Nuvo mirror calendar, whichever provider holds it (the slot
// has passed, so the block on the user's phone is a lie).
//
// Invoked by pg_cron at 00:05 LA and defensively by the client on the first
// app open of a new day. Idempotent: a second run on the same day is a no-op.
import { admin, handleOptions, json, logSync, readSecret, todayLA } from "../_shared/admin.ts";
import { deleteMirror, resolveMirrorTarget, type MirrorTarget } from "../_shared/mirrorTargets.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const today = todayLA();

    const { data: rolled, error } = await admin.rpc("rollover_tasks", { p_today: today });
    if (error) throw error;

    // Remove mirror events for blocks whose slot has passed.
    //
    // NOT filtered on google_event_id any more: an iCloud mirror stores no id
    // (its CalDAV resource is derived from the task id — see _shared/mirror.ts),
    // so the old filter rolled the task and left yesterday's block sitting on
    // an iCloud user's phone forever. Every rolled task is offered to the
    // teardown; where there is no mirror it is a no-op.
    // deno-lint-ignore no-explicit-any
    const rolledTasks = (rolled ?? []) as any[];
    // One target per user, resolved once — resolveMirrorTarget can stand a
    // CalDAV calendar up, and doing that per row would be a request storm.
    const targets = new Map<string, MirrorTarget | null>();
    for (const task of rolledTasks) {
      if (!targets.has(task.user_id)) {
        try {
          targets.set(task.user_id, await resolveMirrorTarget(task.user_id, readSecret));
        } catch {
          targets.set(task.user_id, null);
        }
      }
      const target = targets.get(task.user_id);
      if (!target) continue;
      if (target.provider === "google" && !task.google_event_id) continue;
      try {
        await deleteMirror(target, "task", task.id, task.google_event_id);
      } catch (e) {
        await logSync(
          target.provider,
          "rollover-mirror-delete",
          "error",
          e instanceof Error ? e.message : String(e),
          task.user_id,
        );
      }
      if (task.google_event_id) {
        await admin.from("tasks").update({ google_event_id: null }).eq("id", task.id);
      }
    }

    // Record the run so the client-side fallback knows today is covered.
    await admin.from("user_settings").update({ last_rollover_date: today }).neq("last_rollover_date", today);
    // (covers rows where last_rollover_date is null too)
    await admin.from("user_settings").update({ last_rollover_date: today }).is("last_rollover_date", null);

    await logSync("app", "rollover", "ok", `rolled ${(rolled ?? []).length} tasks`);
    return json({ ok: true, rolled: (rolled ?? []).length, today });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("app", "rollover", "error", msg);
    return json({ error: msg }, 500);
  }
});
