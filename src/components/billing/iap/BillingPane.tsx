import { useState } from "react";
import { Btn } from "../../ui";
import { useSubscription } from "../../../hooks/useSubscription";
import { manageIapSubscriptions } from "../../../lib/iap";
import { planOf, trialDaysRemaining, type Subscription } from "../../../lib/subscription";
import { IapUpgradeModal } from "./UpgradeModal";

/** iOS Settings → Billing. Status only, plus StoreKit manage when this
 *  account pays through Apple. No checkout, no portal, no web prices. */
export function IapBillingPane() {
  const { subscription } = useSubscription();
  const [upgrading, setUpgrading] = useState(false);
  const plan = planOf(subscription);
  const source = subscription?.plan_source ?? null;

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-head font-semibold text-ink">Billing</h2>
        <p className="mt-0.5 text-caption leading-snug text-muted">Your plan.</p>
      </div>

      {plan === "trialing" && subscription ? (
        <TrialingCard subscription={subscription} onUpgrade={() => setUpgrading(true)} />
      ) : plan === "active" && subscription ? (
        <ActiveCard subscription={subscription} apple={source === "apple"} />
      ) : (
        <div className="text-caption text-muted">Loading…</div>
      )}

      {upgrading && <IapUpgradeModal onClose={() => setUpgrading(false)} />}
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

function ActiveCard({ subscription, apple }: { subscription: Subscription; apple: boolean }) {
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
      {apple ? (
        <>
          <div className="mt-4">
            <Btn kind={ending ? "primary" : "ghost"} disabled={busy} onClick={manage}>
              {busy ? "Opening…" : "Manage subscription"}
            </Btn>
          </div>
          <p className="mt-2 text-caption text-muted">
            Change or cancel in your Apple ID subscription settings.
          </p>
        </>
      ) : (
        <p className="mt-3 text-caption leading-snug text-muted">Your subscription is active.</p>
      )}
      {error && <div className="mt-2 text-caption text-signal">{error}</div>}
    </div>
  );
}
