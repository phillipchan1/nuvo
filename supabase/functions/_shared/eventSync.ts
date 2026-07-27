// One place that decides what a calendar sync actually WRITES.
//
// Every provider sync used to hand PostgREST the full set of events it had just
// fetched and let `upsert` sort it out. That is correct and catastrophically
// expensive: `last_synced_at` is stamped fresh on every mapped row, so every
// row differed from its stored version and Postgres wrote a new tuple for all
// of them — every 15 minutes, forever. Measured on one account: 3,109,992
// updates against 2,796 live rows. Each of those is a WAL record that Realtime
// decodes and fans out, and every client then refetches the calendar. That is
// the loop that saturated the pool.
//
// So: read back a tiny (provider_event_id, content_hash) projection first, and
// write only rows whose content actually changed. Steady state on an unchanged
// calendar is ZERO writes, which means zero WAL, zero Realtime traffic and zero
// client refetches.
//
// The sweep is set-based rather than "anything I didn't just stamp": since
// unchanged rows are deliberately NOT rewritten, `last_synced_at < runStamp` no
// longer means "gone upstream" — it means "unchanged", and sweeping on it would
// delete the entire calendar. The reconcile read already tells us exactly which
// stored rows the provider stopped sending, so we delete precisely those.
import { admin } from "./admin.ts";

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
  // deno-lint-ignore no-explicit-any
  raw: any;
  last_synced_at: string;
  content_hash?: string;
}

/** 64-bit change-detection hash (FNV-1a + djb2, 16 hex chars).
 *
 *  Not cryptographic — it only has to answer "did this event change?". Two
 *  independent 32-bit accumulators keep collisions negligible across the few
 *  thousand events an account holds, and it stays synchronous so hashing a
 *  2,000-event feed costs no awaits.
 *
 *  `raw` is included deliberately: it carries the provider's own revision
 *  markers (Google's etag/updated, CalDAV's href/etag) and downstream code
 *  reads it — google-events pulls recurringEventId out of it, icloud-events
 *  needs a current caldav_etag to write back. Hashing it means a row whose
 *  visible fields match but whose provider revision moved still gets refreshed.
 *  `last_synced_at` is excluded — it is bookkeeping, not content, and including
 *  it is precisely the bug this module exists to remove. */
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
  /** Restrict the read + sweep to a single calendar. Omit for whole-account
   *  providers (ICS feeds, and iCloud where the sweep spans all calendars). */
  calendarId?: string;
  /** Only sweep rows starting inside [sweepFrom, sweepTo). Google's full import
   *  only ever sees a 30d/120d window, so rows outside it were never fetched
   *  and must survive. */
  sweepFrom?: string;
  sweepTo?: string;
}

export interface ReconcileResult {
  written: number;
  deleted: number;
  unchanged: number;
}

/** calendar_id → provider_event_id → value. Nested rather than a joined string
 *  key so nothing has to escape separators out of CalDAV URLs and iCal UIDs. */
type ByCalendar<T> = Map<string, Map<string, T>>;

function put<T>(m: ByCalendar<T>, cal: string, id: string, v: T): void {
  let inner = m.get(cal);
  if (!inner) {
    inner = new Map<string, T>();
    m.set(cal, inner);
  }
  inner.set(id, v);
}

/** Read what's stored, write only what changed, delete only what's gone.
 *
 *  `rows` must be every event the provider reported for this scope in this
 *  pass — the sweep treats absence as deletion. Pass `sweep: false` for
 *  delta-based providers (M365, Google incremental) where absence just means
 *  "unchanged since the last token" and deletions arrive as explicit tombstones. */
export async function reconcileEvents(
  scope: ReconcileScope,
  rows: EventRow[],
  opts: { sweep: boolean },
): Promise<ReconcileResult> {
  // Dedupe on the upsert key — a repeated UID in a feed would otherwise make a
  // single batch touch the same row twice, which PostgREST rejects outright.
  const incoming: ByCalendar<EventRow> = new Map();
  for (const r of rows) put(incoming, r.calendar_id, r.provider_event_id, r);

  // Nothing reported and nothing to sweep: the common polling outcome on a
  // delta provider. Don't even read.
  if (!opts.sweep && rows.length === 0) return { written: 0, deleted: 0, unchanged: 0 };

  const stored: ByCalendar<string | null> = new Map();
  const collect = (
    page: Record<string, unknown>[],
  ) => {
    for (const r of page) {
      put(
        stored,
        r.calendar_id as string,
        r.provider_event_id as string,
        (r.content_hash as string | null) ?? null,
      );
    }
  };

  // Existing state: two small columns, never `raw`. This read is the whole
  // reason the write side can stay quiet. Each query is built fresh — a
  // PostgREST builder is single-shot and reusing one across awaits compounds
  // its filters.
  const base = () =>
    admin
      .from("external_events")
      .select("provider_event_id, calendar_id, content_hash")
      .eq("account_id", scope.accountId);

  if (!opts.sweep) {
    // Delta pass: we only need the stored hashes for the handful of events the
    // provider just reported, so ask for exactly those instead of paging the
    // whole calendar every five minutes.
    for (const [cal, byId] of incoming) {
      const ids = [...byId.keys()];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await base()
          .eq("calendar_id", cal)
          .in("provider_event_id", ids.slice(i, i + 200));
        if (error) throw error;
        collect(data ?? []);
      }
    }
  } else {
    // Sweeping: absence is meaningful, so the read must cover the full scope.
    // PostgREST caps an unbounded select at 1000 rows, and a short read would
    // make stored rows look absent — they'd be rewritten (noise) and, worse,
    // the sweep would delete rows it simply never saw. Page until short.
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = base();
      if (scope.calendarId) q = q.eq("calendar_id", scope.calendarId);
      if (scope.sweepFrom) q = q.gte("start_at", scope.sweepFrom);
      if (scope.sweepTo) q = q.lt("start_at", scope.sweepTo);
      const { data, error } = await q
        .order("calendar_id")
        .order("provider_event_id")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const page = data ?? [];
      collect(page);
      if (page.length < PAGE) break;
    }
  }

  const changed: EventRow[] = [];
  let unchanged = 0;
  for (const [cal, byId] of incoming) {
    const storedCal = stored.get(cal);
    for (const [id, row] of byId) {
      const hash = contentHash(row);
      // A stored NULL hash is a row written before this module existed — treat
      // as changed so it gets stamped once, then settles.
      if (storedCal?.get(id) === hash) {
        unchanged++;
        continue;
      }
      changed.push({ ...row, content_hash: hash });
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < changed.length; i += CHUNK) {
    const { error } = await admin
      .from("external_events")
      .upsert(changed.slice(i, i + CHUNK), {
        onConflict: "account_id,calendar_id,provider_event_id",
      });
    if (error) throw error;
  }

  let deleted = 0;
  if (opts.sweep) {
    // Exactly the stored rows the provider stopped sending. Usually empty.
    for (const [cal, byId] of stored) {
      const incomingCal = incoming.get(cal);
      const stale = [...byId.keys()].filter((id) => !incomingCal?.has(id));
      // Chunk the id list so the request URL stays a sane length.
      for (let i = 0; i < stale.length; i += 200) {
        const { error } = await admin
          .from("external_events")
          .delete()
          .eq("account_id", scope.accountId)
          .eq("calendar_id", cal)
          .in("provider_event_id", stale.slice(i, i + 200));
        if (error) throw error;
      }
      deleted += stale.length;
    }
  }

  return { written: changed.length, deleted, unchanged };
}
