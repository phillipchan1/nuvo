import type { Sql } from "../db.ts";
import { jsonParam } from "../db.ts";
import { contentHash, type EventRow } from "../lib/eventHash.ts";

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

export async function writeSeriesRows(
  sql: Sql,
  scope: { accountId: string; userId: string; calendarId: string; masterId: string },
  incoming: EventRow[],
  keep?: { rowId?: string; anchorMs: number } | null,
): Promise<Record<string, unknown> | null> {
  const rows = incoming.map((r) => ({ ...r, content_hash: contentHash(r) }));
  const existing = await sql`
    SELECT id, provider_event_id
    FROM external_events
    WHERE account_id = ${scope.accountId}
      AND user_id = ${scope.userId}
      AND calendar_id = ${scope.calendarId}
      AND (recurring_event_id = ${scope.masterId} OR provider_event_id = ${scope.masterId})
  `;
  const stored = existing as unknown as { id: string; provider_event_id: string }[];

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
          WHERE id = ${squatter.id}
            AND user_id = ${scope.userId}
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
          raw = ${jsonParam(sql, anchor.raw)},
          last_synced_at = ${anchor.last_synced_at},
          content_hash = ${anchor.content_hash ?? null},
          recurring_event_id = ${anchor.recurring_event_id ?? null}
        WHERE id = ${rowId}
          AND user_id = ${scope.userId}
        RETURNING *
      `;
      kept = (updated[0] as Record<string, unknown> | undefined) ?? null;
      if (!kept) anchor = null;
    }
  }

  const rest = rows.filter((r) => r !== anchor);
  for (const row of rest) {
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

  const emitted = new Set(rows.map((r) => r.provider_event_id));
  const stale = stored
    .filter((s) => !emitted.has(s.provider_event_id) && !(kept && s.id === rowId))
    .map((s) => s.id);
  if (stale.length) {
    await sql`
      DELETE FROM external_events
      WHERE id = ANY (${stale})
        AND user_id = ${scope.userId}
    `;
  }

  if (kept) return kept;
  const first = keep ? pickAnchorRow(rows, keep.anchorMs) : rows[0] ?? null;
  if (!first) return null;
  const found = await sql`
    SELECT *
    FROM external_events
    WHERE account_id = ${scope.accountId}
      AND user_id = ${scope.userId}
      AND calendar_id = ${scope.calendarId}
      AND provider_event_id = ${first.provider_event_id}
    LIMIT 1
  `;
  return (found[0] as Record<string, unknown> | undefined) ?? null;
}

export async function rewriteMirrorRow(
  sql: Sql,
  eventId: string,
  userId: string,
  values: {
    raw?: unknown;
    all_day?: boolean;
    start_at?: string;
    end_at?: string;
    location?: string | null;
  },
  rowAt: { start_at: string; end_at: string } | null,
): Promise<"written" | "superseded" | "failed"> {
  try {
    const rows = rowAt
      ? await sql`
          UPDATE external_events SET
            raw = COALESCE(${values.raw == null ? null : jsonParam(sql, values.raw)}, raw),
            all_day = COALESCE(${values.all_day ?? null}, all_day),
            start_at = COALESCE(${values.start_at ?? null}, start_at),
            end_at = COALESCE(${values.end_at ?? null}, end_at),
            location = CASE WHEN ${values.location !== undefined ? 1 : 0} = 1
              THEN ${values.location ?? null} ELSE location END
          WHERE id = ${eventId}
            AND user_id = ${userId}
            AND start_at = ${rowAt.start_at}
            AND end_at = ${rowAt.end_at}
          RETURNING id
        `
      : await sql`
          UPDATE external_events SET
            raw = COALESCE(${values.raw == null ? null : jsonParam(sql, values.raw)}, raw),
            all_day = COALESCE(${values.all_day ?? null}, all_day),
            start_at = COALESCE(${values.start_at ?? null}, start_at),
            end_at = COALESCE(${values.end_at ?? null}, end_at),
            location = CASE WHEN ${values.location !== undefined ? 1 : 0} = 1
              THEN ${values.location ?? null} ELSE location END
          WHERE id = ${eventId}
            AND user_id = ${userId}
          RETURNING id
        `;
    return rowAt && !rows.length ? "superseded" : "written";
  } catch {
    return "failed";
  }
}
