import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { applyLiveChange } from "../lib/sync/liveApply";
import { invalidateWhenSafe, pendingOps, pullSyncTables, SYNC_TABLES, tablesOwing, type SyncTable } from "../lib/sync";

const isSyncTable = (t: string): t is SyncTable =>
  (SYNC_TABLES as readonly string[]).includes(t);

const TABLE_TO_KEYS: Record<string, string[][]> = {
  tasks: [["tasks"]],
  task_labels: [["tasks"]],
  slots: [["slots"]],
  recurrences: [["recurrences"], ["tasks"], ["slots"]],
  labels: [["labels"]],
  external_events: [["external_events"]],
  calendar_accounts: [["calendar_accounts"]],
  user_settings: [["settings"]],
  domains: [["vertical"]],
  initiatives: [["vertical"]],
  projects: [["vertical"]],
  record_comments: [["record_comments"]],
  key_results: [["vertical"]],
  sprints: [["sprint"]],
  week_reviews: [["week_reviews"]],
  event_domain_routing: [["event_domain_routing"], ["vertical"]],
};

// Invalidations are coalesced over one animation-length window rather than
// fired per row. A sync writes events in batches of up to 500 and Realtime
// delivers one message per row, so a naive per-message invalidate turns a
// single calendar refresh into hundreds of refetches of the same query. That is
// how a quiet single-user account produced 3.6M calendar reads and took the
// connection pool down with it. Batching costs a frame of latency and bounds
// the client to one refetch per burst no matter how large the burst is.
const COALESCE_MS = 120;

/** Live updates: paint the Realtime row into the caches the UI already reads,
 *  then fall back to a coalesced invalidate only when we could not apply it
 *  (unknown shape, nested join, missing id). */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;

    // Keys awaiting invalidation, deduped — a burst touching the same table a
    // thousand times still ends as one entry. The source table rides along
    // because the refetch has to be gated on what this device still owes.
    const pending = new Map<string, { key: string[]; table: string }>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const entries = [...pending.values()];
      pending.clear();
      for (const { key, table } of entries) {
        // A Realtime echo must not overwrite work still sitting in the outbox.
        // This used to invalidate unconditionally, which was a live hole in the
        // offline guarantee rather than a theoretical one: Nuvo has server-side
        // writers (calendar sync every 15 minutes, the rollover cron), so a
        // refetch could land on top of queued local edits at any moment and
        // wipe them off the screen until the drain caught up — or permanently,
        // if the op had been parked. Syncable tables defer; everything else
        // (external events, calendar accounts) has no local queue to protect.
        if (isSyncTable(table)) invalidateWhenSafe(qc, table, key);
        else qc.invalidateQueries({ queryKey: key });
      }
    };

    const queue = (table: string) => {
      for (const key of TABLE_TO_KEYS[table] ?? []) pending.set(key.join("/"), { key, table });
      if (pending.size && timer === null) timer = setTimeout(flush, COALESCE_MS);
    };

    const onChange = (payload: {
      table: string;
      eventType: string;
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => {
      const paint = (ops: Parameters<typeof applyLiveChange>[2]) => {
        if (applyLiveChange(qc, payload, ops)) return;
        queue(payload.table);
      };

      // Only hit IndexedDB when this table actually owes a write — the common
      // "Friday moved a block while I'm looking" path is a synchronous cache
      // patch and nothing else.
      if (isSyncTable(payload.table) && tablesOwing().has(payload.table)) {
        void pendingOps().then(paint);
        return;
      }
      paint([]);
    };

    // ── One channel per table ────────────────────────────────────────────
    //
    // This used to be a single `nuvo-db-changes` channel carrying all sixteen
    // `postgres_changes` bindings, and it silently delivered NOTHING. The
    // channel reported `SUBSCRIBED`, `channel.state` was `"joined"`, all
    // sixteen bindings were present client-side — and no row ever arrived.
    // Verified against the live project by subscribing two channels on one
    // socket in the same tick and writing a single row: the sixteen-binding
    // channel got nothing, a one-binding channel got the INSERT, and sixteen
    // channels of one binding each get everything.
    //
    // That silence is the whole "my Mac is minutes behind my phone" report.
    // Realtime was the desktop's ONLY live path — there is no pull-to-refresh
    // there, and a Tauri window that never leaves the foreground never fires
    // the visibility event TanStack's focus refetching rides on — so a
    // subscription that delivered nothing meant a desktop that learned nothing
    // until it was reloaded.
    //
    // Still per-table rather than schema-wide: a schema-wide listener asks
    // Realtime to decode and deliver EVERY public write, including the ones
    // this client has no query for.
    const TABLES = Object.keys(TABLE_TO_KEYS);
    const channels = new Map<string, RealtimeChannel>();
    const retries = new Map<string, ReturnType<typeof setTimeout>>();
    const attempts = new Map<string, number>();
    const joinedOnce = new Set<string>();
    let torn = false;

    const clearRetry = (table: string) => {
      const t = retries.get(table);
      if (t !== undefined) {
        clearTimeout(t);
        retries.delete(table);
      }
    };

    /**
     * Realtime never replays what was missed while a channel was down, so a
     * *re*join is the moment this device is most wrong. One pull covers a
     * burst of them: sixteen channels recovering together after a laptop wakes
     * is one gap to close, not sixteen.
     */
    let backfill: ReturnType<typeof setTimeout> | null = null;
    const scheduleBackfill = () => {
      if (backfill !== null) return;
      backfill = setTimeout(() => {
        backfill = null;
        if (!torn) pullSyncTables(qc);
      }, 250);
    };

    const connect = (table: string) => {
      if (torn) return;
      clearRetry(table);
      const existing = channels.get(table);
      if (existing) supabase.removeChannel(existing);

      const ch = supabase.channel(`nuvo-rt-${table}`);
      channels.set(table, ch);
      ch.on("postgres_changes", { event: "*", schema: "public", table }, (payload) =>
        onChange(payload),
      );
      ch.subscribe((status) => {
        if (torn) return;
        if (status === "SUBSCRIBED") {
          attempts.set(table, 0);
          if (joinedOnce.has(table)) scheduleBackfill();
          joinedOnce.add(table);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // Backoff, capped: a rejoin storm against a server that is refusing
          // us is how a quiet account generates a loud bill.
          const n = (attempts.get(table) ?? 0) + 1;
          attempts.set(table, n);
          const delay = Math.min(30_000, 1_000 * 2 ** Math.min(n - 1, 5));
          clearRetry(table);
          retries.set(table, setTimeout(() => connect(table), delay));
        }
      });
    };

    for (const table of TABLES) connect(table);

    // Coming back to the app is the moment a dead channel matters. Rejoining
    // now rather than waiting out the backoff is also what makes the backfill
    // above fire while the user is still looking at the stale board.
    const onWake = () => {
      if (torn) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      for (const table of TABLES) {
        if (channels.get(table)?.state === "joined") continue;
        attempts.set(table, 0);
        connect(table);
      }
    };
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      torn = true;
      for (const table of TABLES) clearRetry(table);
      if (backfill !== null) clearTimeout(backfill);
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
      for (const ch of channels.values()) supabase.removeChannel(ch);
    };
  }, [enabled, qc]);
}
