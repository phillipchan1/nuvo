/**
 * Background reminders — the half that runs when nothing is open.
 *
 * Cron iterates `users` (via user_settings with reminders on), then every
 * query is scoped by that user_id. It decides nothing: anchors and fire
 * instants come from the shared kernel.
 */
import type { Sql } from "./db.ts";
import type { Env } from "./env.ts";
import {
  sendWebPush,
  webPushConfigured,
  webPushSelfTest,
  type FetchLike,
  type PushSubscriptionRow,
} from "./lib/webpush.ts";
import { buildReminderAnchors, REMINDER_WINDOW_MS } from "../../supabase/functions/_shared/reminderAnchors.ts";
import {
  dueNow,
  leadsFromRow,
  normalizeReminderPrefs,
  planReminders,
  reminderKey,
  type PlannedReminder,
} from "../../supabase/functions/_shared/reminderRules.ts";

const DISPATCH_LAG_MS = 30_000;
const WINDOW_MS = REMINDER_WINDOW_MS;

let testFetch: FetchLike | undefined;

/** Test-only: mock the web-push / Google / CalDAV endpoint. */
export function installPushFetchForTests(fn?: FetchLike): () => void {
  testFetch = fn;
  return () => {
    testFetch = undefined;
  };
}

export function workerTestFetch(): FetchLike | undefined {
  return testFetch;
}

export interface PushDispatchOpts {
  nowMs?: number;
  fetchImpl?: FetchLike;
  selfTest?: boolean;
  clientPublicKey?: string;
}

export interface PushDispatchResult {
  ok: true;
  configured: boolean;
  accounts: number;
  considered: number;
  notified: number;
  selfTest?: Awaited<ReturnType<typeof webPushSelfTest>>;
}

type SettingsRow = {
  user_id: string;
  reminder_prefs: unknown;
  hidden_events: { key: string }[] | null;
  time_zone: string | null;
};

