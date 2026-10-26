import type { Sql } from "../db.ts";
import { isSuspectWipe } from "./sweepSafety.ts";

export interface EventRow {
  user_id: string;
  account_id: string;
  provider_event_id: string;
  calendar_id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  busy: boolean;
  raw: unknown;
  last_synced_at: string;
  content_hash?: string;
}

export function contentHash(row: EventRow): string {
  const canonical = JSON.stringify([
    row.title,
    row.start_at,
    row.end_at,
    row.all_day,
    row.location,
    row.busy,
    row.raw ?? null,
  ]);
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    fnv = Math.imul(fnv ^ c, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) ^ c) >>> 0;
  }
  return fnv.toString(16).padStart(8, "0") + djb.toString(16).padStart(8, "0");
}

export interface ReconcileScope {
  accountId: string;
  userId: string;
  calendarId?: string;
  sweepFrom?: string;
  sweepTo?: string;
}

export interface ReconcileResult {
  written: number;
  deleted: number;
  unchanged: number;
}

type ByCalendar<T> = Map<string, Map<string, T>>;

function put<T>(m: ByCalendar<T>, cal: string, id: string, v: T): void {
  let inner = m.get(cal);
  if (!inner) {
    inner = new Map<string, T>();
    m.set(cal, inner);
  }
  inner.set(id, v);
}

function total<T>(m: ByCalendar<T>): number {
  let n = 0;
  for (const inner of m.values()) n += inner.size;
  return n;
}

function assertNotAWipe(
  scope: ReconcileScope,
  incoming: ByCalendar<EventRow>,
  stored: ByCalendar<string | null>,
  sweep: boolean,
): void {
  if (!sweep) return;
  const storedCount = total(stored);
  if (!isSuspectWipe(total(incoming), storedCount)) return;
  const where = scope.calendarId ? `calendar ${scope.calendarId}` : `account ${scope.accountId}`;
  throw new Error(
    `refusing to sweep ${storedCount} stored events for ${where}: the provider returned no events at all, ` +
      `which is a provider failure rather than an empty calendar`,
  );
}

export async function reconcileEvents(
  sql: Sql,
  scope: ReconcileScope,
  rows: EventRow[],
  opts: { sweep: boolean },
): Promise<ReconcileResult> {
  const incoming: ByCalendar<EventRow> = new Map();
  for (const r of rows) put(incoming, r.calendar_id, r.provider_event_id, r);

  if (!opts.sweep && rows.length === 0) return { written: 0, deleted: 0, unchanged: 0 };

  const stored: ByCalendar<string | null> = new Map();
  const collect = (page: Record<string, unknown>[]) => {
    for (const r of page) {
      put(stored, String(r.calendar_id), String(r.provider_event_id), (r.content_hash as string | null) ?? null);
    }
  };

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
            AND provider_event_id = ANY(${chunk})
        `;
        collect(page as Record<string, unknown>[]);
      }
    }
  } else {
    const PAGE = 1000;
    let lastCal = "";
    let lastPid = "";
    for (;;) {
      const page = scope.calendarId
        ? await sql`
            SELECT provider_event_id, calendar_id, content_hash
            FROM external_events
            WHERE account_id = ${scope.accountId}
              AND user_id = ${scope.userId}
              AND calendar_id = ${scope.calendarId}
              AND (${scope.sweepFrom ?? null}::timestamptz IS NULL OR start_at >= ${scope.sweepFrom ?? null})
              AND (${scope.sweepTo ?? null}::timestamptz IS NULL OR start_at < ${scope.sweepTo ?? null})
              AND (calendar_id, provider_event_id) > (${lastCal}, ${lastPid})
            ORDER BY calendar_id, provider_event_id
            LIMIT ${PAGE}
          `
        : await sql`
            SELECT provider_event_id, calendar_id, content_hash
            FROM external_events
            WHERE account_id = ${scope.accountId}
              AND user_id = ${scope.userId}
              AND (${scope.sweepFrom ?? null}::timestamptz IS NULL OR start_at >= ${scope.sweepFrom ?? null})
              AND (${scope.sweepTo ?? null}::timestamptz IS NULL OR start_at < ${scope.sweepTo ?? null})
              AND (calendar_id, provider_event_id) > (${lastCal}, ${lastPid})
            ORDER BY calendar_id, provider_event_id
            LIMIT ${PAGE}
          `;
      collect(page as Record<string, unknown>[]);
      if (page.length < PAGE) break;
      const last = page[page.length - 1] as { calendar_id: string; provider_event_id: string };
      lastCal = last.calendar_id;
      lastPid = last.provider_event_id;
    }
  }

  assertNotAWipe(scope, incoming, stored, opts.sweep);

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
        user_id, account_id, provider_event_id, calendar_id, title,
        start_at, end_at, all_day, location, busy, raw, last_synced_at, content_hash
      )
      VALUES (
        ${scope.userId}, ${row.account_id}, ${row.provider_event_id}, ${row.calendar_id},
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
      WHERE external_events.user_id = ${scope.userId}
    `;
  }

  let deleted = 0;
  if (opts.sweep) {
    for (const [cal, byId] of stored) {
      const incomingCal = incoming.get(cal);
      const stale = [...byId.keys()].filter((id) => !incomingCal?.has(id));
      if (!stale.length) continue;
      const gone = await sql`
        DELETE FROM external_events
        WHERE account_id = ${scope.accountId}
          AND user_id = ${scope.userId}
          AND calendar_id = ${cal}
          AND provider_event_id = ANY(${stale})
        RETURNING id
      `;
      deleted += gone.length;
    }
  }

  return { written: changed.length, deleted, unchanged };
}

export async function deleteEventsByProviderIds(
  sql: Sql,
  accountId: string,
  userId: string,
  providerEventIds: string[],
): Promise<void> {
  if (!providerEventIds.length) return;
  await sql`
    DELETE FROM external_events
    WHERE account_id = ${accountId}
      AND user_id = ${userId}
      AND provider_event_id = ANY(${providerEventIds})
  `;
}

export async function deleteAccountEvents(sql: Sql, accountId: string, userId: string): Promise<void> {
  await sql`
    DELETE FROM external_events
    WHERE account_id = ${accountId} AND user_id = ${userId}
  `;
}
