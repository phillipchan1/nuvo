import { DialogHead, Modal } from "../../ui";
import { useSubscription } from "../../../hooks/useSubscription";
import { trialDaysRemaining } from "../../../lib/subscription";
import { PlanChooser } from "../PlanChooser";

export function WebUpgradeModal({ onClose }: { onClose: () => void }) {
  const { subscription } = useSubscription();
  const days = trialDaysRemaining(subscription);
  const trialing = subscription?.status === "trialing";

  return (
    <Modal onClose={onClose} width="max-w-md">
      <DialogHead title="Keep your whole day in one place" onClose={onClose} />
      <div className="dlg-body">
        <p className="dlg-lead">
          {trialing && days > 0
            ? `${days} day${days === 1 ? "" : "s"} left on your trial. Pick a plan and nothing changes.`
            : "Pick a plan and nothing changes — your work stays exactly as it is."}
        </p>
        <PlanChooser />
      </div>
    </Modal>
  );
}
