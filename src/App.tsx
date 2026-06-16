import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "./hooks/useAuth";
import { useApplyTheme, useSettings } from "./hooks/useSettings";
import Login from "./components/Login";
import AppShell from "./components/AppShell";
import UpdateToast from "./components/UpdateToast";
import { AppNavigationProvider } from "./hooks/useAppNavigation";
import { AgentProvider } from "./hooks/useAgentContext";

const queryClient = new QueryClient({
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
