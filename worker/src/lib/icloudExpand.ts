import { parseIcs } from "./ics.ts";
import type { EventRow } from "./eventSync.ts";
import { writeSeriesRows } from "./seriesRows.ts";
import { syncWindow } from "./syncWindow.ts";
import type { Sql } from "../db.ts";

export interface ExpandTarget {
  userId: string;
  accountId: string;
  accountEmail: string;
  calendarId: string;
  uid: string;
  href: string;
  etag: string | null;
}

export async function materializeIcloudResource(
  sql: Sql,
  t: ExpandTarget,
  ics: string,
  keep?: { rowId?: string; anchorMs: number } | null,
): Promise<Record<string, unknown> | null> {
  const { start, end } = syncWindow();
  const { rows: parsed } = parseIcs(ics, {
    userId: t.userId,
    accountId: t.accountId,
    windowStart: start,
    windowEnd: end,
    runStamp: new Date().toISOString(),
    calendarId: t.calendarId,
    ownerEmail: t.accountEmail,
  });
  const rows = parsed.map((r) => ({
    ...r,
    raw: { ...(r.raw ?? {}), caldav_href: t.href, caldav_etag: t.etag },
  })) as EventRow[];
  return writeSeriesRows(
    sql,
    { accountId: t.accountId, calendarId: t.calendarId, userId: t.userId, uidBase: t.uid },
    rows,
    keep,
  );
}
