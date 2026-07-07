import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { useAuth } from "./hooks/useAuth";
import { useApplyTheme, useSettings } from "./hooks/useSettings";
import { useSkin, useScheme } from "./hooks/useSkin";
import Login from "./components/Login";
import AppShell from "./components/AppShell";
import SpotlightWindow from "./components/SpotlightWindow";
import UpdateToast from "./components/UpdateToast";
import { AppNavigationProvider } from "./hooks/useAppNavigation";
import { AgentProvider } from "./hooks/useAgentContext";
import { VerticalProvider } from "./hooks/useVertical";

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
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
  },
});

function Shell() {
  const { session, loading } = useAuth();
  const { settings } = useSettings();
  useApplyTheme(settings?.theme);
  useSkin(); // keep <html data-skin> applied (the material axis)
  useScheme(); // keep <html data-palette> applied (the material's colour scheme)

  // The floating ⌥Space window: just the panel (no app chrome, no updater).
  // Stays blank until authed — the window is hidden until summoned anyway.
  if (IS_SPOTLIGHT) {
    return (
      <>
        {session && !loading && (
          <AgentProvider>
            <VerticalProvider>
              <SpotlightWindow />
            </VerticalProvider>
          </AgentProvider>
        )}
        <Toaster position="bottom-right" richColors closeButton />
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
  return (
    <>
      {session ? (
        <AppNavigationProvider>
          <AgentProvider>
            <AppShell />
          </AgentProvider>
        </AppNavigationProvider>
      ) : (
        <Login />
      )}
      <UpdateToast />
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