export async function runPushDispatch(
  sql: Sql,
  env: Env,
  opts: PushDispatchOpts = {},
): Promise<PushDispatchResult> {
  const configured = webPushConfigured(env);
  if (opts.selfTest) {
    return {
      ok: true,
      configured,
      accounts: 0,
      considered: 0,
      notified: 0,
      selfTest: await webPushSelfTest(env, opts.clientPublicKey),
    };
  }

  const settingsRows = (await sql`
    SELECT user_id, reminder_prefs, hidden_events, time_zone
    FROM user_settings
    WHERE reminder_prefs IS NOT NULL
  `) as SettingsRow[];

  const accounts = settingsRows
    .map((row) => ({ row, prefs: normalizeReminderPrefs(row.reminder_prefs) }))
    .filter(({ prefs }) => prefs.enabled);

  if (!accounts.length) {
    return { ok: true, configured, accounts: 0, considered: 0, notified: 0 };
  }

  const nowMs = opts.nowMs ?? Date.now();
  const windowStart = new Date(nowMs - 60 * 60_000).toISOString();
  const windowEnd = new Date(nowMs + WINDOW_MS).toISOString();
  const dateStart = windowStart.slice(0, 10);
  const dateEnd = windowEnd.slice(0, 10);
  const eventLookback = new Date(nowMs - 2 * 24 * 60 * 60_000).toISOString();

  let notified = 0;
  let considered = 0;

  for (const { row, prefs } of accounts) {
    const userId = row.user_id;
    const [tasks, slots, events, subscriptions, overrides] = await Promise.all([
      sql`
        SELECT id, title, status, start_time, deadline, do_date
        FROM tasks
        WHERE user_id = ${userId}
          AND parent_task_id IS NULL
          AND status NOT IN ('done', 'trashed')
          AND (
            (start_time IS NOT NULL AND start_time >= ${windowStart} AND start_time <= ${windowEnd})
            OR deadline IS NOT NULL
            OR (do_date IS NOT NULL AND do_date >= ${dateStart} AND do_date <= ${dateEnd})
          )
        LIMIT 500
      `,
      sql`
        SELECT id, title, start_time
        FROM slots
        WHERE user_id = ${userId}
          AND start_time >= ${windowStart}
          AND start_time <= ${windowEnd}
        LIMIT 200
      `,
      sql`
        SELECT id, account_id, provider_event_id, title, start_at, all_day, location, self_rsvp, recurring_event_id
        FROM external_events
        WHERE user_id = ${userId}
          AND start_at >= ${eventLookback}
          AND start_at <= ${windowEnd}
        LIMIT 500
      `,
      sql`
        SELECT id, endpoint, p256dh, auth, failure_count
        FROM push_subscriptions
        WHERE user_id = ${userId}
      `,
      sql`
        SELECT target_kind, anchor, target_id, event_key, leads
        FROM reminders
        WHERE user_id = ${userId}
      `,
    ]);

    const subs = subscriptions as unknown as PushSubscriptionRow[];
    if (!subs.length) continue;

    const hiddenKeys = new Set((row.hidden_events ?? []).map((h) => h.key));
    const anchors = buildReminderAnchors({
      tasks: tasks as never,
      slots: slots as never,
      events: events as never,
      hiddenKeys,
      deadlineTimeMinutes: prefs.deadline_time_minutes,
      timeZone: row.time_zone,
      nowMs,
      windowMs: WINDOW_MS,
    });

    const overrideRows = (overrides as unknown as {
      target_kind: "task" | "slot" | "event";
      anchor: "start" | "deadline";
      target_id: string | null;
      event_key: string | null;
      leads: number[] | null;
    }[]).map((r) => ({
      key: reminderKey(
        r.target_kind,
        r.target_kind === "event" ? (r.event_key ?? "") : (r.target_id ?? ""),
        r.anchor,
      ),
      leads: leadsFromRow(r),
    }));

    const plan = planReminders(anchors, prefs, overrideRows);
    const due = dueNow(plan, nowMs - DISPATCH_LAG_MS, new Set());
    considered += due.length;

    for (const reminder of due) {
      const won = await claim(sql, userId, reminder);
      if (!won) continue;
      await push(sql, env, userId, subs, reminder, opts.fetchImpl ?? testFetch);
      notified += 1;
    }
  }

  try {
    await sql`
      INSERT INTO sync_log (provider, operation, status, user_id)
      VALUES ('push', 'dispatch', 'ok', NULL)
    `;
  } catch {
    /* ignore */
  }

  return { ok: true, configured, accounts: accounts.length, considered, notified };
}

async function claim(sql: Sql, userId: string, r: PlannedReminder): Promise<boolean> {
  const fireAt = new Date(Math.floor(r.fireAtMs / 1000) * 1000).toISOString();
  const rows = await sql`
    INSERT INTO reminder_deliveries (user_id, reminder_key, fire_at, channel)
    VALUES (${userId}, ${r.key}, ${fireAt}, 'push')
    ON CONFLICT (user_id, reminder_key, fire_at) DO NOTHING
    RETURNING reminder_key
  `;
  return rows.length > 0;
}

async function push(
  sql: Sql,
  env: Env,
  userId: string,
  subs: PushSubscriptionRow[],
  r: PlannedReminder,
  fetchImpl?: FetchLike,
): Promise<void> {
  const payload = JSON.stringify({
    title: r.title,
    body: r.body,
    key: r.key,
    url: r.targetKind === "task" ? `/?reminder=task&id=${r.targetId}` : "/",
  });

  for (const sub of subs) {
    const result = await sendWebPush(env, sub, payload, fetchImpl ?? fetch);
    if (result.gone) {
      await sql`
        DELETE FROM push_subscriptions
        WHERE id = ${sub.id}
          AND user_id = ${userId}
      `;
      continue;
    }
    if (result.ok) {
      await sql`
        UPDATE push_subscriptions
        SET last_seen_at = now(), failure_count = 0
        WHERE id = ${sub.id}
          AND user_id = ${userId}
      `;
    } else {
      await sql`
        UPDATE push_subscriptions
        SET failure_count = COALESCE(failure_count, 0) + 1
        WHERE id = ${sub.id}
          AND user_id = ${userId}
      `;
    }
  }
}

export const PUSH_CRON_JOBS = new Set(["push-dispatch", "nuvo-push-dispatch"]);
