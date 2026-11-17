/**
 * Worker Cron Triggers + Queue fan-out for jobs that today run on pg_cron.
 *
 * HTTP `/api/cron/:job` still requires CRON_SECRET (constant time). The
 * `scheduled` export is Cloudflare-authenticated and calls the same runners.
 *
 * Ported user-data jobs (rollover, purge-trash, reminder-deliveries-prune,
 * push-dispatch, github-poll, trim-sync-log) iterate `users` then scope
 * by `user_id`. Jobs that must not run beside Supabase `pg_cron` belong
 * in `POST_FLIP_CRON_JOBS` (`cutoverFlip.ts`). `handleCron` / `runCronJob`
 * call `gateCron` before any DB / fetch / queue work. Unset
 * `CUTOVER_FLIPPED` skips with 200. Calendar-dispatch fans out one Queue
 * message per due account so a single isolate does not loop every tenant
 * against Google/Graph/CalDAV (Workers Paid CPU). After the flip the
 * consumer polls Google, M365, iCloud, and ICS. `google-renew`
 * re-watches channels. `push-dispatch` runs per user with the same VAPID
 * pair. Without a queue binding, HTTP calendar-dispatch claims due
 * accounts in-process (PGlite / tests).
 *
 * Projection (flag, not a spend): one send + one consume per due account
 * per minute. At the current ~12 accounts that is ~35k ops/day, inside
 * Workers Paid's included Queue operations. Revisit if account count grows
 * past a few hundred.
 */
import type { Context } from "hono";
import { BLOCKED_CRON_JOBS, stayOnSupabase } from "./blocked.ts";
import { OPEN_CORS, json } from "./cors.ts";
import { bearerToken, cronAuthorized } from "./cron.ts";
import { cutoverSkipBody, gateCron } from "./cutoverFlip.ts";
import { closeSql, openSql, type Sql } from "./db.ts";
import type { Env } from "./env.ts";
import { runGithubPoll, runTrimSyncLog } from "./githubActivity.ts";
import { runIcloudContacts, runIcloudSync } from "./calendar/icloud.ts";
import { runIcsSync } from "./calendar/icsFeed.ts";
import { runM365Sync } from "./calendar/m365.ts";
import { m365Enabled } from "./lib/ms.ts";
import { claimDueAccounts, nextCalendarSyncAt } from "./calendar/store.ts";
import { gatePlan, gatePoke, gateReport, isQuiet, type GateReport, type TickPlan } from "./cronGate.ts";
import { runCalendarDispatch, runGoogleCronJob } from "./google/cron.ts";
import { claimDueGoogleAccounts } from "./google/owned.ts";
import { runGoogleSync } from "./google/sync.ts";
import { WRITE_FROZEN_MESSAGE, writeFrozen } from "./maintenance.ts";
import { requestIo, requireStore, type AppEnv } from "./session.ts";
import { runPushDispatch } from "./pushDispatch.ts";
import { readJson } from "./http.ts";
import { rolloverUserTasks } from "./rollover.ts";

export interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(): void;
}

export interface QueueBatch<T> {
  messages: readonly QueueMessage<T>[];
}

export interface CalendarSyncMessage {
  account_id: string;
  user_id: string;
  provider: string;
}

export interface CronResult {
  job: string;
  status: number;
  stay_on_supabase?: boolean;
  ok?: boolean;
  enqueued?: number;
  rolled?: number;
  deleted?: number;
  skipped?: boolean;
  reason?: string;
}

export const MINUTE_CRON = "* * * * *";

/** cron expression (UTC) → job names. Same tick can run more than one. */
export const CRON_BY_SCHEDULE: Record<string, readonly string[]> = {
  "* * * * *": ["calendar-dispatch", "push-dispatch"],
  "5 7 * * *": ["rollover"],
  "5 8 * * *": ["rollover"],
  "15 9 * * *": ["google-renew"],
  "20 9 * * *": ["github-poll"],
  "0 10 * * SUN": ["trim-sync-log"],
  "30 4 * * *": ["reminder-deliveries-prune"],
  "0 4 * * *": ["purge-trash"],
};

export const ALL_CRON_SCHEDULES = Object.keys(CRON_BY_SCHEDULE);

