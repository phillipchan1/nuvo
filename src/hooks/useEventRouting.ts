// The AI router's verdict cache, as a plain { eventKey → domainId } map.
//
// Events whose calendar is in `calendar_domain_map` are attributed
// deterministically and never touch this table. Everything else (a mixed
// personal calendar) gets routed once by the `agent` edge function and the
// answer is persisted in `event_domain_routing`; this hook reads it back so
// `buildVertical` can attribute those events without re-spending tokens.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

const EMPTY: Record<string, string> = {};

export function useEventRouting(): Record<string, string> {
  const { data } = useQuery({
    queryKey: ["event_domain_routing"],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("event_domain_routing")
        .select("event_key, domain_id");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of data ?? []) {
        if (r.domain_id) map[r.event_key as string] = r.domain_id as string;
      }
      return map;
    },
    staleTime: 60_000,
  });
  return data ?? EMPTY;
}
