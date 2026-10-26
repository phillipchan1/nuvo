/**
 * Worker Cron Triggers + Queue fan-out for jobs that today run on pg_cron.
 *
 * HTTP `/api/cron/:job` still requires CRON_SECRET (constant time). The
 * `scheduled` export is Cloudflare-authenticated and calls the same runners.
 *
 * Ported user-data jobs (rollover, purge-trash, reminder-deliveries-prune,
 * push-dispatch) iterate `users` then scope by `user_id`. Calendar-dispatch
 * fans out one Queue message per due account so a single isolate does not
 * loop every tenant against Google/Graph/CalDAV (Workers Paid CPU). github /
 * google-renew stay 501. Queue consume is a no-op scaffold — later PRs
 * sync one account per message.
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
import type { Sql } from "./db.ts";
import type { Env } from "./env.ts";
import { WRITE_FROZEN_MESSAGE, writeFrozen } from "./maintenance.ts";
import { requestIo, requireStore, type AppEnv } from "./session.ts";
import { runPushDispatch } from "./pushDispatch.ts";
import { readJson } from "./http.ts";

export interface QueueMessage<T> {
  body: T;
  ack(): void;
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
  stay_on_supabase: boolean;
  enqueued?: number;
  rolled?: number;
  deleted?: number;
}

/** cron expression (UTC) → job names. Same tick can run more than one. */
export const CRON_BY_SCHEDULE: Record<string, readonly string[]> = {
  "* * * * *": ["calendar-dispatch", "push-dispatch"],
  "5 7 * * *": ["rollover"],
  "5 8 * * *": ["rollover"],
  "15 9 * * *": ["google-renew"],
  "20 9 * * *": ["github-poll"],
  "0 10 * * 0": ["trim-sync-log"],
  "30 4 * * *": ["reminder-deliveries-prune"],
  "0 4 * * *": ["purge-trash"],
};

export const ALL_CRON_SCHEDULES = Object.keys(CRON_BY_SCHEDULE);

const JOB_ALIASES: Record<string, string> = {
  "nuvo-calendar-dispatch": "calendar-dispatch",
  "nuvo-push-dispatch": "push-dispatch",
  "nuvo-google-renew": "google-renew",
  "nuvo-github-poll": "github-poll",
  "nuvo-trim-sync-log": "trim-sync-log",
  "nuvo-reminder-deliveries-prune": "reminder-deliveries-prune",
  "nuvo-purge-trash": "purge-trash",
  "nuvo-rollover-pst": "rollover",
  "nuvo-rollover-pdt": "rollover",
  "prune-reminder-deliveries": "reminder-deliveries-prune",
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
    const rows = (await sql`
      UPDATE tasks
      SET do_date = ${today},
          start_time = NULL,
          slot_id = NULL,
          roll_count = roll_count + GREATEST(${today}::date - COALESCE(do_date, ${today}::date), 1),
          status = 'planned',
          updated_at = now()
      WHERE user_id = ${user.id}
        AND status IN ('inbox', 'planned')
        AND do_date IS NOT NULL
        AND do_date < ${today}::date
        AND parent_task_id IS NULL
      RETURNING id
    `) as { id: string }[];
    rolled += rows.length;
    await sql`
      UPDATE user_settings
      SET last_rollover_date = ${today}, updated_at = now()
      WHERE user_id = ${user.id}
    `;
  }
  return { rolled, today, users: users.length };
}

async function runPurgeTrash(sql: Sql): Promise<{ deleted: number; users: number }> {
  const users = (await sql`SELECT id FROM users`) as { id: string }[];
  let deleted = 0;
  for (const user of users) {
    const rows = (await sql`
      DELETE FROM tasks
      WHERE user_id = ${user.id}
        AND status = 'trashed'
        AND COALESCE(trashed_at, updated_at) < now() - interval '30 days'
      RETURNING id
    `) as { id: string }[];
    deleted += rows.length;
  }
  return { deleted, users: users.length };
}

