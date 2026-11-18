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
import { fetchWithDelta } from "../lib/sync/rangeDelta";

const EMPTY: EventDomainRoutingMap = {};

type RoutingRow = {
  event_key: string;
  domain_id: string | null;
  manual_domain_id?: string | null;
};

function routeFromRow(r: RoutingRow): EventDomainRoutingMap[string] {
  return {
    ...(r.domain_id ? { inferredDomainId: r.domain_id } : {}),
    ...(r.manual_domain_id ? { manualDomainId: r.manual_domain_id } : {}),
  };
}

function rowsToMap(rows: RoutingRow[]): EventDomainRoutingMap {
  const map: EventDomainRoutingMap = {};
  for (const r of rows) map[r.event_key] = routeFromRow(r);
  return map;
}

function mapToRows(map: EventDomainRoutingMap): RoutingRow[] {
  return Object.entries(map).map(([event_key, route]) => ({
    event_key,
    domain_id: route.inferredDomainId ?? null,
    manual_domain_id: route.manualDomainId ?? null,
  }));
}

async function fetchRoutingMap(prev?: EventDomainRoutingMap): Promise<EventDomainRoutingMap> {
  // Paged for the same reason `useEventRouter` pages its key set: an
  // unbounded select stops at 1000 rows, and a partial map silently drops
  // already-routed events back to "unattributed" in the domain ledger.
  // Empty verdicts stay in the map so the AI router never re-asks them.
  const PAGE = 1000;
  const search = new URLSearchParams();
  search.set("select", "event_key,domain_id,manual_domain_id");
  search.set("order", "event_key.asc");
  const rows = await fetchWithDelta<RoutingRow>({
    table: "event_domain_routing",
    search,
    cursorKey: "event_domain_routing",
    identity: (row) => row.event_key,
    prev: prev ? mapToRows(prev) : undefined,
    full: async () => {
      const all: RoutingRow[] = [];
      let hasManualColumn = true;
      for (let from = 0; ; from += PAGE) {
        const withManual = await supabase
          .from("event_domain_routing")
          // Runtime column added by migration 82. The literal cast keeps the
          // generated PostgREST parser compatible until types are regenerated.
          .select((hasManualColumn ? "event_key, domain_id, manual_domain_id" : "event_key, domain_id") as "event_key, domain_id")
          .order("event_key")
          .range(from, from + PAGE - 1);
        let page = (withManual.data ?? []) as unknown as RoutingRow[];
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
          page = (legacy.data ?? []) as RoutingRow[];
        } else if (withManual.error) {
          throw withManual.error;
        }
        all.push(...page);
        if (page.length < PAGE) break;
      }
      return all;
    },
  });
  return rowsToMap(rows);
}

function useRoutingQuery() {
  return useQuery({
    queryKey: ["event_domain_routing"] as const,
    queryFn: ({ client, queryKey }) =>
      fetchRoutingMap(client.getQueryData<EventDomainRoutingMap>(queryKey)),
    // Once per session. The feed paints remote edits; local upserts patch the
    // cache. A 60s staleTime was the 0.37 GB/day refetch (D-249).
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useEventRouting(): EventDomainRoutingMap {
  return useRoutingQuery().data ?? EMPTY;
}

/** False until the session map has loaded — the AI router must not treat an
 *  empty placeholder as "nothing is judged yet". */
export function useEventRoutingFetched(): boolean {
  return useRoutingQuery().isFetched;
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
      qc.invalidateQueries({ queryKey: ["vertical"] });
    },
  });
  return { upsert };
}
