import { DialogHead, Modal } from "../../ui";
import { useSubscription } from "../../../hooks/useSubscription";
import { trialDaysRemaining } from "../../../lib/subscription";
import { IapChooser } from "./IapChooser";

export function IapUpgradeModal({ onClose }: { onClose: () => void }) {
  const { subscription } = useSubscription();
  const days = trialDaysRemaining(subscription);
  const trialing = subscription?.status === "trialing";

  return (
    <Modal onClose={onClose} width="max-w-md">
      <DialogHead title="Keep your whole day in one place" onClose={onClose} />
      <div className="dlg-body">
        <p className="dlg-lead">
          {trialing && days > 0
            ? `${days} day${days === 1 ? "" : "s"} left on your trial. Subscribe and nothing changes.`
            : "Subscribe and nothing changes — your work stays exactly as it is."}
        </p>
        <IapChooser />
      </div>
    </Modal>
  );
}