async function runReminderPrune(sql: Sql): Promise<{ deleted: number; users: number }> {
  const users = (await sql`SELECT id FROM users`) as { id: string }[];
  let deleted = 0;
  for (const user of users) {
    const rows = (await sql`
      DELETE FROM reminder_deliveries
      WHERE user_id = ${user.id}
        AND fire_at < now() - interval '2 days'
      RETURNING reminder_key
    `) as { reminder_key: string }[];
    deleted += rows.length;
  }
  return { deleted, users: users.length };
}

const DUE_BATCH = 100;

export async function enqueueDueCalendarAccounts(sql: Sql, env: Env): Promise<number> {
  const queue = env.CALENDAR_SYNC_QUEUE;
  if (!queue) return 0;
  const rows = (await sql`
    SELECT id, user_id, provider
    FROM calendar_accounts
    WHERE NOT needs_reconnect
      AND (next_sync_at IS NULL OR next_sync_at <= now())
    ORDER BY next_sync_at ASC NULLS FIRST
    LIMIT ${DUE_BATCH}
  `) as { id: string; user_id: string; provider: string }[];
  let n = 0;
  for (const row of rows) {
    await queue.send({
      account_id: row.id,
      user_id: row.user_id,
      provider: row.provider,
    } satisfies CalendarSyncMessage);
    n += 1;
  }
  return n;
}

export async function runCronJob(job: string, env: Env, sql: Sql | null): Promise<CronResult> {
  const name = canonicalCronJob(job);
  if (name === "calendar-dispatch") {
    if (!sql || !env.CALENDAR_SYNC_QUEUE) return blocked(name);
    const enqueued = await enqueueDueCalendarAccounts(sql, env);
    return { job: name, status: 200, stay_on_supabase: true, enqueued };
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
  return blocked(name);
}

export async function handleScheduled(
  event: { cron: string },
  env: Env,
  run: (job: string) => Promise<CronResult>,
): Promise<CronResult[]> {
  const jobs = jobsForSchedule(event.cron);
  const out: CronResult[] = [];
  for (const job of jobs) out.push(await run(job));
  return out;
}

/**
 * Scaffold consumer. Acks every message. Later PRs open the token and
 * sync that one account. Counts only — never log ids or row data.
 */
export function consumeCalendarSyncBatch(batch: QueueBatch<CalendarSyncMessage>): number {
  let n = 0;
  for (const msg of batch.messages) {
    n += 1;
    msg.ack();
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

  if (name === "calendar-dispatch") {
    const io = await requestIo(c);
    const enqueued = await enqueueDueCalendarAccounts(io.sql, c.env);
    return json({ ok: true, job: name, enqueued, stay_on_supabase: true }, 200, OPEN_CORS);
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
    let body: { selfTest?: boolean; clientPublicKey?: string; nowMs?: number } = {};
    try {
      body = await readJson(c);
    } catch {
      body = {};
    }
    const result = await runPushDispatch(sql, c.env, {
      selfTest: body.selfTest === true,
      clientPublicKey: body.clientPublicKey,
      nowMs: typeof body.nowMs === "number" ? body.nowMs : undefined,
    });
    return json(result, 200, OPEN_CORS);
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
  const rows = (await got.store.sql`
    UPDATE tasks
    SET do_date = ${today},
        start_time = NULL,
        slot_id = NULL,
        roll_count = roll_count + GREATEST(${today}::date - COALESCE(do_date, ${today}::date), 1),
        status = 'planned',
        updated_at = now()
    WHERE user_id = ${got.store.userId}
      AND status IN ('inbox', 'planned')
      AND do_date IS NOT NULL
      AND do_date < ${today}::date
      AND parent_task_id IS NULL
    RETURNING id
  `) as { id: string }[];
  await got.store.sql`
    UPDATE user_settings
    SET last_rollover_date = ${today}, updated_at = now()
    WHERE user_id = ${got.store.userId}
  `;
  return json({ ok: true, rolled: rows.length, today }, 200, OPEN_CORS);
}
