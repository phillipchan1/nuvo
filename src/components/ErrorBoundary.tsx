import { Component, type ErrorInfo, type ReactNode } from "react";
import { Stop } from "./statement/StatementPage";
import { rememberError } from "../lib/appError";
import { captureAppException } from "../lib/posthog";
import { Button } from "./kit";

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
    rememberError({
      at: Date.now(),
      message: error.message || error.name,
      detail: info.componentStack?.trim() || undefined,
      source: this.props.label ?? "crash",
    });
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
        <div className="k-card w-96 max-w-full !gap-0 !p-6" style={{ boxShadow: "var(--sh-modal)" }}>
          <h1 className="st-title">
            Something broke
            <Stop />
          </h1>
          <p className="mt-2 text-body text-muted">
            {this.props.label ? `The ${this.props.label} hit an error` : "Nuvo hit an error"} it couldn't recover from.
            Your data is safe — reloading usually fixes it.
          </p>
          {/* The raw message is a minified identifier — "agendaAnchor is not
              defined" — which means nothing to the person reading it and
              quietly undercuts the two calm lines above that just told them
              their data is safe. It belongs to whoever is going to debug it, so
              it lives behind a disclosure and inside "Copy details", which
              already carries the full stack. Kept reachable rather than
              removed: a user who can paste the message into a bug report is
              worth far more than one who can't. */}
          <details className="mt-3">
            <summary className="tap-desk-h text-caption text-muted">Technical details</summary>
            <p className="mt-2 break-words font-mono text-caption text-muted" data-selectable>
              {this.state.error.message}
            </p>
          </details>
          <div className="mt-5 flex flex-col items-stretch gap-2">
            <Button kind="primary" size="md" full className="tap" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button size="md" full className="tap" onClick={() => void this.copyDetails()}>
              {this.state.copied ? "Copied" : "Copy details"}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
