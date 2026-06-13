import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

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
  key_results: [["vertical"]],
  sprints: [["sprint"]],
};

/** Live updates: any server-side change (sync jobs, rollover, other devices)
 *  invalidates the matching query caches. Boring on purpose. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("nuvo-db-changes")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        for (const key of TABLE_TO_KEYS[payload.table] ?? []) {
          qc.invalidateQueries({ queryKey: key });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}
