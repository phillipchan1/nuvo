// Which events the AI router should spend a completion on, as a pure function.
//
// Lifted out of `useEventRouter` deliberately. This is the code that decides how
// much money the app spends on completions, and it has already been the source
// of one incident (D-085: a 1000-row query cap made already-routed events read
// as candidates forever, looping against the LLM for as long as the app was
// open). A rule that expensive needs to be testable without mounting React.
//
// Pure, synchronous, no I/O — the hook fetches, this decides.

import { isVerdictStale } from "../../supabase/functions/_shared/domainRouting.ts";

/** A cached verdict, as far as candidate selection cares. */
export interface RoutedVerdict {
  routedAt: string | null;
  /** Null = judged and left unattributed. Those are the first to re-open when
   *  the domains change: an event nothing could claim is exactly the one a new
   *  or freshly-groomed domain is most likely to claim now. */
  domainId: string | null;
}

export interface RoutingCandidateInput<E> {
  /** Every event eligible for routing — already filtered for "counts as actual",
   *  not deterministically mapped, and not hidden. */
  eligible: E[];
  key: (e: E) => string;
  /** Newest-first ordering hint; the sweep reconciles recent weeks before old
   *  ones, because that is what the wall is showing. */
  startAt: (e: E) => string;
  routed: Map<string, RoutedVerdict>;
  /** Keys already spent on THIS session — the backstop that guarantees at most
   *  one completion per event per load even if the cache read comes back
   *  incomplete or a write silently fails. Without it, any hole in the cache is
   *  an unbounded billing loop. */
  attempted: Set<string>;
  /** `domainRoutingEpoch(domains)`. Empty string disables staleness entirely. */
  epoch: string;
  /** Per-call cap — the existing batch size. */
  batch: number;
  /** How many of the batch may be spent re-opening STALE verdicts. Never-routed
   *  events are the priority; re-sweeping is the background job. */
  staleBudget: number;
}

/** Never-routed events first, then stale verdicts (unattributed before
 *  attributed, newest before oldest), capped so a re-groom can't turn one app
 *  load into a bill. Convergence is unaffected: the leftovers are picked up on
 *  the next load, exactly as un-routed events already are. */
export function selectRoutingCandidates<E>(input: RoutingCandidateInput<E>): E[] {
  const { eligible, key, startAt, routed, attempted, epoch, batch, staleBudget } = input;

  const fresh: E[] = [];
  const stale: E[] = [];
  for (const e of eligible) {
    const k = key(e);
    if (attempted.has(k)) continue;
    const verdict = routed.get(k);
    if (!verdict) fresh.push(e);
    else if (isVerdictStale(verdict.routedAt, epoch)) stale.push(e);
  }

  if (fresh.length >= batch) return fresh.slice(0, batch);

  stale.sort((a, b) => {
    const ua = routed.get(key(a))?.domainId == null ? 0 : 1;
    const ub = routed.get(key(b))?.domainId == null ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return startAt(b).localeCompare(startAt(a));
  });

  const room = Math.min(batch - fresh.length, Math.max(0, staleBudget));
  return [...fresh, ...stale.slice(0, room)];
}
