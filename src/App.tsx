import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { useAuth } from "./hooks/useAuth";
import { useApplyTheme, useSettings } from "./hooks/useSettings";
import Login from "./components/Login";
import AppShell from "./components/AppShell";
import UpdateToast from "./components/UpdateToast";
import { AppNavigationProvider } from "./hooks/useAppNavigation";
import { AgentProvider } from "./hooks/useAgentContext";

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (e) => toast.error(errMsg(e)),
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
