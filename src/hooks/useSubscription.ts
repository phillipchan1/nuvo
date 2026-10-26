import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { workersEnabled } from "../lib/backend";
import {
  AUTH_SESSION_CHANGED,
  fetchPostgrestSubscription,
  fetchWorkerEntitlement,
} from "../lib/entitlementRead";
import { supabase } from "../lib/supabase";
import { isSpotlightWindow } from "../lib/platform";
import type { LiveChange } from "../lib/sync/liveApply";
import { liveTopic } from "../lib/sync/liveTopic";
import { isEntitled, writeWasEntitled } from "../lib/subscription";
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
    // The panel is not a billing surface. Skip the session probe — getSession
    // on an expired token still hits /token, and two heaps rotating one
    // refresh token is `refresh_token_already_used`.
    if (isSpotlightWindow()) {
      setHasSession(false);
      return;
    }
    if (workersEnabled) {
      let cancelled = false;
      let unlisten = () => {};
      void import("../lib/authClient").then(({ createNuvoAuthClient, signedBearerToken }) => {
        if (cancelled) return;
        const probe = async () => {
          if (signedBearerToken()) {
            if (!cancelled) setHasSession(true);
            return;
          }
          try {
            const { data } = await createNuvoAuthClient().getSession();
            if (!cancelled) setHasSession(Boolean(data?.user));
          } catch {
            if (!cancelled) setHasSession(false);
          }
        };
        void probe();
        window.addEventListener(AUTH_SESSION_CHANGED, probe);
        unlisten = () => window.removeEventListener(AUTH_SESSION_CHANGED, probe);
      });
      return () => {
        cancelled = true;
        unlisten();
      };
    }
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setHasSession(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const query = useQuery({
    queryKey: KEY,
    // The ⌥Space panel is not a billing surface and must not rotate tokens.
    enabled: hasSession === true && !isSpotlightWindow(),
    queryFn: async (): Promise<Subscription | null> => {
      // Bound the request. App.tsx renders the splash for as long as this is
      // pending, and a saturated database makes PostgREST accept the connection
      // and then never answer — supabase-js has no default timeout, so the
      // promise simply never settles and the app sits on a shimmering wordmark
      // forever with nothing in the console. Failing after 8s routes into the
      // "Couldn't verify your subscription" card with its Try again button,
      // which is recoverable; an infinite splash is not.
      //
      // Worker flag on → GET /api/entitlement with the Better Auth session.
      // Flag off → today's PostgREST select. Same 8s bound, same verify-error.
      if (workersEnabled) {
        const { signedBearerToken } = await import("../lib/authClient");
        return fetchWorkerEntitlement({ token: signedBearerToken() });
      }
      return fetchPostgrestSubscription(supabase, { skipRefresh: isSpotlightWindow() });
    },
    // Keep the last good row through a refetch blip so the shell doesn't
    // unmount the planner the moment the network hiccups.
    placeholderData: (prev) => prev,
    // Three bounded attempts (~7s of backoff) before showing the error card, so
    // an ordinary blip still self-heals without the user seeing anything.
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
    // A paying account looking at the error card (or the app held up by last
    // launch's hint) should recover on its own, not wait for a tap.
    refetchInterval: (q) => (q.state.status === "error" ? 5_000 : false),
  });

  // Record the outcome as the device-local optimistic-render hint (see
  // lib/subscription.ts) — every settle, not just the first, so a lapse
  // clears the hint just as readily as a renewal sets it. A null success is
  // not a real answer (interpretSubscriptionRead fails those), so we never
  // clear the hint on an empty read.
  useEffect(() => {
    if (!query.isSuccess || query.data == null) return;
    writeWasEntitled(isEntitled(query.data));
  }, [query.isSuccess, query.data]);

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
    // Worker path has no GoTrue JWT for the subscriptions topic. Refetch
    // on focus / the 5s error interval instead; do not open a dead channel.
    if (workersEnabled || isSpotlightWindow()) return;
    const onRow = (payload: LiveChange) => {
      if (payload.eventType === "UPDATE") {
        // `rt_broadcast('with_old')` sends the previous row for this table.
        const oldRow = payload.old as {
          referral_credits_earned?: number;
          referral_uses?: number;
        } | null;
        const newRow = payload.new as {
          referral_credits_earned?: number;
          referral_uses?: number;
        } | null;
        const prevCredit = oldRow?.referral_credits_earned;
        const nextCredit = newRow?.referral_credits_earned;
        const prevUses = oldRow?.referral_uses;
        const nextUses = newRow?.referral_uses;
        if (typeof nextCredit === "number" && typeof prevCredit === "number" && nextCredit > prevCredit) {
          toast.success("You earned a free month of Nuvo — it’ll apply to your next bill.");
        } else if (typeof nextUses === "number" && typeof prevUses === "number" && nextUses > prevUses) {
          toast.success("A friend used your code — free month when they pay.");
        }
      }
      qc.invalidateQueries({ queryKey: KEY });
    };
    // The channel is the signed-in account's own private topic (see
    // useRealtime), so it follows the session: none while signed out, swapped
    // when the account changes.
    let channel: RealtimeChannel | null = null;
    let channelUserId: string | null = null;
    let torn = false;
    const follow = (userId: string | null) => {
      if (userId === channelUserId) return;
      if (channel) supabase.removeChannel(channel);
      channel = null;
      channelUserId = userId;
      if (!userId) return;
      channel = supabase
        .channel(liveTopic(userId, "subscriptions"), { config: { private: true } })
        .on("broadcast", { event: "*" }, ({ payload }) => onRow(payload as LiveChange))
        .subscribe();
    };
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
      // Out of the auth callback: the channel's join reads the session, and
      // supabase-js holds its auth lock for the length of this callback.
      setTimeout(() => {
        if (!torn) follow(userId);
      }, 0);
    });
    return () => {
      torn = true;
      if (channel) supabase.removeChannel(channel);
      auth.subscription.unsubscribe();
    };
  }, [qc]);
}
