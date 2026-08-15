import { lazy, Suspense, useEffect, useState } from "react";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Toaster, toast } from "sonner";
import { supabase } from "./lib/supabase";
import { isMobileTauri } from "./lib/platform";
import { configureSync, createSupabaseTransport, teardownSync } from "./lib/sync";
import { createIdbPersister, MAX_CACHE_AGE_MS, shouldDehydrateQuery } from "./lib/sync/persist";
import { useAuth } from "./hooks/useAuth";
import { useWatchSession } from "./hooks/useWatchSession";
import { useIsMobile } from "./hooks/useIsMobile";
import { useApplyTheme, useSettings } from "./hooks/useSettings";
import { useSubscription, useSubscriptionLiveSync } from "./hooks/useSubscription";
import { readWasEntitled } from "./lib/subscription";
import { useSkin, useScheme } from "./hooks/useSkin";
import { useThemeColor } from "./hooks/useThemeColor";
import Login from "./components/Login";
import AppShell from "./components/AppShell";
import ErrorBoundary from "./components/ErrorBoundary";
import LockedScreen from "./components/billing/LockedScreen";
// The ⌥Space spotlight window is its own Tauri webview — the main window
// never renders it, so its panel code loads only in that window.
const SpotlightHost = lazy(() =>
  import("./components/SpotlightWindow").then((m) => ({ default: m.SpotlightHost })),
);
import UpdateToast from "./components/UpdateToast";
import LiveRegion from "./components/LiveRegion";
import { AppNavigationProvider } from "./hooks/useAppNavigation";
import { AgentProvider } from "./hooks/useAgentContext";
import { UndoProvider } from "./hooks/useUndoStack";

/** Right after redirect-back from Stripe Checkout, the webhook usually lands
 *  in well under 2s (the realtime hook in useSubscription flips `entitled`
 *  the moment it does) — but there's a brief window where it hasn't yet.
 *  Rather than flash LockedScreen at someone who just paid, show a "setting
 *  up" loader for that window instead, then strip the query param. */
function useCheckoutReturn(entitled: boolean | undefined) {
  const [outcome] = useState(() => new URLSearchParams(globalThis.location?.search).get("checkout"));
  const [pending, setPending] = useState(() => outcome === "success");

  const clearParam = () => {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("checkout");
    window.history.replaceState({}, "", url);
  };

  useEffect(() => {
    if (pending && entitled) {
      clearParam();
      setPending(false);
      // Someone just paid real money — acknowledge it. Silence here reads as
      // "did that work?", which is the worst feeling to leave a new
      // subscriber with.
      toast.success("You're all set — welcome to Nuvo.");
    }
  }, [pending, entitled]);

  useEffect(() => {
    // Backing out of Stripe used to land here with a dead ?checkout=cancelled
    // and no acknowledgement at all. Say plainly that nothing was charged.
    if (outcome === "cancelled") {
      clearParam();
      toast("Checkout cancelled — you haven't been charged.");
    }
  }, [outcome]);

  return pending;
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}

// Session restore and the subscription check are usually warm-cache-fast
// (well under this delay), so painting the wordmark for every one of them
// reads as a splash screen on every launch instead of a real desktop app
// that's just already there. Only earn the wordmark once a wait has gone on
// long enough to actually need reassurance; a fast load never shows it —
// the atmosphere canvas underneath is the whole transition.
const SPLASH_DELAY_MS = 200;
function useDelayedTrue(active: boolean, delayMs: number) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return show;
}

function LoadingCanvas({ showWordmark }: { showWordmark: boolean }) {
  return (
    <div className="atmosphere flex h-full items-center justify-center">
      {showWordmark && <span className="wordmark shimmer text-head">nuvo</span>}
    </div>
  );
}

