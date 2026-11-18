/**
 * The change feed — how the Worker path learns what another device changed
 * (D-238).
 *
 * Supabase pushed every row over Realtime. The Worker has no socket, so the
 * client kept up by re-downloading: every stale query on every window focus,
 * every task / slot / label list on a timer, every task list after each of
 * its own writes. From one open Mac that was ~1.5 GB of Neon data transfer a
 * day — almost all of it rows the device already had.
 *
 * Now the client asks one question, `sync_changes` (worker/src/syncFeed.ts):
 * "what moved since my cursor?" — on launch, on focus, once a minute while the
 * window is visible, and right after its own writes land. The answer is one of:
 *
 *  • **delta** — the current row for each key that moved, or a DELETE for one
 *    that is gone. Each is painted through `applyLiveChange`, the path Realtime
 *    echoes always took: merged against this device's unsent and just-sent ops
 *    with field-LWW, placed in every cached list by the membership rules. A
 *    change that can't be painted refetches its table's keys instead, behind
 *    the outbox like any invalidate. While the feed answers in deltas the synced
 *    tables count as "live" (`liveHealth`), so a write no longer refetches every
 *    task list — the post-drain poll brings back what actually landed.
 *  • **version** — the Neon this Worker talks to has no change log yet (it is a
 *    hand-applied migration). Per-table fingerprints; only the tables whose
 *    fingerprint moved refetch.
 *  • **reset** — the cursor is unknown or older than the log: refetch every
 *    covered table once, as a launch always did.
 *
 * The queries the feed covers (`FEED_ROOTS`) stop going stale on a clock: their
 * `staleTime` is Infinity while the feed answers (`feedStaleTime`). If the
 * Worker doesn't know the RPC (an older deploy), the feed stands down and the
 * old clock — 60s pull, refetch-on-focus — comes back for the session.
 *
 * The cursor lives in the query cache under `["sync_feed"]`, so it is persisted
 * in the same snapshot as the rows it describes: a restored cache can never be
 * older than its cursor. And no poll runs until the persisted cache has been
 * restored, or a poll could advance a cursor past rows the restore then puts
 * back stale.
 */

import type { Query, QueryClient } from "@tanstack/react-query";
import { workersEnabled } from "../backend";
import { supabase } from "../supabase";
import { catchUpAfterOwingKnown, installChangeFeed, invalidateWhenSafe, tablesOwing } from "./coordinator";
import { setTableLive } from "./liveHealth";
import { applyLiveChange, type LiveChange } from "./liveApply";
import { FEED_KEYS, FEED_STATE_ROOT, FEED_TABLES, feedCoversKey } from "./liveKeys";
import { SYNC_TABLES, type Op, type SyncTable } from "./ops";
import { pendingOps, recentlyAcked } from "./outbox";

export const FEED_STATE_KEY = [FEED_STATE_ROOT] as const;

/** Focus and visibility fire together; one question answers both. */
export const FEED_MIN_GAP_MS = 5_000;

/** A poll that hasn't answered by now is abandoned; the next one asks again. */
export const FEED_TIMEOUT_MS = 20_000;

interface FeedState {
  cursor?: string;
  versions?: Record<string, string>;
}

type FeedAnswer =
  | { mode: "delta"; cursor: string; reset: boolean; changes: LiveChange[] }
  | { mode: "version"; versions: Record<string, string> };

type Health = "unknown" | "delta" | "version" | "down";
let health: Health = "unknown";

export function feedHealth(): Health {
  return health;
}

/** True while the feed — not a clock — decides when covered queries refetch. */
export function feedOwnsFreshness(): boolean {
  return workersEnabled && health !== "down";
}

/**
 * `staleTime` for a query the feed covers: never stale while the feed answers,
 * `fallbackMs` when it can't (Supabase path, or a Worker without the RPC).
 */
export function feedStaleTime(fallbackMs: number) {
  return (_query?: Query<any, any, any, any>): number => (feedOwnsFreshness() ? Infinity : fallbackMs);
}

const isSyncTable = (t: string): t is SyncTable => (SYNC_TABLES as readonly string[]).includes(t);

function setFeedLive(isLive: boolean) {
  for (const table of FEED_TABLES) setTableLive(table, isLive);
}

// ---------------------------------------------------------------------------
// Wait for the persisted cache
// ---------------------------------------------------------------------------

let restoreGate: Promise<void> = Promise.resolve();

/**
 * Hold every poll until the persisted query cache is back. Returns the
 * function to call once it is (the persist provider's onSuccess / onError).
 * Capped, so a restore that never reports can't silence the feed.
 */
export function holdFeedUntilRestored(capMs = 10_000): () => void {
  let release!: () => void;
  restoreGate = Promise.race([
    new Promise<void>((resolve) => (release = resolve)),
    new Promise<void>((resolve) => setTimeout(resolve, capMs)),
  ]);
  return () => release();
}

// ---------------------------------------------------------------------------
// Applying an answer
// ---------------------------------------------------------------------------

/** Refetch a table's caches, behind the outbox for a table it still owes.
 *  True when the refetch had to wait for a drain. */
function refetchTable(qc: QueryClient, table: string): boolean {
  const keys = FEED_KEYS[table] ?? [];
  if (!isSyncTable(table)) {
    for (const key of keys) qc.invalidateQueries({ queryKey: key });
    return false;
  }
  const held = tablesOwing().has(table);
  for (const key of keys) invalidateWhenSafe(qc, table, key);
  return held;
}

function writeState(qc: QueryClient, state: FeedState) {
  qc.setQueryData(FEED_STATE_KEY, state);
}

