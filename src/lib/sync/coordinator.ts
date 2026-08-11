/**
 * The coordinator: when to drain, and when it is safe to trust the server.
 *
 * The second half is the subtle one. Nuvo's caches are server-authoritative —
 * every mutation used to end in `invalidateQueries`, and the refetch was the
 * source of truth. With an outbox that no longer holds: a refetch fired while
 * writes are still queued returns rows that predate them, and the user watches
 * their offline edits evaporate one query at a time.
 *
 * So invalidation becomes conditional. A table with nothing pending refetches
 * immediately, exactly as before. A table that still owes the server is marked
 * instead, and refetched the moment its queue drains. The optimistic cache
 * carries the UI in between, which is precisely the window it exists for.
 *
 * The alternative — overlaying pending ops onto every query result — was
 * rejected: Nuvo's task caches are membership-filtered (inbox / day / anytime /
 * scheduled / slot), so an overlay would have to re-derive which filtered list
 * each queued row now belongs to, duplicating `patchCaches` in a second place.
 * Two copies of that rule is the drift this codebase already has a standing law
 * against.
 */

import type { QueryClient } from "@tanstack/react-query";
import { drain, type Transport } from "./engine";
import { pendingOps, refreshOutboxStatus, setOutboxStatus } from "./outbox";
import type { SyncTable } from "./ops";

/** Tables whose queries are waiting for a drain before they may refetch. */
const deferred = new Map<SyncTable, readonly string[][]>();

/** Synchronous mirror of which tables owe the server, so `invalidate` can
 *  decide without awaiting IndexedDB on every mutation. */
let owing = new Set<SyncTable>();

export function tablesOwing(): ReadonlySet<SyncTable> {
  return owing;
}

/** Recompute the mirror. Called after every enqueue and every drain. */
export async function refreshOwing(): Promise<void> {
  const ops = await pendingOps();
  owing = new Set(ops.map((o) => o.table));
}

/**
 * Invalidate a query key, unless doing so would overwrite work this device has
 * not yet delivered — in which case defer it until the drain that delivers it.
 */
export function invalidateWhenSafe(qc: QueryClient, table: SyncTable, key: readonly string[]) {
  if (!owing.has(table)) {
    qc.invalidateQueries({ queryKey: key });
    return;
  }
  const queued: readonly string[][] = deferred.get(table) ?? [];
  if (queued.some((k) => k.join("/") === key.join("/"))) return;
  deferred.set(table, [...queued, [...key]]);
}

/** Flush the invalidations a table was holding, now that it owes nothing. */
function releaseDeferred(qc: QueryClient, tables: Iterable<SyncTable>) {
  for (const table of tables) {
    const keys = deferred.get(table);
    if (!keys) continue;
    deferred.delete(table);
    for (const key of keys) qc.invalidateQueries({ queryKey: key });
  }
}

export interface SyncRunOptions {
  qc: QueryClient;
  transport: Transport;
}

/**
 * One full cycle: send what we owe, then let the queries that were holding
 * back refresh against the truth we just wrote.
 */
export async function syncNow({ qc, transport }: SyncRunOptions): Promise<void> {
  const before = new Set(owing);
  const report = await drain(transport);
  await refreshOwing();

  // Only release tables that are genuinely settled — a drain interrupted
  // halfway must not let a refetch land on top of the ops still queued.
  const settled = [...before].filter((t) => !owing.has(t));
  releaseDeferred(qc, settled);

  // Anything we actually delivered is now stale locally: the server may have
  // applied a field-LWW merge that rejected part of our patch, and the user
  // should see what really landed rather than what we hoped would.
  if (report.sent > 0) {
    for (const table of settled) qc.invalidateQueries({ queryKey: [table] });
    // "tasks"/"vertical" are cross-table blast radius (task_labels joins into
    // tasks, projects/domains feed vertical) so any settlement refreshes them —
    // but only once "tasks" itself owes nothing. A drain's `ops` snapshot is
    // taken before it starts sending; a second toggle queued mid-drain (still
    // owing, not yet part of any snapshot) is invisible to `settled` here. Firing
    // this refetch anyway would pull the pre-toggle server row over the still-
    // pending optimistic patch and flip the checkbox back — exactly the "fast
    // double-tap reverts" bug this guard exists to prevent.
    if (!owing.has("tasks")) {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["vertical"] });
    }
  }
}

/**
 * Wire the drain to the events that mean "the network might be back".
 *
 * `online` alone is not enough. It fires on regaining a *link*, which on a
 * phone routinely means a captive portal or a cell handoff that still cannot
 * reach Supabase; and an iOS PWA resumed from the background may never fire it
 * at all, because the tab was frozen rather than disconnected. Focus and
 * visibility are the events that actually correlate with "the user is here and
 * expects their work to have gone through".
 */
export function startSync(opts: SyncRunOptions): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 0;

  const run = async () => {
    if (stopped) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setOutboxStatus({ syncing: false });
      return;
    }
    await syncNow(opts);
    const status = await refreshOutboxStatus();
    // Still owed something after a pass means the drain was interrupted; back
    // off rather than hammering a network that is clearly not ready.
    if (status.pending > 0) {
      backoff = Math.min(backoff ? backoff * 2 : 2_000, 60_000);
      schedule(backoff);
    } else {
      backoff = 0;
    }
  };

  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), ms);
  };

  const kick = () => {
    backoff = 0;
    void run();
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") kick();
  };

  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", onVisible);

  // An app that opens with work still queued from a previous life must not wait
  // for an event that may never come.
  void refreshOwing().then(kick);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener("online", kick);
    window.removeEventListener("focus", kick);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