// One Toaster for every shell state. On a phone the bottom-right corner is
// where the ＋ FAB and ✦ launcher live, and the toast is the only undo path
// (no ⌘Z) — so it rides top-center under the safe area and stays up longer.
function AppToaster() {
  const isMobile = useIsMobile();
  // Sonner switches to a separate --mobile-offset-* CSS var (not --offset-*)
  // below its own 600px breakpoint — every phone qualifies — so the safe-area
  // offset has to be set on BOTH props or the mobile one silently falls back
  // to sonner's flat 16px default and the toast lands under the Dynamic Island.
  const topOffset = "calc(env(safe-area-inset-top, 0px) + 12px)";
  return (
    <Toaster
      position={isMobile ? "top-center" : "bottom-right"}
      offset={isMobile ? topOffset : undefined}
      mobileOffset={isMobile ? topOffset : undefined}
      duration={isMobile ? 9000 : undefined}
      richColors
      closeButton
    />
  );
}

// A write that fails the instant you come back from offline (cold connection, or
// a JWT that went stale while the tab slept) is transient — the mutation never
// reached Postgres, so re-attempting is safe and lands it. We retry ONLY these:
// a genuine rejection (409/400/RLS) must fail fast and roll the optimistic update
// back, and a create must never be replayed after it actually inserted.
function isTransientWriteError(error: unknown): boolean {
  // Network-layer failure — the request never made it out.
  if (error instanceof TypeError) return true;
  const msg = (error as { message?: string } | null)?.message?.toLowerCase() ?? "";
  if (/failed to fetch|networkerror|load failed|connection|timeout|fetch/.test(msg)) return true;
  // Token expired while offline; the backoff below gives supabase-js time to
  // refresh it before the next attempt, which then carries the fresh token.
  const status = (error as { status?: number } | null)?.status;
  const code = (error as { code?: string } | null)?.code;
  if (status === 401 || code === "PGRST301" || /jwt (expired|invalid)|token/.test(msg)) return true;
  return false;
}

// In Tauri, the dedicated "spotlight" window (the floating ⌥Space panel) loads
// the same bundle as the main window; this flag swaps in the bare panel instead
// of the full app. Always false in the browser / PWA.
const IS_SPOTLIGHT = (() => {
  // DEV-only: `?spotlight` renders the global summon in the browser so its
  // Tauri-only surface can be verified against live data (the panel's Tauri
  // wiring no-ops outside Tauri). Tree-shaken from production builds.
  if (import.meta.env.DEV && new URLSearchParams(globalThis.location?.search).has("spotlight")) {
    return true;
  }
  // iOS ships one full-screen window — never the desktop ⌥Space panel.
  if (isMobileTauri()) return false;
  if (!("__TAURI_INTERNALS__" in globalThis)) return false;
  try {
    // Lazy require avoids touching the Tauri API outside the shell.
    const meta = (globalThis as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
      .__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    return meta === "spotlight";
  } catch {
    return false;
  }
})();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // Only alarm on a *first-load* failure (nothing on screen yet). A background
    // refetch that blips — e.g. an interrupted fetch when the app refocuses and
    // TanStack refetches everything, like right after the ⌥Space hand-off — still
    // has cached data showing, so a red toast there is pure noise.
    onError: (e, query) => {
      if (query.state.data !== undefined) return;
      // Queries flagged silent (e.g. decorative weather) never raise a toast.
      if (query.meta?.silent) return;
      // Offline is announced once by the shell's strip — a red toast per
      // failing query on top of it is pure noise.
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      toast.error(errMsg(e));
    },
  }),
  mutationCache: new MutationCache({
    onError: (e) => toast.error(errMsg(e)),
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Save the first tap after a reconnect: a transient write blips and retries
      // with backoff instead of rolling the optimistic update straight back (the
      // "checked then instantly unchecked" bug). Real rejections still fail fast.
      retry: (failureCount, error) => failureCount < 3 && isTransientWriteError(error),
      retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 4000),
    },
  },
});

