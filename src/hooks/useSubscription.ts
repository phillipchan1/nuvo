import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Subscription } from "../lib/subscription";

const KEY = ["subscription"];

/** Read-only — safe to call from anywhere (App.tsx, TrialBanner, the Settings
 *  billing pane). All callers share one cached query via `KEY`; only
 *  useSubscriptionLiveSync (mounted once, in App.tsx's Shell) needs to touch
 *  realtime — see there for why one shared channel beats one per consumer. */
export function useSubscription() {
  // The query MUST NOT run before the session is restored. Supabase restores
  // it asynchronously, and a subscriptions read without a session isn't an
  // error — RLS just returns zero rows, so `maybeSingle()` resolves to null
  // and a fully paid-up account reads as "not entitled" and gets thrown at
  // the paywall on every cold load. `undefined` here means "don't know yet".
  const [hasSession, setHasSession] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setHasSession(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const query = useQuery({
    queryKey: KEY,
    enabled: hasSession === true,
    queryFn: async (): Promise<Subscription | null> => {
      // Bound the request. App.tsx renders the splash for as long as this is
      // pending, and a saturated database makes PostgREST accept the connection
      // and then never answer — supabase-js has no default timeout, so the
      // promise simply never settles and the app sits on a shimmering wordmark
      // forever with nothing in the console. Failing after 8s routes into the
      // "Couldn't verify your subscription" card with its Try again button,
      // which is recoverable; an infinite splash is not.
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*, entitled")
        .abortSignal(AbortSignal.timeout(8_000))
        .maybeSingle();
      if (error) throw error;
      return data as Subscription | null;
    },
    // Three bounded attempts (~7s of backoff) before showing the error card, so
    // an ordinary blip still self-heals without the user seeing anything.
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
  });

  // isPending (not isLoading) is the right "we don't know yet" signal here:
  // isLoading is false while a query is network-paused (offline/reconnecting)
  // even though it never actually resolved — treating a paused fetch as
  // settled would let `!entitled` fall through to a false "not entitled".
  return {
    subscription: query.data,
    // "Still waiting on the session" counts as pending — App.tsx renders its
    // loader for this, never the paywall.
    isPending: hasSession === undefined || query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** Mount exactly once (App.tsx's Shell) — NOT inside useSubscription itself,
 *  since that hook is called from multiple components (TrialBanner, the
 *  Settings billing pane) and each would otherwise open its own realtime
 *  channel under the same fixed topic name, which Supabase's realtime
 *  client rejects ("tried to subscribe multiple times per channel").
 *  One shared channel invalidates the query cache; every useSubscription()
 *  caller picks up the fresh data for free. */
export function useSubscriptionLiveSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("nuvo-subscription")
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions" }, () =>
        qc.invalidateQueries({ queryKey: KEY }),
      )
      .subscribe();
    // The cache key isn't user-scoped, so drop it whenever the signed-in
    // identity changes — otherwise signing in as a second account could show
    // the previous user's billing state until the refetch lands. Supabase
    // re-fires SIGNED_IN for the SAME user whenever the window/tab regains
    // visibility (its session-recovery check on focus) — e.g. every time the
    // Tauri window is hidden (⌘W) and reopened. Track the last known user id
    // so that refocus refire doesn't wipe a perfectly good cache and flash
    // the loading splash for no reason.
    let lastUserId: string | null = null;
    const { data: auth } = supabase.auth.onAuthStateChange((e, session) => {
      const userId = session?.user.id ?? null;
      if (e === "SIGNED_OUT" || (e === "SIGNED_IN" && userId !== lastUserId)) {
        qc.removeQueries({ queryKey: KEY });
      }
      lastUserId = userId;
    });
    return () => {
      supabase.removeChannel(channel);
      auth.subscription.unsubscribe();
    };
  }, [qc]);
}
