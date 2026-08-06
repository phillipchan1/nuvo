// The AI router's verdict cache, as a plain { eventKey → domainId } map.
//
// Events whose calendar is in `calendar_domain_map` are attributed
// deterministically and never touch this table. Everything else (a mixed
// personal calendar) gets routed once by the `agent` edge function and the
// answer is persisted in `event_domain_routing`; this hook reads it back so
// `buildVertical` can attribute those events without re-spending tokens.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

const EMPTY: Record<string, string> = {};

export function useEventRouting(): Record<string, string> {
  const { data } = useQuery({
    queryKey: ["event_domain_routing"],
    queryFn: async (): Promise<Record<string, string>> => {
      // Paged for the same reason `useEventRouter` pages its key set: an
      // unbounded select stops at 1000 rows, and a partial map silently drops
      // already-routed events back to "unattributed" in the domain ledger.
      const PAGE = 1000;
      const map: Record<string, string> = {};
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("event_domain_routing")
          .select("event_key, domain_id")
          .order("event_key")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = data ?? [];
        for (const r of rows) {
          if (r.domain_id) map[r.event_key as string] = r.domain_id as string;
        }
        if (rows.length < PAGE) break;
      }
      return map;
    },
    staleTime: 60_000,
  });
  return data ?? EMPTY;
}

/** Upsert a domain attribution for one event (Review correction path). */
export function useEventRoutingMutations() {
  const qc = useQueryClient();
  const upsert = useMutation({
    mutationFn: async ({ eventKey, domainId }: { eventKey: string; domainId: string }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const { error } = await supabase.from("event_domain_routing").upsert(
        {
          user_id: u.user.id,
          event_key: eventKey,
          domain_id: domainId,
          routed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,event_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event_domain_routing"] });
      qc.invalidateQueries({ queryKey: ["vertical"] });
    },
  });
  return { upsert };
}