function Shell() {
  const { session, loading } = useAuth();
  // Keep a paired Apple Watch's credential in step with this session. No-op
  // outside the iOS shell.
  useWatchSession(session);
  const { settings } = useSettings();
  const { subscription, isPending: subPending, isError: subError, refetch: refetchSubscription } = useSubscription();
  useSubscriptionLiveSync();
  const checkoutPending = useCheckoutReturn(subscription?.entitled);
  useApplyTheme(settings?.theme);
  useSkin(); // keep <html data-skin> applied (the material axis)
  useScheme(); // keep <html data-palette> applied (the material's colour scheme)
  useThemeColor(); // keep the browser/status-bar chrome on the resolved --bg
  const showAuthWordmark = useDelayedTrue(loading, SPLASH_DELAY_MS);
  const subscriptionPending = subPending || (checkoutPending && !subscription?.entitled);
  const showSubscriptionWordmark = useDelayedTrue(subscriptionPending, SPLASH_DELAY_MS);
  // The entitlement check is deliberately never cached to disk (see
  // readWasEntitled), so it's a real network round-trip on every launch —
  // blocking on it is what actually caused the splash to keep flashing on
  // mobile networks even after the delay above. Render straight through on
  // the strength of last launch's answer instead, and let the live check
  // correct the screen a moment later if it landed differently this time.
  // Scoped to the first-fetch window only — a just-completed Checkout still
  // waits for a real answer, since there's nothing stale to trust yet.
  const optimisticEntitled = subPending && readWasEntitled();

  // The floating ⌥Space window: just the panel (no app chrome, no updater).
  // SpotlightHost owns the signed-out state too — a summon that renders nothing
  // is indistinguishable from a broken app.
  if (IS_SPOTLIGHT) {
    return (
      <>
        <Suspense fallback={null}>
          <SpotlightHost signedIn={Boolean(session) && !loading} loading={loading} />
        </Suspense>
        <AppToaster />
      </>
    );
  }

  if (loading) {
    return <LoadingCanvas showWordmark={showAuthWordmark} />;
  }

  if (!session) {
    return (
      <>
        <Login />
        <UpdateToast />
        <AppToaster />
      </>
    );
  }

  // First subscription fetch (isPending covers a network-paused fetch too,
  // not just an in-flight one — see useSubscription), or the brief window
  // right after Checkout where the webhook hasn't landed yet. Skipped when
  // we're rendering optimistically on last launch's entitlement instead.
  if (subscriptionPending && !optimisticEntitled) {
    return <LoadingCanvas showWordmark={showSubscriptionWordmark} />;
  }

  // A fetch error (network blip, transient outage) is NOT the same as
  // "not entitled" — never read a failed check as a cancelled subscription.
  // Only render LockedScreen once we've actually heard back "not entitled".
  if (subError) {
    return (
      <div className="atmosphere flex h-full items-center justify-center px-4">
        <div className="moment elev-3 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-7 text-center">
          <div className="mb-2 text-body text-ink">Couldn't verify your subscription.</div>
          <div className="mb-4 text-caption text-muted">This is usually a connection blip.</div>
          <button
            type="button"
            onClick={() => refetchSubscription()}
            className="tap fast rounded-md border border-line bg-surface-2 px-4 py-2 text-body font-medium text-ink hover:bg-surface"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!subscription?.entitled && !optimisticEntitled) {
    return (
      <>
        <LockedScreen subscription={subscription} />
        <UpdateToast />
        <AppToaster />
      </>
    );
  }

  return (
    <>
      <AppNavigationProvider>
        <AgentProvider>
          <AppShell />
        </AgentProvider>
      </AppNavigationProvider>
      <UpdateToast />
      <AppToaster />
      {/* One polite live region for the whole app — keyboard acts that move
          something off-screen say so here (lib/announce.ts). */}
      <LiveRegion />
    </>
  );
}

/**
 * Owns the sync client's lifetime.
 *
 * Inside the provider (it needs the QueryClient) and above the shell, so the
 * outbox starts draining the moment the app mounts — before any screen renders
 * and regardless of whether the user goes anywhere near the surface that queued
 * the work. An install relaunched after a week offline delivers on launch.
 */
function SyncHost({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const transport = createSupabaseTransport(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.user?.id ?? null;
    });
    configureSync(queryClient, transport);
    return () => teardownSync();
  }, []);

  return <>{children}</>;
}

const persister = createIdbPersister();

export default function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: MAX_CACHE_AGE_MS,
        dehydrateOptions: { shouldDehydrateQuery },
        // Bump when a query's shape changes incompatibly — a restored cache
        // from an older build is worse than no cache.
        buster: "sync-v1",
      }}
    >
      <SyncHost>
        <UndoProvider>
          <ErrorBoundary>
            <Shell />
          </ErrorBoundary>
        </UndoProvider>
      </SyncHost>
    </PersistQueryClientProvider>
  );
}