const JOB_ALIASES: Record<string, string> = {
  "nuvo-calendar-dispatch": "calendar-dispatch",
  "nuvo-push-dispatch": "push-dispatch",
  "nuvo-google-renew": "google-renew",
  "nuvo-google-resubscribe": "google-resubscribe",
  "nuvo-github-poll": "github-poll",
  "nuvo-trim-sync-log": "trim-sync-log",
  "nuvo-reminder-deliveries-prune": "reminder-deliveries-prune",
  "nuvo-purge-trash": "purge-trash",
  "nuvo-rollover-pst": "rollover",
  "nuvo-rollover-pdt": "rollover",
  "prune-reminder-deliveries": "reminder-deliveries-prune",
  "nuvo-m365-poll": "m365-sync",
  "nuvo-icloud-poll": "icloud-sync",
  "nuvo-ics-poll": "ics-sync",
};

export function canonicalCronJob(name: string): string {
  const raw = name.trim().toLowerCase();
  return JOB_ALIASES[raw] ?? raw;
}

export function jobsForSchedule(cron: string): readonly string[] {
  return CRON_BY_SCHEDULE[cron] ?? [];
}

function blocked(job: string): CronResult {
  return { job, status: 501, stay_on_supabase: true };
}

/** Log one tenant's failure without ids or row data, and keep going. */
function logUserFailure(job: string, err: unknown): void {
  console.error(`[cron] ${job}: one user failed`, err instanceof Error ? err.name : "error");
}

function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function runRollover(sql: Sql): Promise<{ rolled: number; today: string; users: number }> {
  const today = todayLA();
  const users = (await sql`SELECT id FROM users`) as { id: string }[];
  let rolled = 0;
  for (const user of users) {
    // One user's failure must not stop everyone after them.
    try {
      // One definition of "what carries" (D-145 / D-147) — see rollover.ts.
      rolled += (await rolloverUserTasks(sql, user.id, today)).length;
    } catch (err) {
      logUserFailure("rollover", err);
    }
  }
  return { rolled, today, users: users.length };
}

async function runPurgeTrash(sql: Sql): Promise<{ deleted: number; users: number }> {
  const users = (await sql`SELECT id FROM users`) as { id: string }[];
  let deleted = 0;
  for (const user of users) {
    try {
      const rows = (await sql`
        DELETE FROM tasks
        WHERE user_id = ${user.id}
          AND status = 'trashed'
          AND COALESCE(trashed_at, updated_at) < now() - interval '30 days'
        RETURNING id
      `) as { id: string }[];
      deleted += rows.length;
    } catch (err) {
      logUserFailure("purge-trash", err);
    }
  }
  return { deleted, users: users.length };
}

async function runReminderPrune(sql: Sql): Promise<{ deleted: number; users: number }> {
  const users = (await sql`SELECT id FROM users`) as { id: string }[];
  let deleted = 0;
  for (const user of users) {
    try {
      const rows = (await sql`
        DELETE FROM reminder_deliveries
        WHERE user_id = ${user.id}
          AND fire_at < now() - interval '2 days'
        RETURNING reminder_key
      `) as { reminder_key: string }[];
      deleted += rows.length;
    } catch (err) {
      logUserFailure("reminder-deliveries-prune", err);
    }
  }
  return { deleted, users: users.length };
}

const DUE_BATCH = 100;

export function otherCalendarProviders(env: Env): string[] {
  return m365Enabled(env) ? ["m365", "icloud", "ics"] : ["icloud", "ics"];
}

// M365 off (no MS_*): its skip never moves next_sync_at, so leaving m365 in
// would re-enqueue the same rows every minute ahead of real work.
//
// Claims (bumps next_sync_at) exactly like the in-process dispatcher, so a
// due account is sent ONCE per interval — not again every minute while its
// message waits in the queue. The consumer's markSyncResult then sets the
// real next time; a lost message just waits out one interval.
export async function enqueueDueCalendarAccounts(sql: Sql, env: Env, pullMs = 0): Promise<number> {
  const queue = env.CALENDAR_SYNC_QUEUE;
  if (!queue) return 0;
  const google = await claimDueGoogleAccounts(sql, DUE_BATCH, pullMs);
  const others = await claimDueAccounts(sql, otherCalendarProviders(env), DUE_BATCH, pullMs);
  const rows = [
    ...google.map((r) => ({ id: r.id, user_id: r.user_id, provider: "google" })),
    ...others.map((a) => ({ id: a.id, user_id: a.user_id, provider: a.provider })),
  ];
  let n = 0;
  for (const row of rows) {
    try {
      await queue.send({
        account_id: row.id,
        user_id: row.user_id,
        provider: row.provider,
      } satisfies CalendarSyncMessage);
      n += 1;
    } catch (err) {
      console.error("[cron] calendar-dispatch: enqueue failed", err instanceof Error ? err.name : "error");
    }
  }
  return n;
}

