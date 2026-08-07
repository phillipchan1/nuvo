// When the domains last changed shape — the one timestamp that says whether a
// cached routing verdict is still answering the current question.
//
// Both routing caches (`event_domain_routing` per event, `tasks.suggestion` per
// capture) are permanent by design: a verdict is never re-spent. That was also
// their bug — re-grooming a domain, editing a charter, or adding a whole new
// domain re-opened nothing, so the wall kept showing verdicts formed before the
// domain existed. This is the cheap half of the fix; `domainRoutingEpoch` is the
// rule, and `selectRoutingCandidates` bounds what re-opening costs.
//
// Its own tiny query rather than a read off `useVertical`: the passive groomer
// and the event router both need it, and neither should have to pull the whole
// vertical snapshot to learn one timestamp.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { domainRoutingEpoch } from "../../supabase/functions/_shared/domainRouting.ts";

export function useDomainEpoch(): string {
  const { data } = useQuery({
    queryKey: ["domains", "routing-epoch"],
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.from("domains").select("created_at, context_at");
      if (error) throw error;
      return domainRoutingEpoch(data ?? [], new Date().toISOString());
    },
    staleTime: 60_000,
  });
  return data ?? "";
}
