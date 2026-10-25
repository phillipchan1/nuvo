// The Google twin of icloudExpand.ts: after a write that reshapes a series,
// store what Google now has — its INSTANCES, never the master.
//
// The create and rule-change paths used to upsert Google's reply, which for a
// series is the master: one row on the first date carrying recurrence[], which
// google.ts says must never be stored (an incremental sync never removes it).
// That painted the first occurrence twice, and when it replaced the open row a
// THIS edit hit the whole series.
import { type GoogleAccount, fetchGoogleSeriesInstances, isGoogleSeriesMaster, mapGoogleEvent } from "./google.ts";
import type { EventRow } from "./eventSync.ts";
import { writeSeriesRows } from "./seriesRows.ts";
import { syncWindow } from "./syncWindow.ts";

/** Every stored row of series `masterId`: its instances and any master row. */
export function googleSeriesOrFilter(masterId: string): string {
  const q = masterId.replace(/"/g, '""');
  return `recurring_event_id.eq."${q}",provider_event_id.eq."${q}"`;
}

/**
 * `resource` is Google's answer for the master (or a single event). A series
 * is expanded over the sync window; a single event is its own one row.
 */
export async function materializeGoogleResource(
  account: GoogleAccount,
  calendarId: string,
  // deno-lint-ignore no-explicit-any
  resource: any,
  keep?: { rowId?: string; anchorMs: number } | null,
): Promise<Record<string, unknown> | null> {
  const masterId = String(resource?.id ?? "");
  if (!masterId) return null;
  let rows: EventRow[];
  if (isGoogleSeriesMaster(resource)) {
    const { start, end } = syncWindow();
    rows = (await fetchGoogleSeriesInstances(account, calendarId, masterId, start.toISOString(), end.toISOString()))
      .filter((r): r is NonNullable<typeof r> => Boolean(r)) as EventRow[];
  } else {
    const row = mapGoogleEvent(account, calendarId, resource);
    rows = row ? [row as EventRow] : [];
  }
  return await writeSeriesRows(
    { accountId: account.id, calendarId, seriesFilter: googleSeriesOrFilter(masterId) },
    rows,
    keep,
  );
}
