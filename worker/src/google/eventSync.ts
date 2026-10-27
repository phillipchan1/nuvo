import type { Sql } from "../db.ts";
import { jsonParam } from "../db.ts";
import { contentHash, type EventRow } from "../lib/eventHash.ts";
import { isSuspectWipe } from "../../../supabase/functions/_shared/sweepSafety.ts";

export interface ReconcileScope {
  accountId: string;
  userId: string;
  calendarId?: string;
  sweepFrom?: string;
  sweepTo?: string;
}

type ByCalendar<T> = Map<string, Map<string, T>>;

function put<T>(m: ByCalendar<T>, cal: string, id: string, v: T): void {
  let inner = m.get(cal);
  if (!inner) {
    inner = new Map();
    m.set(cal, inner);
  }
  inner.set(id, v);
}

function total<T>(m: ByCalendar<T>): number {
  let n = 0;
  for (const inner of m.values()) n += inner.size;
  return n;
}

export async function reconcileEvents(
  sql: Sql,
  scope: ReconcileScope,
  rows: EventRow[],
  opts: { sweep: boolean },
): Promise<{ written: number; deleted: number; unchanged: number }> {
  const incoming: ByCalendar<EventRow> = new Map();
  for (const r of rows) put(incoming, r.calendar_id, r.provider_event_id, r);

  if (!opts.sweep && rows.length === 0) return { written: 0, deleted: 0, unchanged: 0 };

  const stored: ByCalendar<string | null> = new Map();

  if (!opts.sweep) {
    for (const [cal, byId] of incoming) {
      const ids = [...byId.keys()];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const page = await sql`
          SELECT provider_event_id, calendar_id, content_hash
          FROM external_events
          WHERE account_id = ${scope.accountId}
            AND user_id = ${scope.userId}
            AND calendar_id = ${cal}
            AND provider_event_id = ANY (${chunk})
        `;
        for (const r of page) {
          put(
            stored,
            String((r as { calendar_id: string }).calendar_id),
            String((r as { provider_event_id: string }).provider_event_id),
            ((r as { content_hash?: string | null }).content_hash as string | null) ?? null,
          );
        }
      }
    }
  } else {
    const page = scope.calendarId
      ? scope.sweepFrom && scope.sweepTo
        ? await sql`
            SELECT provider_event_id, calendar_id, content_hash
            FROM external_events
            WHERE account_id = ${scope.accountId}
              AND user_id = ${scope.userId}
              AND calendar_id = ${scope.calendarId}
              AND start_at >= ${scope.sweepFrom}
              AND start_at < ${scope.sweepTo}
          `
        : await sql`
            SELECT provider_event_id, calendar_id, content_hash
            FROM external_events
            WHERE account_id = ${scope.accountId}
              AND user_id = ${scope.userId}
              AND calendar_id = ${scope.calendarId}
          `
      : await sql`
          SELECT provider_event_id, calendar_id, content_hash
          FROM external_events
          WHERE account_id = ${scope.accountId}
            AND user_id = ${scope.userId}
        `;
    for (const r of page) {
      put(
        stored,
        String((r as { calendar_id: string }).calendar_id),
        String((r as { provider_event_id: string }).provider_event_id),
        ((r as { content_hash?: string | null }).content_hash as string | null) ?? null,
      );
    }
  }

  if (opts.sweep) {
    const storedCount = total(stored);
    if (isSuspectWipe(total(incoming), storedCount)) {
      const where = scope.calendarId ? `calendar ${scope.calendarId}` : `account ${scope.accountId}`;
      throw new Error(
        `refusing to sweep ${storedCount} stored events for ${where}: the provider returned no events at all`,
      );
    }
  }

  const changed: EventRow[] = [];
  let unchanged = 0;
  for (const [cal, byId] of incoming) {
    const storedCal = stored.get(cal);
    for (const [id, row] of byId) {
      const hash = contentHash(row);
      if (storedCal?.get(id) === hash) {
        unchanged++;
        continue;
      }
      changed.push({ ...row, content_hash: hash });
    }
  }

  for (const row of changed) {
    await sql`
      INSERT INTO external_events (
        user_id, account_id, provider_event_id, calendar_id, title, start_at, end_at,
        all_day, location, busy, raw, last_synced_at, content_hash, recurring_event_id
      ) VALUES (
        ${row.user_id}, ${row.account_id}, ${row.provider_event_id}, ${row.calendar_id},
        ${row.title}, ${row.start_at}, ${row.end_at}, ${row.all_day}, ${row.location},
        ${row.busy}, ${jsonParam(sql, row.raw)}, ${row.last_synced_at}, ${row.content_hash ?? null},
        ${row.recurring_event_id ?? null}
      )
      ON CONFLICT (account_id, calendar_id, provider_event_id) DO UPDATE SET
        title = EXCLUDED.title,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        all_day = EXCLUDED.all_day,
        location = EXCLUDED.location,
        busy = EXCLUDED.busy,
        raw = EXCLUDED.raw,
        last_synced_at = EXCLUDED.last_synced_at,
        content_hash = EXCLUDED.content_hash,
        recurring_event_id = EXCLUDED.recurring_event_id
      WHERE external_events.user_id = ${scope.userId}
    `;
  }

  let deleted = 0;
  if (opts.sweep) {
    for (const [cal, byId] of stored) {
      const incomingCal = incoming.get(cal);
      const stale = [...byId.keys()].filter((id) => !incomingCal?.has(id));
      if (stale.length === 0) continue;
      await sql`
        DELETE FROM external_events
        WHERE account_id = ${scope.accountId}
          AND user_id = ${scope.userId}
          AND calendar_id = ${cal}
          AND provider_event_id = ANY (${stale})
      `;
      deleted += stale.length;
    }
  }

  return { written: changed.length, deleted, unchanged };
}

export async function deleteProviderEvents(
  sql: Sql,
  accountId: string,
  userId: string,
  calendarId: string,
  providerEventIds: string[],
): Promise<void> {
  if (!providerEventIds.length) return;
  await sql`
    DELETE FROM external_events
    WHERE account_id = ${accountId}
      AND user_id = ${userId}
      AND calendar_id = ${calendarId}
      AND provider_event_id = ANY (${providerEventIds})
  `;
}
