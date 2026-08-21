import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureAppException } from "../lib/posthog";

// The app-level crash net. Without one, a render error anywhere unmounts the
// whole tree to a white screen — unrecoverable in an installed PWA, where there
// is no address bar to reload from. Mounted twice: around the whole Shell, and
// separately around MobileShell so a floor crash doesn't take the shell chrome
// with it.
export default class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null; stack: string | null; copied: boolean }
> {
  state = { error: null as Error | null, stack: null as string | null, copied: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? null });
    // Console stays for local debugging; PostHog is how we see this without
    // waiting for someone to paste "Copy details".
    console.error("Nuvo crashed:", error, info.componentStack);
    captureAppException(error, {
      boundary: this.props.label ?? "app",
      componentStack: info.componentStack ?? undefined,
    });
  }

  private copyDetails = async () => {
    const { error, stack } = this.state;
    const details = `${error?.name ?? "Error"}: ${error?.message ?? "unknown"}\n${error?.stack ?? ""}\n\nComponent stack:${stack ?? " (none)"}`;
    try {
      await navigator.clipboard.writeText(details);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      /* clipboard unavailable — nothing to do */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="atmosphere flex h-full min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
        <div className="elev-3 w-96 max-w-full rounded-lg border border-line bg-surface p-7 text-center">
          <div className="mb-2 text-lead masthead text-ink">Something broke.</div>
          <p className="mb-1 text-body text-muted">
            {this.props.label ? `The ${this.props.label} hit an error` : "Nuvo hit an error"} it
            couldn't recover from. Your data is safe — reloading usually fixes it.
          </p>
          {/* The raw message is a minified identifier — "agendaAnchor is not
              defined" — which means nothing to the person reading it and
              quietly undercuts the two calm lines above that just told them
              their data is safe. It belongs to whoever is going to debug it, so
              it lives behind a disclosure and inside "Copy details", which
              already carries the full stack. Kept reachable rather than
              removed: a user who can paste the message into a bug report is
              worth far more than one who can't. */}
          <details className="mb-5 text-left">
            <summary className="tap-desk-h fast cursor-pointer list-none text-center text-caption text-muted hover:text-ink">
              Technical details
            </summary>
            <p className="mono mt-2 break-words text-caption text-muted">
              {this.state.error.message}
            </p>
          </details>
          <div className="flex flex-col items-stretch gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="tap fast rounded-md border border-accent bg-accent px-4 py-2.5 text-body font-semibold text-on-accent active:translate-y-px"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => void this.copyDetails()}
              className="tap fast rounded-md border border-line px-4 py-2.5 text-body font-medium text-muted active:bg-surface-2"
            >
              {this.state.copied ? "Copied" : "Copy details"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
