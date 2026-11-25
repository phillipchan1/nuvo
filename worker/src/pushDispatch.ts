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
  type PushResult,
  type PushSubscriptionRow,
} from "./lib/webpush.ts";
import { apnsConfigured, apnsSelfTest, isApnsEndpoint, sendApns, type ApnsMessage } from "./lib/apns.ts";
import { buildReminderAnchors, REMINDER_WINDOW_MS } from "../../supabase/functions/_shared/reminderAnchors.ts";
import { PUSH_HORIZON_MS } from "./cronGate.ts";
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
  /** Only these accounts (the cron gate's list). Omitted = every account with a device. */
  userIds?: string[];
}

export interface PushDispatchResult {
  ok: true;
  configured: boolean;
  accounts: number;
  considered: number;
  notified: number;
  /**
   * Per account looked at: the next instant push-dispatch must look again
   * (ms), or null when nothing can fire for it. The cron gate holds these so a
   * quiet minute never asks Postgres (D-239).
   */
  next: Record<string, number | null>;
  selfTest?: Awaited<ReturnType<typeof webPushSelfTest>> & {
    /** The native iPhone transport (D-258), checked the same way. */
    apns?: Awaited<ReturnType<typeof apnsSelfTest>>;
  };
}

type SettingsRow = {
  user_id: string;
  reminder_prefs: unknown;
  time_zone: string | null;
};

export async function runPushDispatch(
  sql: Sql,
  env: Env,
  opts: PushDispatchOpts = {},
): Promise<PushDispatchResult> {
  const configured = webPushConfigured(env) || apnsConfigured(env);
  if (opts.selfTest) {
    return {
      ok: true,
      configured,
      accounts: 0,
      considered: 0,
      notified: 0,
      next: {},
      selfTest: { ...(await webPushSelfTest(env, opts.clientPublicKey)), apns: await apnsSelfTest(env) },
    };
  }

  // Only accounts that can actually be notified: reminders on AND at least one
  // device. Listing used to pull `hidden_events` (tens of KB) for every user
  // with a prefs blob, then load two days of events for people with no
  // subscription at all (D-249). Hidden events load per user below.
  // The minute cron must not reach this SELECT on a quiet minute: CronGate
  // skips it, and the fail-open path runs it at most every 5 minutes.
  const only = opts.userIds;
  if (only && !only.length) return { ok: true, configured, accounts: 0, considered: 0, notified: 0, next: {} };
  const settingsRows = (only
    ? await sql`
      SELECT s.user_id, s.reminder_prefs, s.time_zone
      FROM user_settings s
      WHERE (s.reminder_prefs->>'enabled') = 'true'
        AND s.user_id = ANY(${only})
        AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = s.user_id)
    `
    : await sql`
      SELECT s.user_id, s.reminder_prefs, s.time_zone
      FROM user_settings s
      WHERE (s.reminder_prefs->>'enabled') = 'true'
        AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = s.user_id)
    `) as SettingsRow[];

  const accounts = settingsRows
    .map((row) => ({ row, prefs: normalizeReminderPrefs(row.reminder_prefs) }))
    .filter(({ prefs }) => prefs.enabled);

  // Asked about but nothing can fire for them: tell the gate to stop asking.
  const next: Record<string, number | null> = {};
  for (const user of only ?? []) next[user] = null;

  if (!accounts.length) {
    return { ok: true, configured, accounts: 0, considered: 0, notified: 0, next };
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
    // One user's failure (bad row, DB blip) must not silence everyone after them.
    try {
      const out = await dispatchForUser(sql, env, opts, row, prefs, {
        nowMs, windowStart, windowEnd, dateStart, dateEnd, eventLookback,
      });
      considered += out.considered;
      notified += out.notified;
      next[row.user_id] = out.next;
    } catch (err) {
      // Look again next minute, as the ungated cron would have.
      next[row.user_id] = nowMs + RETRY_MS;
      console.error("[push-dispatch] one user failed", err instanceof Error ? err.name : "error");
    }
  }

  // A row only when something was sent. This used to write a heartbeat every
  // minute, which nothing reads and which made every quiet minute a write.
  if (notified > 0) {
    try {
      await sql`
        INSERT INTO sync_log (provider, operation, status, user_id)
        VALUES ('push', 'dispatch', 'ok', NULL)
      `;
    } catch {
      /* ignore */
    }
  }

  return { ok: true, configured, accounts: accounts.length, considered, notified, next };
}

