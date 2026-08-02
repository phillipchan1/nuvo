import { useEffect, useState } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { useAuth } from "./hooks/useAuth";
import { useIsMobile } from "./hooks/useIsMobile";
import { useApplyTheme, useSettings } from "./hooks/useSettings";
import { useSubscription, useSubscriptionLiveSync } from "./hooks/useSubscription";
import { useSkin, useScheme } from "./hooks/useSkin";
import { useThemeColor } from "./hooks/useThemeColor";
import Login from "./components/Login";
import AppShell from "./components/AppShell";
import ErrorBoundary from "./components/ErrorBoundary";
import LockedScreen from "./components/billing/LockedScreen";
import { SpotlightHost } from "./components/SpotlightWindow";
import UpdateToast from "./components/UpdateToast";
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

// One Toaster for every shell state. On a phone the bottom-right corner is
// where the ＋ FAB and ✦ launcher live, and the toast is the only undo path
// (no ⌘Z) — so it rides top-center under the safe area and stays up longer.
function AppToaster() {
  const isMobile = useIsMobile();
  return (
    <Toaster
      position={isMobile ? "top-center" : "bottom-right"}
      offset={isMobile ? "calc(env(safe-area-inset-top, 0px) + 12px)" : undefined}
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
  const { settings } = useSettings();
  const { subscription, isPending: subPending, isError: subError, refetch: refetchSubscription } = useSubscription();
  useSubscriptionLiveSync();
  const checkoutPending = useCheckoutReturn(subscription?.entitled);
  useApplyTheme(settings?.theme);
  useSkin(); // keep <html data-skin> applied (the material axis)
  useScheme(); // keep <html data-palette> applied (the material's colour scheme)
  useThemeColor(); // keep the browser/status-bar chrome on the resolved --bg

  // The floating ⌥Space window: just the panel (no app chrome, no updater).
  // SpotlightHost owns the signed-out state too — a summon that renders nothing
  // is indistinguishable from a broken app.
  if (IS_SPOTLIGHT) {
    return (
      <>
        <SpotlightHost signedIn={Boolean(session) && !loading} loading={loading} />
        <AppToaster />
      </>
    );
  }

  if (loading) {
    return (
      <div className="atmosphere flex h-full items-center justify-center">
        <span className="wordmark shimmer text-head">nuvo</span>
      </div>
    );
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
  // right after Checkout where the webhook hasn't landed yet.
  if (subPending || (checkoutPending && !subscription?.entitled)) {
    return (
      <div className="atmosphere flex h-full items-center justify-center">
        <span className="wordmark shimmer text-head">nuvo</span>
      </div>
    );
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

  if (!subscription?.entitled) {
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
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UndoProvider>
        <ErrorBoundary>
          <Shell />
        </ErrorBoundary>
      </UndoProvider>
    </QueryClientProvider>
  );
}
