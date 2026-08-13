/**
 * The async half of search.
 *
 * Vertical hits are local and instant; calendar hits come from the server (see
 * the header of `lib/eventSearch.ts` for why they are not cached locally). The
 * contract this hook keeps, so the keystroke path stays butter-smooth:
 *
 *   · it NEVER blocks the field — the caller renders vertical hits immediately
 *     and this group appears when it lands;
 *   · it is debounced, so typing "sam" is one query, not three;
 *   · results are cached per query, so backspacing to a query you already typed
 *     is instant and fires nothing;
 *   · offline it reports `offline` rather than an empty result, because "no
 *     matches" and "couldn't look" are different answers.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchEvents, type EventHit } from "../lib/eventSearch";

const DEBOUNCE_MS = 180;
/** Below this the query matches half the calendar; not worth the round-trip. */
const MIN_CHARS = 2;

export function useEventSearch(query: string): {
  hits: EventHit[];
  loading: boolean;
  offline: boolean;
  failed: boolean;
} {
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState(trimmed);

  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      setDebounced("");
      return;
    }
    const id = window.setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [trimmed]);

  const online = typeof navigator === "undefined" || navigator.onLine;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["event_search", debounced],
    enabled: debounced.length >= MIN_CHARS && online,
    // A calendar doesn't change between two keystrokes; re-typing the same
    // search inside a minute should cost nothing.
    staleTime: 60_000,
    // Search failing is a group that doesn't render, not a red toast over the
    // whole app — the query cache's global handler would otherwise alarm on a
    // half-typed word that hit a blip.
    meta: { silent: true },
    retry: false,
    queryFn: () => searchEvents(debounced),
  });

  return {
    hits: data ?? [],
    loading: isFetching,
    offline: !online && trimmed.length >= MIN_CHARS,
    failed: isError,
  };
}