export async function runCronJob(job: string, env: Env, sql: Sql | null): Promise<CronResult> {
  const name = canonicalCronJob(job);
  if (gateCron(env, name)) {
    return { ...cutoverSkipBody(name), status: 200 };
  }
  if (name === "calendar-dispatch") {
    if (!sql) return blocked(name);
    if (env.CALENDAR_SYNC_QUEUE) {
      const enqueued = await enqueueDueCalendarAccounts(sql, env);
      return { job: name, status: 200, stay_on_supabase: false, enqueued };
    }
    const result = await runCalendarDispatch(sql, env);
    return { job: name, status: 200, stay_on_supabase: false, enqueued: result.ran };
  }
  if (name === "google-renew" || name === "google-resubscribe") {
    if (!sql) return blocked(name);
    await runGoogleCronJob(sql, env, name);
    return { job: name, status: 200, stay_on_supabase: false };
  }
  if (name === "rollover") {
    if (!sql) return blocked(name);
    const out = await runRollover(sql);
    return { job: name, status: 200, stay_on_supabase: false, rolled: out.rolled };
  }
  if (name === "purge-trash") {
    if (!sql) return blocked(name);
    const out = await runPurgeTrash(sql);
    return { job: name, status: 200, stay_on_supabase: false, deleted: out.deleted };
  }
  if (name === "reminder-deliveries-prune") {
    if (!sql) return blocked(name);
    const out = await runReminderPrune(sql);
    return { job: name, status: 200, stay_on_supabase: false, deleted: out.deleted };
  }
  if (name === "push-dispatch") {
    if (!sql) return blocked(name);
    await runPushDispatch(sql, env);
    return { job: name, status: 200, stay_on_supabase: false };
  }
  if (name === "github-poll") {
    if (!sql) return blocked(name);
    const out = await runGithubPoll(sql, env);
    return { job: name, status: 200, stay_on_supabase: false, enqueued: out.synced };
  }
  if (name === "trim-sync-log") {
    if (!sql) return blocked(name);
    const out = await runTrimSyncLog(sql);
    return { job: name, status: 200, stay_on_supabase: false, deleted: out.deleted };
  }
  if (name === "m365-sync") {
    if (!sql) return blocked(name);
    await runM365Sync(sql, env);
    return { job: name, status: 200, stay_on_supabase: false };
  }
  if (name === "icloud-sync") {
    if (!sql) return blocked(name);
    await runIcloudSync(sql, env);
    await runIcloudContacts(sql, env);
    return { job: name, status: 200, stay_on_supabase: false };
  }
  if (name === "ics-sync") {
    if (!sql) return blocked(name);
    await runIcsSync(sql, env);
    return { job: name, status: 200, stay_on_supabase: false };
  }
  return blocked(name);
}

/**
 * The `* * * * *` tick behind the cron gate (D-239). Asks the gate first; a
 * quiet minute returns without opening SQL — Neon is never touched, so its
 * compute can suspend. Otherwise runs calendar-dispatch and / or
 * push-dispatch for exactly what the gate says is due, then reports when each
 * next needs a look. No gate (binding unset, DO error) → both jobs run
 * ungated, as before. `openDb` is called at most once, and only when a job runs.
 */
