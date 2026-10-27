/** The columns a sync writes. `content_hash` is filled in by reconcileEvents. */
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
  recurring_event_id?: string | null;
}

/** Same hash as supabase/functions/_shared/eventSync.ts — keep in lockstep. */
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
