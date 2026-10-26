import type { Context } from "hono";
import { BLOCKED_CRON_JOBS, stayOnSupabase } from "./blocked.ts";
import { OPEN_CORS, json } from "./cors.ts";
import { bearerToken, cronAuthorized } from "./cron.ts";
import { requestIo, requireStore, type AppEnv } from "./session.ts";

function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function handleCron(c: Context<AppEnv>, jobName?: string): Promise<Response> {
  const token = bearerToken(c.req.header("authorization"));
  if (!cronAuthorized(token, c.env.CRON_SECRET)) {
    return json({ error: "unauthorized" }, 401, OPEN_CORS);
  }
  const job = jobName ?? c.req.param("job") ?? "";
  if (BLOCKED_CRON_JOBS.has(job)) return stayOnSupabase(job, { reason: "provider/push secrets" });

  const io = await requestIo(c);
  const sql = io.sql;

  if (job === "rollover" || job === "nuvo-rollover-pst" || job === "nuvo-rollover-pdt") {
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
    return json({ ok: true, rolled, today, users: users.length }, 200, OPEN_CORS);
  }

  if (job === "purge-trash" || job === "nuvo-purge-trash") {
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
    return json({ ok: true, deleted, users: users.length }, 200, OPEN_CORS);
  }

  if (
    job === "reminder-deliveries-prune" ||
    job === "prune-reminder-deliveries" ||
    job === "nuvo-reminder-deliveries-prune"
  ) {
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
    return json({ ok: true, deleted, users: users.length }, 200, OPEN_CORS);
  }

  return stayOnSupabase(job);
}

/** Client-triggered rollover: session user only. Cron uses handleCron. */
export async function handleUserRollover(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
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
