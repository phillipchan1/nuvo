import { useState } from "react";
import { signOut } from "../../../lib/authActions";
import { fetchPortalUrl, openBillingUrl } from "../../../lib/stripeBilling";
import { planOf, type Subscription } from "../../../lib/subscription";
import { Button } from "../../kit";
import { StatementPage } from "../../statement/StatementPage";
import { PlanChooser } from "../PlanChooser";
import { DeleteAccount } from "../../account/DeleteAccount";

/** Web / macOS paywall — Stripe Checkout. Never imported by the iOS IAP path. */
export default function WebLockedScreen({
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
          Everything you've built is still here, exactly where you left it. Pick a plan to pick up where you stopped.
        </p>

        <PlanChooser cta="Subscribe and continue" />

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
          <DeleteAccount compact planSource={subscription?.plan_source ?? null} />
        </div>
      </StatementPage>
    </div>
  );
}

function PastDue() {
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

  return (
    <div className="h-full overflow-y-auto">
      <StatementPage kicker="Billing" hero={<>Your card needs a moment</>}>
        <p className="st-lead">
          Your last payment didn't go through. Update your card and everything comes
          straight back — nothing has been lost.
        </p>
        <Button kind="primary" size="md" full disabled={busy} onClick={openPortal} className="tap">
          {busy ? "Opening…" : "Update payment method"}
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
          <DeleteAccount compact planSource="stripe" />
        </div>
      </StatementPage>
    </div>
  );
}
