import { useState } from "react";
import { PaneHeader } from "../../form";
import { Button } from "../../kit";
import { useSubscription } from "../../../hooks/useSubscription";
import { iapErrorMessage, manageIapSubscriptions, restoreAndConfirm } from "../../../lib/iap";
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
      <PaneHeader title="Billing" />

      {plan === "trialing" && subscription ? (
        <TrialingCard subscription={subscription} onUpgrade={() => setUpgrading(true)} />
      ) : plan === "active" && subscription ? (
        <ActiveCard subscription={subscription} apple={source === "apple"} />
      ) : (
        <p className="set-note">Loading…</p>
      )}

      {(plan === "trialing" || plan === "active") && <RestorePurchases />}

      {upgrading && <IapUpgradeModal onClose={() => setUpgrading(false)} />}
    </div>
  );
}

function RestorePurchases() {
  const { refetch } = useSubscription();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <Button
        kind="ghost"
        size="md"
        full
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await restoreAndConfirm();
            await refetch();
          } catch (e) {
            setError(iapErrorMessage(e, "Restore didn’t complete"));
          } finally {
            setBusy(false);
          }
        }}
        className="tap"
      >
        Restore purchases
      </Button>
      {error && <div className="mt-2 text-caption text-danger">{error}</div>}
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
    <div className="set-row">
      <div className="set-row-label">
        <span className="set-row-title">
          Free trial · {days} day{days === 1 ? "" : "s"} left
        </span>
        <div className="set-row-desc">Ends {ends}</div>
      </div>
      <div className="set-row-ctl">
        <Button kind="primary" className="tap" onClick={onUpgrade}>
          See plans
        </Button>
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
      setError(iapErrorMessage(e, "Could not open subscriptions"));
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
      <div className="set-row">
        <div className="set-row-label">
          <span className="set-row-title">Nuvo · active</span>
          {periodEnd && (
            <div className="set-row-desc" style={ending ? { color: "var(--warn)" } : undefined}>
              {ending ? `Ends ${periodEnd} — you'll keep access until then` : `Renews ${periodEnd}`}
            </div>
          )}
        </div>
      </div>
      {apple ? (
        <>
          <div className="set-row">
            <div className="set-row-label">
              <span className="set-row-title">Subscription</span>
              <div className="set-row-desc">Change or cancel in your Apple ID settings.</div>
            </div>
            <div className="set-row-ctl">
              <Button kind={ending ? "primary" : "secondary"} className="tap" disabled={busy} onClick={manage}>
                {busy ? "Opening…" : "Manage subscription"}
              </Button>
            </div>
          </div>
        </>
      ) : (
        null
      )}
      {error && <div className="mt-2 text-caption text-danger">{error}</div>}
    </div>
  );
}