export async function runMinuteTick(
  env: Env,
  openDb: () => Sql | null,
  nowMs = Date.now(),
): Promise<CronResult[]> {
  // Unflipped (preview / pre-cutover): the jobs skip before SQL anyway, and
  // the gate is not worth a DO call.
  if (gateCron(env, "push-dispatch")) {
    return handleScheduled({ cron: MINUTE_CRON }, env, (job) => runCronJob(job, env, null));
  }
  const plan: TickPlan | null = await gatePlan(env, nowMs);
  if (plan && isQuiet(plan)) {
    return [
      { job: "calendar-dispatch", status: 200, skipped: true, reason: "gate" },
      { job: "push-dispatch", status: 200, skipped: true, reason: "gate" },
    ];
  }
  let sql: Sql | null | undefined;
  const db = () => {
    if (sql === undefined) {
      try {
        sql = openDb();
      } catch {
        sql = null;
      }
    }
    return sql;
  };
  const report: GateReport = {};
  const out: CronResult[] = [];

  if (!plan || plan.calendar) {
    try {
      const s = db();
      if (!s) {
        out.push(blocked("calendar-dispatch"));
      } else {
        const pullMs = plan?.calendarPullMs ?? 0;
        let enqueued: number;
        if (env.CALENDAR_SYNC_QUEUE) {
          enqueued = await enqueueDueCalendarAccounts(s, env, pullMs);
        } else {
          const result = await runCalendarDispatch(s, env, undefined, pullMs);
          enqueued = result.ran;
          // Synced in-process: those accounts' reminders may have moved.
          if (result.users.length) await gatePoke(env, { users: result.users });
        }
        if (plan) report.calendar = { next: await nextCalendarSyncAt(s, ["google", ...otherCalendarProviders(env)]) };
        out.push({ job: "calendar-dispatch", status: 200, stay_on_supabase: false, enqueued });
      }
    } catch (err) {
      console.error("[cron] calendar-dispatch failed", err instanceof Error ? err.name : "error");
      out.push({ job: "calendar-dispatch", status: 500, ok: false, reason: "error" });
    }
  } else {
    out.push({ job: "calendar-dispatch", status: 200, skipped: true, reason: "gate" });
  }

  if (!plan || plan.push) {
    try {
      const s = db();
      if (!s) {
        out.push(blocked("push-dispatch"));
      } else {
        const scope = plan?.push ?? "all";
        const result = await runPushDispatch(s, env, scope === "all" ? { nowMs } : { nowMs, userIds: scope });
        if (plan) report.push = { scope, next: result.next };
        out.push({ job: "push-dispatch", status: 200, stay_on_supabase: false });
      }
    } catch (err) {
      console.error("[cron] push-dispatch failed", err instanceof Error ? err.name : "error");
      out.push({ job: "push-dispatch", status: 500, ok: false, reason: "error" });
    }
  } else {
    out.push({ job: "push-dispatch", status: 200, skipped: true, reason: "gate" });
  }

  // A failed job reports nothing: its lease makes the gate try it next minute.
  if (plan && (report.push || report.calendar)) await gateReport(env, report, nowMs);
  return out;
}

export async function handleScheduled(
  event: { cron: string },
  env: Env,
  run: (job: string) => Promise<CronResult>,
): Promise<CronResult[]> {
  const jobs = jobsForSchedule(event.cron);
  const out: CronResult[] = [];
  // Jobs on one tick are independent: one throwing must not skip the rest.
  for (const job of jobs) {
    try {
      out.push(await run(job));
    } catch (err) {
      console.error(`[cron] ${job} failed`, err instanceof Error ? err.name : "error");
      out.push({ job, status: 500, ok: false, reason: "error" });
    }
  }
  return out;
}

/**
 * One message = one calendar account. After the flip, Google / M365 /
 * iCloud / ICS run poll here. Unknown providers ack. Per-account errors
 * are isolated inside the runner (it marks `next_sync_at` backoff and
 * returns); this consumer then acks. Retry only when SQL cannot open
 * (backoff cannot be written) or the runner itself throws.
 * `opened` is optional for tests — the Worker path opens its own client.
 * Counts only — never log ids, tokens, or row data. `gateCron` skips
 * before any SQL.
 */
export async function consumeCalendarSyncBatch(
  batch: QueueBatch<CalendarSyncMessage>,
  env: Env,
  opened?: Sql | null,
): Promise<number> {
  let n = 0;
  let sql: Sql | null = opened ?? null;
  const closeOwned = opened == null;
  const synced = new Set<string>();
  let polled = false;
  if (gateCron(env, "queue-consume")) {
    for (const msg of batch.messages) {
      n += 1;
      msg.ack();
    }
    return n;
  }
  try {
    for (const msg of batch.messages) {
      n += 1;
      const provider = msg.body.provider;
      if (provider !== "google" && provider !== "m365" && provider !== "icloud" && provider !== "ics") {
        msg.ack();
        continue;
      }
      if (!sql) {
        try {
          sql = openSql(env);
        } catch {
          sql = null;
        }
      }
      if (!sql) {
        msg.retry();
        continue;
      }
      try {
        const accountId = msg.body.account_id;
        const userId = msg.body.user_id;
        if (provider === "google") {
          await runGoogleSync(sql, env, { mode: "poll", accountId, userId });
        } else if (provider === "m365") {
          await runM365Sync(sql, env, { accountId, userId });
        } else if (provider === "icloud") {
          await runIcloudSync(sql, env, { accountId, userId });
          await runIcloudContacts(sql, env, { accountId, userId });
        } else {
          await runIcsSync(sql, env, { accountId, userId });
        }
        synced.add(userId);
        polled = true;
        msg.ack();
      } catch {
        polled = true;
        msg.retry();
      }
    }
  } finally {
    if (closeOwned && sql) await closeSql(sql);
    // Events moved (reminders) and next_sync_at moved (the next poll): tell the gate.
    if (polled) await gatePoke(env, { users: [...synced], calendar: true });
  }
  return n;
}