const RETRY_MS = 60_000;

/**
 * When this account next needs a look: its earliest reminder not yet due on
 * this run (due = fireAt + the dispatch lag, as `dueNow` reads it), never past
 * the planning horizon, and next minute when a send must be retried.
 */
export function nextLookAt(plan: PlannedReminder[], nowMs: number, retry: boolean): number {
  let best = nowMs + PUSH_HORIZON_MS;
  if (retry) best = Math.min(best, nowMs + RETRY_MS);
  for (const r of plan) {
    const dueAt = r.fireAtMs + DISPATCH_LAG_MS;
    if (dueAt > nowMs && dueAt < best) best = dueAt;
  }
  return best;
}

type DispatchWindow = {
  nowMs: number;
  windowStart: string;
  windowEnd: string;
  dateStart: string;
  dateEnd: string;
  eventLookback: string;
};

async function dispatchForUser(
  sql: Sql,
  env: Env,
  opts: PushDispatchOpts,
  row: SettingsRow,
  prefs: ReturnType<typeof normalizeReminderPrefs>,
  w: DispatchWindow,
): Promise<{ considered: number; notified: number; next: number | null }> {
  const { nowMs, windowStart, windowEnd, dateStart, dateEnd, eventLookback } = w;
  let considered = 0;
  let notified = 0;
  const userId = row.user_id;
  // Date-only anchors (deadline, do_date) resolve in the user's zone (±14h):
  // a day of slack each side of the window — never every deadline ever set,
  // which filled LIMIT 500 and silently dropped the near ones.
  const [tasks, slots, events, subscriptions, overrides, hiddenRow] = await Promise.all([
    sql`
      SELECT id, title, status, start_time, deadline, do_date
      FROM tasks
      WHERE user_id = ${userId}
        AND parent_task_id IS NULL
        AND status NOT IN ('done', 'trashed')
        AND (
          (start_time IS NOT NULL AND start_time >= ${windowStart} AND start_time <= ${windowEnd})
          OR (deadline IS NOT NULL AND deadline >= ${dateStart}::date - 1 AND deadline <= ${dateEnd}::date + 1)
          OR (do_date IS NOT NULL AND do_date >= ${dateStart}::date - 1 AND do_date <= ${dateEnd}::date + 1)
        )
      ORDER BY LEAST(start_time, deadline::timestamptz, do_date::timestamptz) NULLS LAST, id
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
    sql`
      SELECT hidden_events
      FROM user_settings
      WHERE user_id = ${userId}
    `,
  ]);

  const subs = (subscriptions as unknown as PushSubscriptionRow[]).filter((sub) => sendable(env, sub));
  if (!subs.length) return { considered, notified, next: null };

  const hiddenEvents = (hiddenRow[0] as { hidden_events: { key: string }[] | null } | undefined)?.hidden_events;
  const hiddenKeys = new Set((hiddenEvents ?? []).map((h) => h.key));
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
  let retry = false;

  for (const reminder of due) {
    const won = await claim(sql, userId, reminder);
    if (!won) continue;
    let sent: PushOutcome;
    try {
      sent = await push(sql, env, userId, subs, reminder, opts.fetchImpl ?? testFetch);
    } catch (err) {
      await release(sql, userId, reminder).catch(() => undefined);
      throw err;
    }
    // Every device failed transiently (5xx, network): give the claim back so
    // the next minute retries, inside the reminder's grace. A gone (410)
    // device keeps the claim — there is nothing left to retry to.
    if (sent.delivered === 0 && sent.transient > 0) {
      await release(sql, userId, reminder);
      retry = true;
      continue;
    }
    notified += 1;
  }
  return { considered, notified, next: nextLookAt(plan, nowMs, retry) };
}

function fireAtIso(r: PlannedReminder): string {
  return new Date(Math.floor(r.fireAtMs / 1000) * 1000).toISOString();
}

async function release(sql: Sql, userId: string, r: PlannedReminder): Promise<void> {
  await sql`
    DELETE FROM reminder_deliveries
    WHERE user_id = ${userId} AND reminder_key = ${r.key} AND fire_at = ${fireAtIso(r)}
  `;
}

async function claim(sql: Sql, userId: string, r: PlannedReminder): Promise<boolean> {
  const fireAt = fireAtIso(r);
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
): Promise<PushOutcome> {
  const outcome: PushOutcome = { delivered: 0, transient: 0 };
  const message: ApnsMessage = {
    title: r.title,
    body: r.body,
    key: r.key,
    url: r.targetKind === "task" ? `/?reminder=task&id=${r.targetId}` : "/",
  };

  for (const sub of subs) {
    const result = await sendTo(env, sub, message, fetchImpl ?? fetch);
    if (result.gone) {
      await sql`
        DELETE FROM push_subscriptions
        WHERE id = ${sub.id}
          AND user_id = ${userId}
      `;
      continue;
    }
    if (result.ok) {
      outcome.delivered += 1;
      await sql`
        UPDATE push_subscriptions
        SET last_seen_at = now(), failure_count = 0
        WHERE id = ${sub.id}
          AND user_id = ${userId}
      `;
    } else {
      outcome.transient += 1;
      await sql`
        UPDATE push_subscriptions
        SET failure_count = COALESCE(failure_count, 0) + 1
        WHERE id = ${sub.id}
          AND user_id = ${userId}
      `;
    }
  }
  return outcome;
}

type PushOutcome = { delivered: number; transient: number };

/**
 * Can this deployment reach this device at all? A native iPhone (APNs) row
 * needs the APNs secrets; every other row needs VAPID. A device we can't reach
 * must not count as an audience: otherwise the dispatcher would CLAIM a
 * reminder it then can't deliver, and an app opening a minute later would find
 * it already "told" and stay silent.
 */
export function sendable(env: Env, sub: PushSubscriptionRow): boolean {
  return isApnsEndpoint(sub.endpoint) ? apnsConfigured(env) : webPushConfigured(env);
}

/** One message, one device, whichever transport its endpoint names (D-258). */
async function sendTo(
  env: Env,
  sub: PushSubscriptionRow,
  message: ApnsMessage,
  fetchImpl: FetchLike,
): Promise<PushResult> {
  if (isApnsEndpoint(sub.endpoint)) return sendApns(env, sub, message, fetchImpl);
  return sendWebPush(
    env,
    sub,
    JSON.stringify({ title: message.title, body: message.body, key: message.key, url: message.url ?? "/" }),
    fetchImpl,
  );
}

/**
 * One-off push to every device of one planner account (billing's referral
 * notices). Same send / prune / failure-count path as reminders. The caller
 * resolves the planner id and is itself behind the cutover flip.
 */
export async function pushToAccount(
  sql: Sql,
  env: Env,
  userId: string,
  message: { title: string; body: string; key: string; url?: string },
  fetchImpl?: FetchLike,
): Promise<number> {
  if (!webPushConfigured(env) && !apnsConfigured(env)) return 0;
  const subs = ((await sql`
    SELECT id, endpoint, p256dh, auth, failure_count
    FROM push_subscriptions
    WHERE user_id = ${userId}
  `) as unknown as PushSubscriptionRow[]).filter((sub) => sendable(env, sub));
  let sent = 0;
  for (const sub of subs) {
    const result = await sendTo(env, sub, message, fetchImpl ?? testFetch ?? fetch);
    if (result.gone) {
      await sql`DELETE FROM push_subscriptions WHERE id = ${sub.id} AND user_id = ${userId}`;
      continue;
    }
    if (result.ok) {
      sent += 1;
      await sql`
        UPDATE push_subscriptions SET last_seen_at = now(), failure_count = 0
        WHERE id = ${sub.id} AND user_id = ${userId}
      `;
    } else {
      await sql`
        UPDATE push_subscriptions SET failure_count = COALESCE(failure_count, 0) + 1
        WHERE id = ${sub.id} AND user_id = ${userId}
      `;
    }
  }
  return sent;
}

export const PUSH_CRON_JOBS = new Set(["push-dispatch", "nuvo-push-dispatch"]);
