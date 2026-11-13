import { useState } from "react";
import { useSubscription } from "../../hooks/useSubscription";
import { trialDaysRemaining } from "../../lib/subscription";
import { UpgradeModal } from "./UpgradeModal";
import { Icon } from "../Icon";
import { Button, IconButton } from "../kit";

/** Slim dismissible bar shown while trialing, in both shells. Dismiss is
 *  in-memory only — it reappears next load, same as the trial itself.
 *
 *  It opens the upgrade modal rather than jumping to a rail: "Subscribe"
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
        // A countdown, not "now": it never wears the signal. The last stretch
        // reads in the caution colour; the rest is a quiet line on a well.
        <div role="status" className="trial-banner" data-urgent={urgent || undefined}>
          <span className="trial-banner-text">{message}</span>
          <Button kind={urgent ? "primary" : "secondary"} size="xs" className="tap" onClick={() => setOpen(true)}>
            {urgent ? "Keep Nuvo" : "See plans"}
          </Button>
          <IconButton size="xs" label="Dismiss" icon={<Icon name="close" size={12} />} onClick={() => setDismissed(true)} className="tap-icon" />
        </div>
      )}
      {open && <UpgradeModal onClose={() => setOpen(false)} />}
    </>
  );
}
