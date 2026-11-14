/**
 * One-off repair for the rollover regression (see rollover.ts).
 *
 * Between the Cloudflare flip and the D-145 fix, the Worker carried EVERY open
 * recurring occurrence to today, including ones a later occurrence had already
 * superseded. Those rows are recognisable: open, in a series, a later
 * non-trashed occurrence of the same series has come due, and the row has been
 * dragged forward (`do_date > recurrence_date`, `roll_count > 0`) to the most
 * recent rollover day. Rollover never moves such a row now, so nothing else
 * will put it back.
 *
 * The default repair is the inverse of the damage: back to its own date
 * (`recurrence_date`, the rule's date) with no carry mark — exactly where D-145
 * leaves a superseded occurrence. `trash` instead sends it to the Trash
 * (recoverable for 30 days) for someone who would rather not keep a ledger of
 * missed weeks. Both leave the series' live occurrence alone.
 *
 * What it cannot give back: the clock the rollover cleared, and the original
 * per-run roll_count of an occurrence that was carried before the flip. A
 * superseded occurrence sits on its own date in anytime, with no mark.
 */
import type { Sql } from "./db.ts";

export interface WronglyCarried {
  id: string;
  email: string | null;
  title: string;
  recurrence_date: string;
  do_date: string;
  roll_count: number;
}

/** Open occurrences a later due occurrence supersedes, that the Worker dragged to today. */
export async function findWronglyCarried(
  sql: Sql,
  opts: { today: string; email?: string | null },
): Promise<WronglyCarried[]> {
  const email = opts.email ?? null;
  return (await sql`
    SELECT t.id,
           u.email,
           t.title,
           t.recurrence_date::text AS recurrence_date,
           t.do_date::text AS do_date,
           t.roll_count
    FROM tasks t
    JOIN users u ON u.id = t.user_id
    WHERE t.status IN ('inbox', 'planned')
      AND t.recurrence_id IS NOT NULL
      AND t.recurrence_date IS NOT NULL
      AND t.parent_task_id IS NULL
      AND t.roll_count > 0
      AND t.do_date > t.recurrence_date
      -- On the most recent rollover day, not wherever a person put it by hand.
      AND t.do_date >= ${opts.today}::date - 1
      AND EXISTS (
        SELECT 1
        FROM tasks nx
        WHERE nx.user_id = t.user_id
          AND nx.recurrence_id = t.recurrence_id
          AND nx.recurrence_date > t.recurrence_date
          AND nx.recurrence_date <= ${opts.today}::date
          AND nx.status <> 'trashed'
      )
      AND (${email}::text IS NULL OR u.email = ${email})
    ORDER BY u.email, t.title, t.recurrence_date
  `) as unknown as WronglyCarried[];
}

/** Put the found rows back (or in the Trash). Returns how many changed. */
export async function repairWronglyCarried(
  sql: Sql,
  ids: string[],
  mode: "restore" | "trash",
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows =
    mode === "trash"
      ? await sql`
          UPDATE tasks
          SET status = 'trashed', trashed_at = now(), updated_at = now()
          WHERE id = ANY(${ids}::uuid[]) AND status IN ('inbox', 'planned')
          RETURNING id`
      : await sql`
          UPDATE tasks
          SET do_date = recurrence_date, roll_count = 0, start_time = NULL, slot_id = NULL, updated_at = now()
          WHERE id = ANY(${ids}::uuid[]) AND status IN ('inbox', 'planned')
          RETURNING id`;
  return rows.length;
}
