/**
 * Background reminders — the half that runs when nothing is open.
 *
 * Fires every minute from pg_cron (migration 61). For each account with
 * reminders enabled it rebuilds the same anchors the app would build, asks the
 * same kernel what fires, CLAIMS anything the app hasn't already, and pushes.
 *
 * ── The three rules this function exists to obey ────────────────────────────
 *
 * 1. **It decides nothing.** Every word it sends comes from
 *    `_shared/reminderRules.ts`; the anchors come from
 *    `_shared/reminderAnchors.ts`. That is not tidiness — the app and this
 *    function race for the same claim key, and a claim key is built from the
 *    fire instant. Two implementations disagreeing by one second would both
 *    "win" and the user would be told twice.
 *
 * 2. **An open app wins.** It only looks at reminders at least `DISPATCH_LAG_MS`
 *    past due, giving a foreground client time to claim first. So someone
 *    sitting in front of Nuvo gets the in-app notification and no push at all.
 *
 * 3. **It cannot nudge.** There is no path here that reads a backlog, a count,
 *    or how long since you last opened the app. It reads commitments with a
 *    time on them. If a future change needs an input the kernel doesn't have,
 *    that is the signal to stop (D-102, D-105).
 */

import { admin, handleOptions, json, logSync } from "../_shared/admin.ts";
import {
  dueNow,
  normalizeReminderPrefs,
  planReminders,
  REMINDER_GRACE_MS,
  type PlannedReminder,
} from "../_shared/reminderRules.ts";
import { buildReminderAnchors, REMINDER_WINDOW_MS } from "../_shared/reminderAnchors.ts";
import { sendWebPush, webPushConfigured, webPushSelfTest, type PushSubscriptionRow } from "../_shared/webpush.ts";

/**
 * How far past due a reminder must be before the server will claim it.
 *
 * The head start an open app gets. Long enough that a foreground client
 * reliably wins the claim (it fires within a second of the instant), short
 * enough that a push still lands inside the lead the user chose — 30s off a
 * 10-minute warning is not a different warning.
 */
const DISPATCH_LAG_MS = 30_000;

/** Anchors are built from a bounded slice of each account's data. Two days of
 *  runway covers the longest lead; nothing here scans a whole calendar. */
const WINDOW_MS = REMINDER_WINDOW_MS;

interface SettingsRow {
  user_id: string;
  reminder_prefs: unknown;
  hidden_events: { key: string }[] | null;
  time_zone: string | null;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const startedAt = Date.now();
  let notified = 0;
  let considered = 0;

