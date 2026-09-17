// The event attribution cache. Each row can carry an AI verdict and, separately,
// a person's explicit correction; the latter must never be overwritten by AI.
//
// Events whose calendar is in `calendar_domain_map` are attributed
// deterministically and never touch this table. Everything else (a mixed
// personal calendar) gets routed once by the `agent` edge function and the
// answer is persisted in `event_domain_routing`; this hook reads it back so
// `buildVertical` can attribute those events without re-spending tokens.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { EventDomainRoutingMap } from "../lib/eventActuals";

const EMPTY: EventDomainRoutingMap = {};

export function useEventRouting(): EventDomainRoutingMap {
  const { data } = useQuery({
    queryKey: ["event_domain_routing"],
    queryFn: async (): Promise<EventDomainRoutingMap> => {
      // Paged for the same reason `useEventRouter` pages its key set: an
      // unbounded select stops at 1000 rows, and a partial map silently drops
      // already-routed events back to "unattributed" in the domain ledger.
      const PAGE = 1000;
      const map: EventDomainRoutingMap = {};
      let hasManualColumn = true;
      for (let from = 0; ; from += PAGE) {
        const withManual = await supabase
          .from("event_domain_routing")
          // Runtime column added by migration 82. The literal cast keeps the
          // generated PostgREST parser compatible until types are regenerated.
          .select((hasManualColumn ? "event_key, domain_id, manual_domain_id" : "event_key, domain_id") as "event_key, domain_id")
          .order("event_key")
          .range(from, from + PAGE - 1);
        let rows = (withManual.data ?? []) as unknown as Array<{
          event_key: string;
          domain_id: string | null;
          manual_domain_id?: string | null;
        }>;
        // Rolling deploy safety: the reader can ship before migration 82 lands.
        // The control still shows calendar/AI attribution; writes become
        // available as soon as the new column exists.
        if (withManual.error && hasManualColumn) {
          hasManualColumn = false;
          const legacy = await supabase
            .from("event_domain_routing")
            .select("event_key, domain_id")
            .order("event_key")
            .range(from, from + PAGE - 1);
          if (legacy.error) throw legacy.error;
          rows = (legacy.data ?? []) as typeof rows;
        } else if (withManual.error) {
          throw withManual.error;
        }
        for (const r of rows) {
          const inferredDomainId = r.domain_id as string | null;
          const manualDomainId = r.manual_domain_id as string | null;
          if (inferredDomainId || manualDomainId) {
            map[r.event_key as string] = {
              ...(inferredDomainId ? { inferredDomainId } : {}),
              ...(manualDomainId ? { manualDomainId } : {}),
            };
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

/** Upsert a person's explicit attribution for one event. */
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
          manual_domain_id: domainId,
          routed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,event_key" },
      );
      if (error) throw error;
    },
    onMutate: async ({ eventKey, domainId }) => {
      await qc.cancelQueries({ queryKey: ["event_domain_routing"] });
      const previous = qc.getQueryData<EventDomainRoutingMap>(["event_domain_routing"]);
      qc.setQueryData<EventDomainRoutingMap>(["event_domain_routing"], (current = {}) => ({
        ...current,
        [eventKey]: {
          ...current[eventKey],
          manualDomainId: domainId,
        },
      }));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(["event_domain_routing"], context.previous);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event_domain_routing"] });
      qc.invalidateQueries({ queryKey: ["vertical"] });
    },
  });
  return { upsert };
}
