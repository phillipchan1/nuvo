import { useState } from "react";
import { supabase } from "../../../lib/supabase";
import { manageIapSubscriptions, restoreAndConfirm } from "../../../lib/iap";
import { planOf, type Subscription } from "../../../lib/subscription";
import { useSubscription } from "../../../hooks/useSubscription";
import { Btn } from "../../ui";
import { IapChooser } from "./IapChooser";

/** iOS App Store paywall — StoreKit only. */
export default function IapLockedScreen({
  subscription,
}: {
  subscription: Subscription | null | undefined;
}) {
  const status = planOf(subscription) ?? subscription?.status ?? "cancelled";

  if (status === "past_due") return <PastDue />;

  return (
    <div className="atmosphere flex h-full items-start justify-center overflow-y-auto px-4 py-10 sm:items-center sm:py-12">
      <div className="moment elev-3 w-full max-w-md rounded-lg border border-line bg-surface p-6 sm:p-7">
        <div className="section-label mb-2 text-signal">
          {status === "cancelled" ? "Subscription ended" : "Trial ended"}
        </div>
        <h1 className="masthead text-display leading-tight text-ink">
          {status === "cancelled" ? "Welcome back any time" : "Your 14 days are up"}
        </h1>
        <p className="mt-2 mb-5 text-caption leading-relaxed text-muted">
          Everything you've built is still here — your projects, calendars, and plans are
          exactly where you left them. Subscribe to pick up where you stopped.
        </p>

        <IapChooser cta="Subscribe and continue" />

        <div className="mt-5 flex items-center gap-4 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="tap fast text-caption text-muted hover:text-ink"
          >
            Sign out
          </button>
          <a
            href="mailto:hello@nuvo.day?subject=Nuvo%20subscription"
            className="tap fast ml-auto inline-flex items-center text-caption text-muted hover:text-ink"
          >
            Need help?
          </a>
        </div>
      </div>
    </div>
  );
}

function PastDue() {
  const { refetch } = useSubscription();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manage = async () => {
    setBusy(true);
    setError(null);
    try {
      await manageIapSubscriptions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open subscriptions");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await restoreAndConfirm();
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore didn’t complete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="atmosphere flex h-full items-center justify-center px-4">
      <div className="moment elev-3 w-full max-w-sm rounded-lg border border-line bg-surface p-6 sm:p-7">
        <div className="section-label mb-2 text-signal">Payment failed</div>
        <h1 className="masthead text-lead leading-tight text-ink">Your subscription needs a moment</h1>
        <p className="mt-2 mb-5 text-caption leading-relaxed text-muted">
          We couldn’t renew your last period. Update payment in your Apple ID settings and
          everything comes straight back — nothing has been lost.
        </p>
        <Btn kind="primary" disabled={busy} onClick={manage} className="w-full text-center">
          {busy ? "Opening…" : "Manage subscription"}
        </Btn>
        <button
          type="button"
          disabled={busy}
          onClick={restore}
          className="tap fast mt-2 w-full py-3 text-caption text-muted hover:text-ink"
        >
          Restore purchases
        </button>
        {error && <div className="mt-3 text-caption text-signal">{error}</div>}
        <div className="mt-5 flex items-center gap-4 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="tap fast text-caption text-muted hover:text-ink"
          >
            Sign out
          </button>
          <a
            href="mailto:hello@nuvo.day?subject=Nuvo%20payment"
            className="tap fast ml-auto inline-flex items-center text-caption text-muted hover:text-ink"
          >
            Need help?
          </a>
        </div>
      </div>
    </div>
  );
}
