import { Component, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FirstRun from "../FirstRun";
import WebLockedScreen from "../billing/web/LockedScreen";
import ErrorBoundary from "../ErrorBoundary";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import type { Subscription } from "../../lib/subscription";

// `?statement=<page>` — the statement pages over fixtures (D-192), so the ones
// a signed-in account never sees can still be looked at: firstrun · trial ·
// cancelled · pastdue · error. (Sign-in has its own `?login`; the welcome needs
// live settings and is checked in the app.)

function Boom(): ReactNode {
  throw new Error("agendaAnchor is not defined");
}

class Quiet extends Component<{ children: ReactNode }> {
  // React logs the thrown error once; this boundary only keeps the harness up
  // if a page fails for a reason that has nothing to do with the look.
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p style={{ padding: 24 }}>This page needs live data.</p> : this.props.children;
  }
}

export default function StatementHarness() {
  const page = new URLSearchParams(window.location.search).get("statement") || "firstrun";
  const qc = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }), []);
  const store = useMemo(
    () => ({ data: { domains: [], initiatives: [], projects: [], tasks: [], sprint: null } }) as unknown as VerticalStore,
    [],
  );
  const sub = (status: string) => ({ status, plan_source: "stripe" }) as unknown as Subscription;

  let body: ReactNode;
  if (page === "trial") body = <WebLockedScreen subscription={sub("expired")} />;
  else if (page === "cancelled") body = <WebLockedScreen subscription={sub("cancelled")} />;
  else if (page === "pastdue") body = <WebLockedScreen subscription={sub("past_due")} />;
  else if (page === "error")
    body = (
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
  else body = <FirstRun onSkip={() => {}} />;

  return (
    <QueryClientProvider client={qc}>
      <VerticalStoreProvider value={store}>
        <div style={{ height: "100dvh" }}>
          <Quiet>{body}</Quiet>
        </div>
      </VerticalStoreProvider>
    </QueryClientProvider>
  );
}
