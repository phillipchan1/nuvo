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
 * That gate only covers *our* `invalidateQueries` calls. TanStack also
 * refetches on its own (window focus, reconnect, mount, an in-flight select
 * `cancelQueries` couldn't abort because the request had no AbortSignal).
 * Those writes are merged through `preserveOwingRows` so a create cannot
 * vanish, and skipped entirely via `queryKeyOwesServer` when possible.
 *
 * The alternative — overlaying pending ops onto every query result — was
 * rejected: Nuvo's task caches are membership-filtered (inbox / day / anytime /
 * scheduled / slot), so an overlay would have to re-derive which filtered list
 * each queued row now belongs to, duplicating `patchCaches` in a second place.
 * Two copies of that rule is the drift this codebase already has a standing law
 * against. `preserveOwingRows` only keeps rows already in *that* query's cache.
 */

import type { QueryClient } from "@tanstack/react-query";
import { drain, type Transport } from "./engine";
import { pendingOps, refreshOutboxStatus, setOutboxStatus } from "./outbox";
import { SYNC_TABLES, type SyncTable } from "./ops";

/** Tables whose queries are waiting for a drain before they may refetch. */
const deferred = new Map<SyncTable, readonly string[][]>();

/** The row tables the ["vertical", …] caches are built from. */
const VERTICAL_SOURCES: ReadonlySet<SyncTable> = new Set([
  "projects",
  "initiatives",
  "domains",
  "key_results",
]);

/** Synchronous mirror of which tables owe the server, so `invalidate` can
 *  decide without awaiting IndexedDB on every mutation. */
let owing = new Set<SyncTable>();

export function tablesOwing(): ReadonlySet<SyncTable> {
  return owing;
}

/**
 * True when a refetch of this query would paint a server snapshot that
 * predates work this device still owes. `invalidateWhenSafe` already gates
 * explicit invalidation — this is for the paths that bypass it
 * (`refetchOnWindowFocus`, `refetchOnReconnect`, an in-flight select).
 */
export function queryKeyOwesServer(queryKey: readonly unknown[]): boolean {
  const root = String(queryKey[0] ?? "");
  if (root === "vertical") {
    const sub = queryKey[1];
    if (typeof sub === "string" && VERTICAL_SOURCES.has(sub as SyncTable)) {
      return owing.has(sub as SyncTable);
    }
    return [...VERTICAL_SOURCES].some((t) => owing.has(t));
  }
  if (root === "tasks" || root === "task_labels") {
    return owing.has("tasks") || owing.has("task_labels");
  }
  if ((SYNC_TABLES as readonly string[]).includes(root)) return owing.has(root as SyncTable);
  return false;
}

/**
 * A refetch of a table we still owe must not drop rows this device already
 * painted. Create used to: optimistic project lands in the cache, a 15s-stale
 * window-focus refetch returns the pre-insert server list, and the project
 * (and every task hanging off it) vanishes. Keep local-only ids until the
 * outbox drains; then the next refetch is allowed to be authoritative.
 *
 * This is not "overlay pending ops onto every filtered task list" — that was
 * rejected above. It only preserves rows *already in this query's cache*.
 */
export function preserveOwingRows<T extends { id: string }>(
  table: SyncTable,
  previous: unknown,
  incoming: unknown,
): T[] {
  const next = incoming as T[];
  if (!Array.isArray(next)) return next;
  if (!owing.has(table) || !Array.isArray(previous)) return next;
  const incomingIds = new Set(next.map((r) => r.id));
  const extras = (previous as T[]).filter((r) => r?.id && !incomingIds.has(r.id));
  return extras.length ? [...next, ...extras] : next;
}

/** Install cache-merge + refetch gates on the queries the outbox writes to. */
export function installOwingGuards(qc: QueryClient): void {
  const share = (table: SyncTable) => ({
    structuralSharing: (previous: unknown, incoming: unknown) =>
      preserveOwingRows(table, previous, incoming),
  });
  qc.setQueryDefaults(["vertical", "projects"], share("projects"));
  qc.setQueryDefaults(["vertical", "initiatives"], share("initiatives"));
  qc.setQueryDefaults(["vertical", "domains"], share("domains"));
  qc.setQueryDefaults(["tasks"], share("tasks"));
  qc.setQueryDefaults(["slots"], share("slots"));
}

/**
 * Mark a table as owing the instant its write is queued — synchronously,
 * before the IndexedDB round-trip. `queueWrite` is async and most callers
 * fire it with `void` rather than awaiting it (an optimistic patch plus
 * `invalidateWhenSafe` on the very next line is the standard mutation
 * shape), so `owing` has to be right *before* that `await` yields or the
 * immediate-refetch branch below races it: `invalidateWhenSafe` runs while
 * `owing` still reflects the pre-enqueue world, refetches from the server,
 * and clobbers the optimistic value with the stale row it's racing against
 * — a setting (or anything else on this pattern) visibly reverting the
 * instant you change it. `refreshOwing` still reconciles against IndexedDB
 * afterward for cross-tab/session truth; this just can't wait for it.
 */
export function markOwing(table: SyncTable): void {
  owing.add(table);
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
  const report = await drain(transport);
  await refreshOwing();

  // Release every deferred key whose table now owes nothing — a drain
  // interrupted halfway must not let a refetch land on top of ops still
  // queued, hence the owing filter. (This used to be gated on membership in a
  // pre-drain snapshot too, which stranded keys for a table that only started
  // owing mid-drain.)
  releaseDeferred(qc, [...deferred.keys()].filter((t) => !owing.has(t)));

  // Anything we actually delivered is now stale locally: the server may have
  // applied a field-LWW merge that rejected part of our patch, and the user
  // should see what really landed rather than what we hoped would. Scope is
  // report.sentTables — what this drain really delivered — never "everything".
  if (report.sent > 0) {
    const sent = [...report.sentTables].filter((t) => !owing.has(t));
    for (const table of sent) qc.invalidateQueries({ queryKey: [table] });

    // Cross-table blast radius, scoped to what was delivered: task_labels
    // joins into the ["tasks"] caches, and projects/initiatives/domains/
    // key_results feed the ["vertical", …] row caches. These used to fire on
    // ANY delivery, so a lone task create refetched the whole vertical and
    // re-ran buildVertical 3–4 extra times after the ack.
    //
    // The `owing` guards stay: a drain's `ops` snapshot is taken before it
    // starts sending, so a second toggle queued mid-drain is still owed once
    // it finishes. Refetching over it would pull the pre-toggle server row
    // over the still-pending optimistic patch and flip the checkbox back —
    // the "fast double-tap reverts" bug this guard exists to prevent.
    const touchesTasks = sent.some((t) => t === "tasks" || t === "task_labels");
    if (touchesTasks && !owing.has("tasks") && !owing.has("task_labels")) {
      qc.invalidateQueries({ queryKey: ["tasks"] });
    }
    const touchesVertical = sent.some((t) => VERTICAL_SOURCES.has(t));
    if (touchesVertical && ![...VERTICAL_SOURCES].some((t) => owing.has(t))) {
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
