import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "./hooks/useAuth";
import { useApplyTheme, useSettings } from "./hooks/useSettings";
import Login from "./components/Login";
import Planner from "./components/Planner";

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
      <div className="flex h-full items-center justify-center bg-bg">
        <span className="mono text-[12px] text-muted">nuvo…</span>
      </div>
    );
  }
  return session ? <Planner /> : <Login />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
