import { Modal } from "../../ui";
import { useSubscription } from "../../../hooks/useSubscription";
import { trialDaysRemaining } from "../../../lib/subscription";
import { PlanChooser } from "../PlanChooser";

export function WebUpgradeModal({ onClose }: { onClose: () => void }) {
  const { subscription } = useSubscription();
  const days = trialDaysRemaining(subscription);
  const trialing = subscription?.status === "trialing";

  return (
    <Modal onClose={onClose} width="max-w-md">
      <div className="p-6 sm:p-7">
        <h2 className="masthead text-display leading-tight text-ink">Keep your whole day in one place</h2>
        <p className="mt-2 mb-5 text-caption leading-relaxed text-muted">
          {trialing && days > 0
            ? `You have ${days} day${days === 1 ? "" : "s"} left on your trial. Pick a plan and nothing changes — your work, calendars, and plans stay exactly as they are.`
            : "Pick a plan and nothing changes — your work, calendars, and plans stay exactly as they are."}
        </p>
        <PlanChooser />
      </div>
    </Modal>
  );
}
