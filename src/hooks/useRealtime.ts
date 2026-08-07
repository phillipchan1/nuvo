import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { invalidateWhenSafe, SYNC_TABLES, type SyncTable } from "../lib/sync";

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

/** Live updates: any server-side change (sync jobs, rollover, other devices)
 *  invalidates the matching query caches. Boring on purpose. */
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

    // Subscribe per table, never to the whole schema. A schema-wide listener
    // asks Realtime to decode and deliver EVERY public write — including the
    // ones this client has no query for — so unrelated server-side churn still
    // costs WAL decode, RLS checks and socket traffic per row. Naming the
    // tables keeps the fan-out proportional to what the UI actually renders.
    const channel = supabase.channel("nuvo-db-changes");
    for (const table of Object.keys(TABLE_TO_KEYS)) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) =>
        queue(payload.table),
      );
    }
    channel.subscribe();

    return () => {
      if (timer !== null) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}
