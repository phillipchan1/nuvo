// Midnight rollover — the trust-critical feature. Every incomplete task with
// do_date < today (LA) moves to today, loses its time block, keeps its
// duration, and gains a roll count. Mirror events for rolled blocks are
// removed from the Nuvo Google calendar (the slot has passed).
//
// Invoked by pg_cron at 00:05 LA and defensively by the client on the first
// app open of a new day. Idempotent: a second run on the same day is a no-op.
import { admin, handleOptions, json, logSync, todayLA } from "../_shared/admin.ts";
import { type GoogleAccount, gFetch } from "../_shared/google.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const today = todayLA();

    const { data: rolled, error } = await admin.rpc("rollover_tasks", { p_today: today });
    if (error) throw error;

    // Remove mirror events for blocks whose slot has passed
    // deno-lint-ignore no-explicit-any
    const withMirror = ((rolled ?? []) as any[]).filter((t) => t.google_event_id);
    if (withMirror.length > 0) {
      const { data: accounts } = await admin
        .from("calendar_accounts")
        .select("*")
        .eq("provider", "google")
        .not("mirror_calendar_id", "is", null);
      const byUser = new Map(
        ((accounts ?? []) as GoogleAccount[]).map((a) => [a.user_id, a]),
      );
      for (const task of withMirror) {
        const account = byUser.get(task.user_id);
        if (!account) continue;
        try {
          await gFetch(
            account,
            `/calendars/${encodeURIComponent(account.mirror_calendar_id!)}/events/${encodeURIComponent(task.google_event_id)}`,
            { method: "DELETE" },
          );
        } catch (e) {
          await logSync(
            "google",
            "rollover-mirror-delete",
            "error",
            e instanceof Error ? e.message : String(e),
            task.user_id,
          );
        }
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