async function applyDelta(qc: QueryClient, prev: FeedState, answer: Extract<FeedAnswer, { mode: "delta" }>) {
  if (health !== "delta") setFeedLive(true);
  health = "delta";
  if (answer.reset) {
    for (const table of FEED_TABLES) refetchTable(qc, table);
    writeState(qc, { cursor: answer.cursor });
    return;
  }

  const owing = tablesOwing();
  // IndexedDB only when a changed table still owes a write — the common "the
  // phone moved a block" answer is a synchronous cache patch and nothing else.
  const pending: Op[] = answer.changes.some((c) => isSyncTable(c.table) && owing.has(c.table))
    ? await pendingOps()
    : [];
  const fallback = new Set<string>();
  for (const change of answer.changes) {
    const delivered = recentlyAcked().filter((o) => o.table === change.table);
    const ops = pending.filter((o) => o.table === change.table);
    if (!applyLiveChange(qc, change, ops, delivered)) fallback.add(change.table);
  }

  // A change that had to wait behind the outbox keeps the cursor where it was:
  // if the app quits before that drain, the next launch asks again instead of
  // trusting a cache that never got the row.
  let held = false;
  for (const table of fallback) held = refetchTable(qc, table) || held;
  writeState(qc, { cursor: held && prev.cursor ? prev.cursor : answer.cursor });
}

function applyVersions(qc: QueryClient, prev: FeedState, answer: Extract<FeedAnswer, { mode: "version" }>) {
  if (health === "delta") setFeedLive(false);
  health = "version";
  const next: Record<string, string> = { ...(prev.versions ?? {}) };
  for (const [table, version] of Object.entries(answer.versions)) {
    if (prev.versions?.[table] === version) continue;
    // A refetch held behind the outbox keeps the old fingerprint, so the next
    // poll asks for the table again rather than marking it seen.
    if (!refetchTable(qc, table)) next[table] = version;
  }
  writeState(qc, { versions: next });
}

/** The Worker doesn't know the RPC: hand freshness back to the clock. */
function standDown(qc: QueryClient) {
  if (health === "down") return;
  if (health === "delta") setFeedLive(false);
  health = "down";
  // Covered queries were held fresh by the feed; they are stale by the clock
  // now, and this is the refresh the feed would have been.
  catchUpAfterOwingKnown(qc);
}

async function pollOnce(qc: QueryClient, fresh: boolean): Promise<void> {
  const prev = qc.getQueryData<FeedState>(FEED_STATE_KEY) ?? {};
  lastPollAt = Date.now();
  // `p_fresh`: the Worker asks Postgres rather than its change marker (D-245).
  // After this device's own write the answer must carry what that write did;
  // and a launch always gets the truth, so a change the marker could ever have
  // missed is never further away than reopening the app.
  const args = fresh || !launched ? { p_since: prev.cursor ?? null, p_fresh: true } : { p_since: prev.cursor ?? null };
  // Bounded: polls share one in-flight promise, so a request that never
  // settles (a socket a sleeping laptop left half-open) would silence the feed.
  const { data, error, status } = await supabase
    .rpc("sync_changes", args)
    .abortSignal(AbortSignal.timeout(FEED_TIMEOUT_MS));
  if (!error) launched = true;
  if (error) {
    // PGRST202: this Worker has no such RPC. Anything else (offline, a 5xx) is
    // a blip — the next focus or minute asks again.
    if (status === 404 || error.code === "PGRST202") standDown(qc);
    return;
  }
  const answer = data as FeedAnswer | null;
  if (answer?.mode === "delta") await applyDelta(qc, prev, answer);
  else if (answer?.mode === "version") applyVersions(qc, prev, answer);
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

let inflight: Promise<void> | null = null;
let again = false;
let lastPollAt = 0;
/** This session has had one answer: later unforced polls may be answered at the edge. */
let launched = false;

/**
 * Ask the feed. Calls overlapping one in flight share it; a `force`d call (a
 * write just landed) runs once more after it, because the answer in flight
 * may have been read before that write committed. Unforced calls inside
 * `FEED_MIN_GAP_MS` of the last one are dropped.
 */
export function pollFeed(qc: QueryClient, opts: { force?: boolean } = {}): Promise<void> {
  if (!feedOwnsFreshness()) return Promise.resolve();
  if (inflight) {
    if (opts.force) again = true;
    return inflight;
  }
  if (!opts.force && Date.now() - lastPollAt < FEED_MIN_GAP_MS) return Promise.resolve();
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve();
  lastPollAt = Date.now();
  const run = (async () => {
    try {
      await restoreGate;
      await pollOnce(qc, opts.force === true);
    } catch {
      // A network failure is the same as no answer: ask again next time.
    } finally {
      inflight = null;
      if (again) {
        again = false;
        void pollFeed(qc, { force: true });
      }
    }
  })();
  inflight = run;
  return run;
}

/** Wire the feed into the coordinator's launch / focus / minute / post-write moments. */
export function installFeed(qc: QueryClient): void {
  // The cursor has no fetcher; it must outlive any idle period and never refetch.
  qc.setQueryDefaults(FEED_STATE_KEY, { gcTime: Infinity, staleTime: Infinity });
  installChangeFeed({ active: feedOwnsFreshness, covers: feedCoversKey, poll: pollFeed });
}

/** Test seam. */
export function resetFeedForTests(): void {
  health = "unknown";
  launched = false;
  inflight = null;
  again = false;
  lastPollAt = 0;
  restoreGate = Promise.resolve();
  setFeedLive(false);
  installChangeFeed(null);
}