  try {
    // `{"selfTest":true}` — prove the VAPID pair actually signs, on demand.
    // Not run on the cron path: it is a setup question, asked once, and a
    // per-minute ECDSA for nobody's benefit is the kind of thing that quietly
    // becomes load. See docs/push-notifications.md §4.
    const body = await req.json().catch(() => ({}));
    const probe = body as { selfTest?: boolean; clientPublicKey?: string };
    if (probe?.selfTest) {
      return json({ ok: true, selfTest: await webPushSelfTest(probe.clientPublicKey) });
    }

    // The opening read is the cheap one: almost nobody has reminders on, and
    // those who don't cost a single indexed row each.
    const { data: settingsRows, error: settingsErr } = await admin
      .from("user_settings")
      .select("user_id, reminder_prefs, hidden_events, time_zone")
      .not("reminder_prefs", "is", null);
    if (settingsErr) throw new Error(settingsErr.message);

    const accounts = ((settingsRows ?? []) as SettingsRow[])
      .map((row) => ({ row, prefs: normalizeReminderPrefs(row.reminder_prefs) }))
      .filter(({ prefs }) => prefs.enabled);

    // Reported on every response, because "are the VAPID secrets actually set?"
    // is otherwise unanswerable without a phone and a six-minute wait — the
    // secrets live only in the function's env, so the function is the only thing
    // that can say. See docs/push-notifications.md §4.
    const configured = webPushConfigured();

    if (!accounts.length) {
      return json({ ok: true, configured, accounts: 0, notified: 0 });
    }

    const nowMs = Date.now();
    const windowStart = new Date(nowMs - 60 * 60_000).toISOString();
    const windowEnd = new Date(nowMs + WINDOW_MS).toISOString();

    for (const { row, prefs } of accounts) {
      const userId = row.user_id;

      // Only the slices that could hold an anchor. Steps are excluded for the
      // same reason every other task read excludes them (migration 60).
      const [tasksRes, slotsRes, eventsRes, subsRes, overridesRes] = await Promise.all([
        admin
          .from("tasks")
          .select("id, title, status, start_time, deadline")
          .eq("user_id", userId)
          .is("parent_task_id", null)
          .not("status", "in", '("done","trashed")')
          .or(`and(start_time.gte.${windowStart},start_time.lte.${windowEnd}),deadline.not.is.null`)
          .limit(500),
        admin
          .from("slots")
          .select("id, title, start_time")
          .eq("user_id", userId)
          .gte("start_time", windowStart)
          .lte("start_time", windowEnd)
          .limit(200),
        admin
          .from("external_events")
          .select("id, account_id, provider_event_id, title, start_at, all_day, location, self_rsvp, recurring_event_id")
          .eq("user_id", userId)
          .gte("start_at", windowStart)
          .lte("start_at", windowEnd)
          .limit(500),
        admin
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("user_id", userId),
        admin
          .from("reminders")
          .select("target_kind, anchor, target_id, event_key, lead_minutes")
          .eq("user_id", userId),
      ]);

      const subscriptions = (subsRes.data ?? []) as PushSubscriptionRow[];
      // No device to push to: claiming would silence the app for nothing.
      if (!subscriptions.length) continue;

      const hiddenKeys = new Set((row.hidden_events ?? []).map((h) => h.key));
      const anchors = buildReminderAnchors({
        tasks: (tasksRes.data ?? []) as never,
        slots: (slotsRes.data ?? []) as never,
        events: (eventsRes.data ?? []) as never,
        hiddenKeys,
        deadlineTimeMinutes: prefs.deadline_time_minutes,
        // Never a hardcoded zone. Null means UTC, which is at least honest —
        // see the comment on `user_settings.time_zone`.
        timeZone: row.time_zone,
        nowMs,
        windowMs: WINDOW_MS,
      });

      const overrides = ((overridesRes.data ?? []) as {
        target_kind: "task" | "slot" | "event";
        anchor: "start" | "deadline";
        target_id: string | null;
        event_key: string | null;
        lead_minutes: number | null;
      }[]).map((r) => ({
        key: `${r.target_kind}:${r.target_kind === "event" ? (r.event_key ?? "") : (r.target_id ?? "")}:${r.anchor}`,
        lead_minutes: r.lead_minutes,
      }));

      const plan = planReminders(anchors, prefs, overrides);
      // Give an open app its head start, then apply the same grace window the
      // client uses: a reminder staler than that is no longer a *now* signal.
      const due = dueNow(plan, nowMs - DISPATCH_LAG_MS, new Set(), REMINDER_GRACE_MS);
      considered += due.length;

      for (const reminder of due) {
        const won = await claim(userId, reminder);
        if (!won) continue; // an open app already told them
        await push(userId, subscriptions, reminder);
        notified += 1;
      }
    }

    await logSync("push", "dispatch", "ok", `${notified}/${considered} in ${Date.now() - startedAt}ms`);
    return json({ ok: true, configured, accounts: accounts.length, considered, notified });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logSync("push", "dispatch", "error", message);
    return json({ error: message }, 500);
  }
});

/**
 * Take the reminder, or find out somebody else did.
 *
 * The service role bypasses RLS, so the insert names `user_id` directly rather
 * than going through the `claim_reminder` RPC (which reads `auth.uid()`). The
 * unique key is the same, so the race is the same race.
 */
async function claim(userId: string, r: PlannedReminder): Promise<boolean> {
  const fireAt = new Date(Math.floor(r.fireAtMs / 1000) * 1000).toISOString();
  const { data, error } = await admin
    .from("reminder_deliveries")
    .upsert(
      { user_id: userId, reminder_key: r.key, fire_at: fireAt, channel: "push" },
      { onConflict: "user_id,reminder_key,fire_at", ignoreDuplicates: true },
    )
    .select("reminder_key");
  if (error) return false;
  // `ignoreDuplicates` returns the row only when this call inserted it.
  return (data?.length ?? 0) > 0;
}

/** Deliver to every device this person has. One claim, several screens — the
 *  claim is per PERSON, so this is a fan-out, not a second decision. */
async function push(userId: string, subs: PushSubscriptionRow[], r: PlannedReminder) {
  const payload = JSON.stringify({
    title: r.title,
    body: r.body,
    key: r.key,
    url: r.targetKind === "task" ? `/?reminder=task&id=${r.targetId}` : "/",
  });

  for (const sub of subs) {
    const result = await sendWebPush(sub, payload);
    if (result.gone) {
      // 404/410 means the endpoint no longer exists — the browser was
      // uninstalled or the subscription revoked. Retrying forever is how a
      // dispatcher slowly turns into a source of load with no reader.
      await admin.from("push_subscriptions").delete().eq("id", sub.id);
      continue;
    }
    await admin
      .from("push_subscriptions")
      .update(
        result.ok
          ? { last_seen_at: new Date().toISOString(), failure_count: 0 }
          : { failure_count: (sub.failure_count ?? 0) + 1 },
      )
      .eq("id", sub.id);
  }
  void userId;
}