export async function handleCron(c: Context<AppEnv>, jobName?: string): Promise<Response> {
  const token = bearerToken(c.req.header("authorization"));
  if (!cronAuthorized(token, c.env.CRON_SECRET)) {
    return json({ error: "unauthorized" }, 401, OPEN_CORS);
  }
  if (writeFrozen(c.env.MAINTENANCE_WRITE_FREEZE)) {
    return json({ error: "write_frozen", message: WRITE_FROZEN_MESSAGE }, 503, OPEN_CORS);
  }
  const job = jobName ?? c.req.param("job") ?? "";
  const name = canonicalCronJob(job);
  const gated = gateCron(c.env, name);
  if (gated) return gated;

  if (name === "calendar-dispatch") {
    const io = await requestIo(c);
    if (c.env.CALENDAR_SYNC_QUEUE) {
      const enqueued = await enqueueDueCalendarAccounts(io.sql, c.env);
      return json({ ok: true, job: name, enqueued, stay_on_supabase: false }, 200, OPEN_CORS);
    }
    const result = await runCalendarDispatch(io.sql, c.env, c.req.url);
    return json({ ...result, ok: true, job: name, stay_on_supabase: false }, 200, OPEN_CORS);
  }

  if (name === "google-renew" || name === "google-resubscribe") {
    const io = await requestIo(c);
    const result = await runGoogleCronJob(io.sql, c.env, name, c.req.url);
    return json({ ...result, ok: true, job: name, stay_on_supabase: false }, 200, OPEN_CORS);
  }

  if (BLOCKED_CRON_JOBS.has(job) || BLOCKED_CRON_JOBS.has(name)) {
    return stayOnSupabase(job || name, { reason: "provider/push secrets" });
  }

  const io = await requestIo(c);
  const sql = io.sql;

  if (name === "rollover") {
    const out = await runRollover(sql);
    return json({ ok: true, rolled: out.rolled, today: out.today, users: out.users }, 200, OPEN_CORS);
  }

  if (name === "purge-trash") {
    const out = await runPurgeTrash(sql);
    return json({ ok: true, deleted: out.deleted, users: out.users }, 200, OPEN_CORS);
  }

  if (name === "reminder-deliveries-prune") {
    const out = await runReminderPrune(sql);
    return json({ ok: true, deleted: out.deleted, users: out.users }, 200, OPEN_CORS);
  }

  if (name === "push-dispatch") {
    let body: { selfTest?: boolean; clientPublicKey?: string } = {};
    try {
      body = await readJson(c);
    } catch {
      body = {};
    }
    // nowMs is test-only on runPushDispatch — never accepted from HTTP.
    const result = await runPushDispatch(sql, c.env, {
      selfTest: body.selfTest === true,
      clientPublicKey: body.clientPublicKey,
    });
    return json(result, 200, OPEN_CORS);
  }

  if (name === "github-poll") {
    const out = await runGithubPoll(sql, c.env);
    return json(out, 200, OPEN_CORS);
  }

  if (name === "trim-sync-log") {
    const out = await runTrimSyncLog(sql);
    return json(out, 200, OPEN_CORS);
  }

  if (name === "m365-sync") {
    await runM365Sync(sql, c.env);
    return json({ ok: true, job: name, stay_on_supabase: false }, 200, OPEN_CORS);
  }
  if (name === "icloud-sync") {
    await runIcloudSync(sql, c.env);
    await runIcloudContacts(sql, c.env);
    return json({ ok: true, job: name, stay_on_supabase: false }, 200, OPEN_CORS);
  }
  if (name === "ics-sync") {
    await runIcsSync(sql, c.env);
    return json({ ok: true, job: name, stay_on_supabase: false }, 200, OPEN_CORS);
  }

  return stayOnSupabase(job || name);
}

/** Client-triggered rollover: session user only. Cron uses handleCron. */
export async function handleUserRollover(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (writeFrozen(c.env.MAINTENANCE_WRITE_FREEZE)) {
    return json({ error: "write_frozen", message: WRITE_FROZEN_MESSAGE }, 503, OPEN_CORS);
  }
  const got = await requireStore(c);
  if ("error" in got) return got.error;
  const today = todayLA();
  const rows = await rolloverUserTasks(got.store.sql, got.store.userId, today);
  return json({ ok: true, rolled: rows.length, today }, 200, OPEN_CORS);
}
