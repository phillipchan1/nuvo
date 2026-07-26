import { useState } from "react";
import { Btn } from "../ui";
import { useSubscription } from "../../hooks/useSubscription";
import { fetchPortalUrl, openBillingUrl, trialDaysRemaining, type Subscription } from "../../lib/subscription";
import { UpgradeModal } from "./UpgradeModal";

/** Settings is for MANAGING a subscription — the selling happens in
 *  UpgradeModal. This pane only ever sees the two entitled states: a
 *  non-entitled account never reaches Settings, LockedScreen replaces the
 *  whole app first (see App.tsx's gating). */
export function BillingPane() {
  const { subscription } = useSubscription();
  const [upgrading, setUpgrading] = useState(false);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-head font-semibold text-ink">Billing</h2>
        <p className="mt-0.5 text-caption leading-snug text-muted">Your plan and payment method.</p>
      </div>

      {subscription?.status === "trialing" ? (
        <TrialingCard subscription={subscription} onUpgrade={() => setUpgrading(true)} />
      ) : subscription?.status === "active" ? (
        <ActiveCard subscription={subscription} />
      ) : (
        <div className="text-caption text-muted">Loading…</div>
      )}

      {upgrading && <UpgradeModal onClose={() => setUpgrading(false)} />}
    </div>
  );
}

function TrialingCard({
  subscription,
  onUpgrade,
}: {
  subscription: Subscription;
  onUpgrade: () => void;
}) {
  const days = trialDaysRemaining(subscription);
  const ends = new Date(subscription.trial_ends_at).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div>
      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <div className="text-label uppercase tracking-wider text-muted">Current plan</div>
        <div className="mt-0.5 text-body text-ink">
          Free trial · {days} day{days === 1 ? "" : "s"} left
        </div>
        <div className="mt-1 text-caption text-muted">Ends {ends}</div>
      </div>
      <div className="mt-4">
        <Btn kind="primary" onClick={onUpgrade}>
          See plans
        </Btn>
      </div>
    </div>
  );
}

function ActiveCard({ subscription }: { subscription: Subscription }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await fetchPortalUrl();
      await openBillingUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  };

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const ending = subscription.cancel_at_period_end;

  return (
    <div>
      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <div className="text-label uppercase tracking-wider text-muted">Current plan</div>
        <div className="mt-0.5 text-body text-ink">Nuvo · active</div>
        {periodEnd && (
          <div className={`mt-1 text-caption ${ending ? "text-signal" : "text-muted"}`}>
            {ending ? `Ends ${periodEnd} — you'll keep access until then` : `Renews ${periodEnd}`}
          </div>
        )}
      </div>
      <div className="mt-4">
        <Btn kind={ending ? "primary" : "ghost"} disabled={busy} onClick={openPortal}>
          {busy ? "Opening…" : ending ? "Resume subscription" : "Manage billing"}
        </Btn>
      </div>
      <p className="mt-2 text-caption text-muted">
        Update your card, switch plans, download invoices, or cancel.
      </p>
      {error && <div className="mt-2 text-caption text-signal">{error}</div>}
    </div>
  );
}
