// Write a series' occurrence rows the way the next sync will — and keep the
// row the user has open.
//
// Any write that reshapes a series (create it, change its rule, move all of it)
// changes which occurrence rows exist and what they're keyed by. Left to the
// sync, the old rows are swept and the new ones arrive minutes later: the
// calendar shows a weekly event as one day, and the open sheet / chat card hold
// an id that no longer exists, so their next edit is "event not found". Here the
// caller hands over the rows the provider now has (expanded over the sync's own
// window), and this writes exactly those, sweeps the series' stale ones, and
// RE-KEYS the open row onto its occurrence instead of deleting it.
import { admin } from "./admin.ts";
import { contentHash, type EventRow } from "./eventSync.ts";

export interface SeriesScope {
  accountId: string;
  calendarId: string;
  /** PostgREST `.or()` clause matching every stored row of this series. */
  seriesFilter: string;
}

const COLUMNS = "id, account_id, provider_event_id, calendar_id, title, start_at, end_at, all_day, location, busy";

/** Of a series' freshly expanded rows, the one an open sheet should keep
 *  pointing at: the occurrence at `anchorMs` if there is one, else the nearest. */
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

/**
 * `keep.rowId` re-keys that existing row onto the occurrence nearest
 * `anchorMs`. Returns the row at the anchor (the kept one when there is one).
 */
export async function writeSeriesRows(
  scope: SeriesScope,
  incoming: EventRow[],
  keep?: { rowId?: string; anchorMs: number } | null,
): Promise<Record<string, unknown> | null> {
  const rows = incoming.map((r) => ({ ...r, content_hash: contentHash(r) }));

  const { data: existing, error: readErr } = await admin
    .from("external_events")
    .select("id, provider_event_id")
    .eq("account_id", scope.accountId)
    .eq("calendar_id", scope.calendarId)
    .or(scope.seriesFilter);
  if (readErr) throw new Error(`read series: ${readErr.message}`);
  const stored = (existing ?? []) as { id: string; provider_event_id: string }[];

  const rowId = keep?.rowId;
  let kept: Record<string, unknown> | null = null;
  let anchor: EventRow | null = null;
  if (keep && rowId) {
    anchor = pickAnchorRow(rows, keep.anchorMs);
    if (anchor) {
      // Whoever already holds the anchor's key gives it up to the open row.
      const key = anchor.provider_event_id;
      const squatter = stored.find((s) => s.provider_event_id === key && s.id !== rowId);
      if (squatter) await admin.from("external_events").delete().eq("id", squatter.id);
      const { data, error } = await admin
        .from("external_events")
        .update(anchor)
        .eq("id", rowId)
        .select(COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`re-key row: ${error.message}`);
      kept = data ?? null;
      if (!kept) anchor = null; // the row was already gone — upsert it below
    }
  }

  const rest = rows.filter((r) => r !== anchor);
  for (let i = 0; i < rest.length; i += 500) {
    const { error } = await admin
      .from("external_events")
      .upsert(rest.slice(i, i + 500), { onConflict: "account_id,calendar_id,provider_event_id" });
    if (error) throw new Error(`write series: ${error.message}`);
  }

  const emitted = new Set(rows.map((r) => r.provider_event_id));
  const stale = stored
    .filter((s) => !emitted.has(s.provider_event_id) && !(kept && s.id === rowId))
    .map((s) => s.id);
  for (let i = 0; i < stale.length; i += 200) {
    await admin.from("external_events").delete().in("id", stale.slice(i, i + 200));
  }

  if (kept) return kept;
  const first = keep ? pickAnchorRow(rows, keep.anchorMs) : rows[0] ?? null;
  if (!first) return null;
  const { data } = await admin
    .from("external_events")
    .select(COLUMNS)
    .eq("account_id", scope.accountId)
    .eq("calendar_id", scope.calendarId)
    .eq("provider_event_id", first.provider_event_id)
    .maybeSingle();
  return data ?? null;
}
