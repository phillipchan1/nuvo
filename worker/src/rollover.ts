/**
 * Rollover — carry unfinished day-work to today. ONE definition, two callers:
 * the nightly cron (`runRollover`) and the client-triggered route
 * (`handleUserRollover`), both in `cronJobs.ts`.
 *
 * This is the Worker's port of `public.rollover_tasks` (migrations 80, 81, 84,
 * 85), and it must say the same thing:
 *
 * - **Lands in anytime** (D-080/081): the clock and the slot are dropped. A
 *   task inside a passed slot is judged by the slot's date, not its own.
 * - **Never a step** (`parent_task_id IS NULL`).
 * - **D-145 — a missed recurring occurrence carries only while its series has
 *   no later occurrence that has come due.** A daily habit never piles up
 *   (today's supersedes yesterday's); a weekly one carries day by day until
 *   next week's arrives, and then the missed one stays where it was. At most
 *   one occurrence per series is ever carried. Identity is
 *   `(recurrence_id, recurrence_date)`, never `do_date`.
 * - **The carried occurrence is pinned** (`recurrence_overridden`) so an
 *   edit-all regeneration leaves it on today.
 * - **D-147 — `roll_count` counts days carried**, the gap to today.
 *
 * The first Worker port rolled every open row with none of the recurring rules
 * (it was a copy of the 2026-08 SQL, before D-145). On the flip it swept every
 * superseded occurrence in the account to today — a weekly "Get ready for
 * Sunday service" showed three copies, one marked ↻114d. `tests/rollover.test.ts`
 * had held the rule against the legacy Supabase migration, which nothing ran any
 * more. `worker/src/rollover.check.ts` now runs THIS statement against a real
 * Postgres (PGlite) — the battery drives the deployed code, never a copy.
 */
import type { Sql } from "./db.ts";

/**
 * Roll one user's unfinished work onto `today` (an ISO date in the app's zone).
 * Returns the ids moved. `today` is passed in so the cron and the route agree
 * on the day and tests can pin it.
 */
export async function rolloverUserTasks(sql: Sql, userId: string, today: string): Promise<string[]> {
  const rows = (await sql`
    UPDATE tasks t
    SET do_date = ${today}::date,
        start_time = NULL,
        slot_id = NULL,
        roll_count = t.roll_count + (${today}::date - d.eff_date),
        recurrence_overridden = t.recurrence_overridden OR t.recurrence_id IS NOT NULL,
        status = 'planned',
        updated_at = now()
    FROM (
      SELECT tk.id, COALESCE(s.do_date, tk.do_date) AS eff_date
      FROM tasks tk
      LEFT JOIN slots s ON s.id = tk.slot_id
      WHERE tk.user_id = ${userId}
    ) d
    WHERE t.id = d.id
      AND t.user_id = ${userId}
      AND t.status IN ('inbox', 'planned')
      AND d.eff_date IS NOT NULL
      AND d.eff_date < ${today}::date
      AND t.parent_task_id IS NULL
      AND (
        t.recurrence_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM tasks nx
          WHERE nx.user_id = ${userId}
            AND nx.recurrence_id = t.recurrence_id
            AND nx.recurrence_date > t.recurrence_date
            AND nx.recurrence_date <= ${today}::date
            AND nx.status <> 'trashed'
        )
      )
    RETURNING t.id
  `) as { id: string }[];

  await sql`
    UPDATE user_settings
    SET last_rollover_date = ${today}::date, updated_at = now()
    WHERE user_id = ${userId}
  `;
  return rows.map((r) => r.id);
}
