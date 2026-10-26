// Materialize an iCloud resource we just wrote, the way the next sync will.
//
// A recurring create used to insert ONE row (the first occurrence, keyed by the
// bare UID). The next sync expanded the series into `uid::<RECURRENCE-ID>` rows
// and swept the bare one — so the calendar showed a weekly event as a single
// Wednesday until the poll ran, and the chat card / open sheet were left holding
// an id that no longer existed: their next edit got "event not found" (HTTP 404,
// which the client then misreported as "isn't deployed"). Converting an event to
// weekly, changing a rule or moving a whole series did the same.
//
// So after any series-level write, expand the ICS we PUT over the sync's own
// window and hand the rows to writeSeriesRows (seriesRows.ts).
import { parseIcs } from "./ics.ts";
import type { EventRow } from "./eventSync.ts";
import { icloudSeriesOrFilter } from "./icloudSeries.ts";
import { writeSeriesRows } from "./seriesRows.ts";
import { syncWindow } from "./syncWindow.ts";

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
  return await writeSeriesRows(
    { accountId: t.accountId, calendarId: t.calendarId, seriesFilter: icloudSeriesOrFilter(t.uid) },
    rows,
    keep,
  );
}
