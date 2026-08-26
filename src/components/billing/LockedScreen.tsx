import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { fetchPortalUrl, openBillingUrl, type Subscription } from "../../lib/subscription";
import { Btn } from "../ui";
import { PlanChooser } from "./PlanChooser";
import { DeleteAccount } from "../account/DeleteAccount";

/** The hard gate. Renders in the same slot Login occupies when there's no
 *  session — here for a signed-in account that isn't entitled. It's the
 *  highest-stakes surface in the app, so it carries the full offer rather
 *  than a bare "your trial ended" apology, and it always leaves a way out
 *  (billing portal, sign out, delete account, support). */
export default function LockedScreen({
  subscription,
}: {
  subscription: Subscription | null | undefined;
}) {
  const status = subscription?.status ?? "cancelled";

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
          exactly where you left them. Pick a plan to pick up where you stopped.
        </p>

        <PlanChooser cta="Subscribe and continue" />

        <div className="mt-5 border-t border-line pt-3">
          <div className="flex items-center gap-4">
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
          <DeleteAccount compact />
        </div>
      </div>
    </div>
  );
}

/** A failed payment is a different problem from an expired trial: the person
 *  already decided to pay us. Don't re-sell them — just get them to the card
 *  form in as few steps as possible. */
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
    <div className="atmosphere flex h-full items-center justify-center px-4">
      <div className="moment elev-3 w-full max-w-sm rounded-lg border border-line bg-surface p-6 sm:p-7">
        <div className="section-label mb-2 text-signal">Payment failed</div>
        <h1 className="masthead text-lead leading-tight text-ink">
          Your card needs a moment
        </h1>
        <p className="mt-2 mb-5 text-caption leading-relaxed text-muted">
          We couldn't complete your last payment. Update your card and everything comes
          straight back — nothing has been lost.
        </p>
        <Btn kind="primary" disabled={busy} onClick={openPortal} className="w-full text-center">
          {busy ? "Opening…" : "Update payment method"}
        </Btn>
        {error && <div className="mt-3 text-caption text-signal">{error}</div>}
        <div className="mt-5 border-t border-line pt-3">
          <div className="flex items-center gap-4">
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
          <DeleteAccount compact />
        </div>
      </div>
    </div>
  );
}
