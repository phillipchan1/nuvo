import { useState } from "react";
import { useSubscription } from "../../hooks/useSubscription";
import { trialDaysRemaining } from "../../lib/subscription";
import { UpgradeModal } from "./UpgradeModal";

/** Slim dismissible bar shown while trialing, in both shells. Dismiss is
 *  in-memory only — it reappears next load, same as the trial itself.
 *
 *  It opens the upgrade modal rather than jumping to Stripe: "Subscribe"
 *  must never pick a plan on someone's behalf. */
export function TrialBanner() {
  const { subscription } = useSubscription();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  if (subscription?.status !== "trialing") return null;

  const days = trialDaysRemaining(subscription);
  // The last stretch reads differently from day one — same bar, more signal.
  const urgent = days <= 3;

  const message =
    days <= 0
      ? "Your trial ends today"
      : days === 1
        ? "Your trial ends tomorrow"
        : `${days} days left in your trial`;

  return (
    <>
      {!dismissed && (
        <div
          role="status"
          className={`flex shrink-0 items-center gap-3 border-b px-4 py-1.5 text-caption ${
            urgent
              ? "border-signal/30 bg-signal-soft font-medium text-signal"
              : "border-line bg-signal-soft/60 text-signal"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{message}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="tap fast shrink-0 font-medium underline underline-offset-2 hover:no-underline"
          >
            {urgent ? "Keep Nuvo" : "See plans"}
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className="tap fast shrink-0 text-signal/70 hover:text-signal"
          >
            ✕
          </button>
        </div>
      )}
      {open && <UpgradeModal onClose={() => setOpen(false)} />}
    </>
  );
}
