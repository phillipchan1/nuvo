import { useState } from "react";
import { signOut } from "../../../lib/authActions";
import { manageIapSubscriptions, restoreAndConfirm } from "../../../lib/iap";
import { planOf, type Subscription } from "../../../lib/subscription";
import { useSubscription } from "../../../hooks/useSubscription";
import { Button } from "../../kit";
import { StatementPage } from "../../statement/StatementPage";
import { IapChooser } from "./IapChooser";
import { DeleteAccount } from "../../account/DeleteAccount";

/** iOS App Store paywall — StoreKit only. */
export default function IapLockedScreen({
  subscription,
}: {
  subscription: Subscription | null | undefined;
}) {
  const status = planOf(subscription) ?? subscription?.status ?? "cancelled";

  if (status === "past_due") return <PastDue />;

  return (
    // A statement page (D-192): the stage says why to stay, the door holds the plans.
    <div className="h-full overflow-y-auto">
      <StatementPage
        wide
        kicker={status === "cancelled" ? "Welcome back" : "Your 14 days are up"}
        hero={
          status === "cancelled" ? (
            <>
              Pick up where
              <br />
              you stopped
            </>
          ) : (
            <>
              Keep the
              <br />
              momentum
            </>
          )
        }
      >
        <p className="st-lead">
          Everything you've built is still here, exactly where you left it. Subscribe to pick up where you stopped.
        </p>

        <IapChooser cta="Subscribe and continue" />

        <div className="lock-foot">
          <div className="flex items-center gap-2">
            <Button kind="ghost" className="tap -ml-2" onClick={() => void signOut()}>
              Sign out
            </Button>
            <a
              href="mailto:hello@nuvo.day?subject=Nuvo%20subscription"
              className="k-btn tap ml-auto" data-kind="ghost"
            >
              Need help?
            </a>
          </div>
          <DeleteAccount compact planSource={subscription?.plan_source ?? "apple"} />
        </div>
      </StatementPage>
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
    <div className="h-full overflow-y-auto">
      <StatementPage kicker="Billing" hero={<>Your subscription needs a moment</>}>
        <p className="st-lead">
          Your last period didn’t renew. Update payment in your Apple ID settings and
          everything comes straight back — nothing has been lost.
        </p>
        <Button kind="primary" size="md" full disabled={busy} onClick={manage} className="tap">
          {busy ? "Opening…" : "Manage subscription"}
        </Button>
        <Button kind="ghost" size="md" full disabled={busy} onClick={restore} className="tap mt-2">
          Restore purchases
        </Button>
        {error && <div className="mt-3 text-caption text-danger">{error}</div>}
        <div className="lock-foot">
          <div className="flex items-center gap-2">
            <Button kind="ghost" className="tap -ml-2" onClick={() => void signOut()}>
              Sign out
            </Button>
            <a
              href="mailto:hello@nuvo.day?subject=Nuvo%20payment"
              className="k-btn tap ml-auto" data-kind="ghost"
            >
              Need help?
            </a>
          </div>
          <DeleteAccount compact planSource="apple" />
        </div>
      </StatementPage>
    </div>
  );
}
