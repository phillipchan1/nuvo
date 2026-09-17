// Midnight rollover — the trust-critical feature. Every incomplete task with
// do_date < today (LA) moves to today, loses its time block (the hour was for
// a day that has passed — it lands in anytime until you place it), keeps its
// duration, and gains a roll count. Mirror events for rolled blocks are
// removed from the Nuvo mirror calendar (the slot has passed, so the block
// on the user's phone is a lie).
//
// Invoked by pg_cron at 00:05 LA and defensively by the client on the first
// app open of a new day. Idempotent: a second run on the same day is a no-op.
import { admin, handleOptions, json, logSync, readSecret, todayLA } from "../_shared/admin.ts";
import { deleteMirror, resolveMirrorTarget, type MirrorTarget } from "../_shared/mirrorTargets.ts";

type MirrorRow = { id: string; user_id: string; google_event_id?: string | null };

async function teardownMirrors(rows: MirrorRow[]) {
  // One target per user, resolved once — resolveMirrorTarget can stand a
  // CalDAV calendar up, and doing that per row would be a request storm.
  const targets = new Map<string, MirrorTarget | null>();
  for (const task of rows) {
    if (!targets.has(task.user_id)) {
      try {
        targets.set(task.user_id, await resolveMirrorTarget(task.user_id, readSecret));
      } catch {
        targets.set(task.user_id, null);
      }
    }
    const target = targets.get(task.user_id);
    if (!target) continue;
    // Google needs the stored id; iCloud derives the resource from the task id.
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
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const today = todayLA();

    const { data: rolled, error } = await admin.rpc("rollover_tasks", { p_today: today });
    if (error) throw error;

    // deno-lint-ignore no-explicit-any
    const rolledTasks = (rolled ?? []) as any[];
    await teardownMirrors(rolledTasks);

    // Untimed planned work must not keep a mirror hour — D-141's heal (and any
    // other drift) leaves google_event_id set after start_time is cleared, and
    // nothing else reconciles until the row is edited.
    const { data: stray } = await admin
      .from("tasks")
      .select("id, user_id, google_event_id")
      .is("start_time", null)
      .not("google_event_id", "is", null)
      .in("status", ["inbox", "planned"]);
    const rolledIds = new Set(rolledTasks.map((t) => t.id as string));
    await teardownMirrors((stray ?? []).filter((t) => !rolledIds.has(t.id)));

    // Record the run so the client-side fallback knows today is covered.
    await admin.from("user_settings").update({ last_rollover_date: today }).neq("last_rollover_date", today);
    await admin.from("user_settings").update({ last_rollover_date: today }).is("last_rollover_date", null);

    await logSync("app", "rollover", "ok", `rolled ${(rolled ?? []).length} tasks`);
    return json({ ok: true, rolled: (rolled ?? []).length, today });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("app", "rollover", "error", msg);
    return json({ error: msg }, 500);
  }
});
