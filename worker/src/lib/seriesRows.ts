import type { Sql } from "../db.ts";
import { contentHash, type EventRow } from "./eventSync.ts";

export function pickAnchorRow<T extends { start_at: string }>(rows: T[], anchorMs: number): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const r of rows) {
    const gap = Math.abs(new Date(r.start_at).getTime() - anchorMs);
    if (gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  return best;
}

async function upsertEvent(sql: Sql, userId: string, row: EventRow): Promise<void> {
  await sql`
    INSERT INTO external_events (
      user_id, account_id, provider_event_id, calendar_id, title,
      start_at, end_at, all_day, location, busy, raw, last_synced_at, content_hash
    )
    VALUES (
      ${userId}, ${row.account_id}, ${row.provider_event_id}, ${row.calendar_id},
      ${row.title}, ${row.start_at}, ${row.end_at}, ${row.all_day}, ${row.location},
      ${row.busy}, ${JSON.stringify(row.raw ?? null)}::jsonb, ${row.last_synced_at}, ${row.content_hash ?? null}
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
      content_hash = EXCLUDED.content_hash
    WHERE external_events.user_id = ${userId}
  `;
}

export async function writeSeriesRows(
  sql: Sql,
  scope: { accountId: string; calendarId: string; userId: string; uidBase: string },
  incoming: EventRow[],
  keep?: { rowId?: string; anchorMs: number } | null,
): Promise<Record<string, unknown> | null> {
  const rows = incoming.map((r) => ({ ...r, content_hash: contentHash(r) }));
  const stored = (await sql`
    SELECT id, provider_event_id FROM external_events
    WHERE account_id = ${scope.accountId}
      AND user_id = ${scope.userId}
      AND calendar_id = ${scope.calendarId}
      AND (provider_event_id = ${scope.uidBase} OR provider_event_id LIKE ${`${scope.uidBase}::%`})
  `) as { id: string; provider_event_id: string }[];

  const rowId = keep?.rowId;
  let kept: Record<string, unknown> | null = null;
  let anchor: EventRow | null = null;
  if (keep && rowId) {
    anchor = pickAnchorRow(rows, keep.anchorMs);
    if (anchor) {
      const key = anchor.provider_event_id;
      const squatter = stored.find((s) => s.provider_event_id === key && s.id !== rowId);
      if (squatter) {
        await sql`
          DELETE FROM external_events
          WHERE id = ${squatter.id} AND user_id = ${scope.userId}
        `;
      }
      const updated = await sql`
        UPDATE external_events SET
          provider_event_id = ${anchor.provider_event_id},
          title = ${anchor.title},
          start_at = ${anchor.start_at},
          end_at = ${anchor.end_at},
          all_day = ${anchor.all_day},
          location = ${anchor.location},
          busy = ${anchor.busy},
          raw = ${JSON.stringify(anchor.raw ?? null)}::jsonb,
          last_synced_at = ${anchor.last_synced_at},
          content_hash = ${anchor.content_hash ?? null}
        WHERE id = ${rowId} AND user_id = ${scope.userId}
        RETURNING *
      `;
      kept = (updated[0] as Record<string, unknown> | undefined) ?? null;
      if (!kept) anchor = null;
    }
  }

  const rest = rows.filter((r) => r !== anchor);
  for (const row of rest) await upsertEvent(sql, scope.userId, row);

  const emitted = new Set(rows.map((r) => r.provider_event_id));
  const stale = stored
    .filter((s) => !emitted.has(s.provider_event_id) && !(kept && s.id === rowId))
    .map((s) => s.id);
  if (stale.length) {
    await sql`
      DELETE FROM external_events
      WHERE user_id = ${scope.userId} AND id = ANY(${stale})
    `;
  }

  if (kept) return kept;
  const first = keep ? pickAnchorRow(rows, keep.anchorMs) : rows[0] ?? null;
  if (!first) return null;
  const found = await sql`
    SELECT * FROM external_events
    WHERE account_id = ${scope.accountId}
      AND user_id = ${scope.userId}
      AND calendar_id = ${scope.calendarId}
      AND provider_event_id = ${first.provider_event_id}
    LIMIT 1
  `;
  return (found[0] as Record<string, unknown> | undefined) ?? null;
}
