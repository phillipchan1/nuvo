// The AI router's verdict cache, as a plain { eventKey → domainId } map.
//
// Events whose calendar is in `calendar_domain_map` are attributed
// deterministically and never touch this table. Everything else (a mixed
// personal calendar) gets routed once by the `agent` edge function and the
// answer is persisted in `event_domain_routing`; this hook reads it back so
// `buildVertical` can attribute those events without re-spending tokens.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { ROUTING_CONFIDENCE_FLOOR } from "../../supabase/functions/_shared/domainRouting.ts";

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
          .select("event_key, domain_id, confidence")
          .order("event_key")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = data ?? [];
        for (const r of rows) {
          // The model's own confidence has been collected since this table
          // existed and read by nobody, so a coin-flip guess counted exactly
          // like a certainty and quietly put an hour in the wrong domain. Below
          // the floor the verdict stays CACHED (we never re-spend on it) but
          // reads as unattributed — honest emptiness over confident fiction.
          // A null confidence is a human correction: always authoritative.
          const c = r.confidence as number | null;
          if (r.domain_id && (c == null || c >= ROUTING_CONFIDENCE_FLOOR)) {
            map[r.event_key as string] = r.domain_id as string;
          }
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
          // Written explicitly: a partial upsert leaves the omitted column
          // alone, so without this a human correction would inherit whatever
          // the model had scored and could be filtered out by its own floor.
          // The person said so — that is the highest confidence there is.
          confidence: 1,
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
