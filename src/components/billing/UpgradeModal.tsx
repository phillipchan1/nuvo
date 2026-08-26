import { lazy, Suspense } from "react";
import { IAP_ONLY, usesIapPaywall } from "../../lib/billingRail";

const IapModal = lazy(() =>
  import("./iap/UpgradeModal").then((m) => ({ default: m.IapUpgradeModal })),
);
const WebModal = IAP_ONLY
  ? null
  : lazy(() => import("./web/UpgradeModal").then((m) => ({ default: m.WebUpgradeModal })));

export function UpgradeModal({ onClose }: { onClose: () => void }) {
  const Modal = IAP_ONLY || usesIapPaywall() ? IapModal : WebModal;
  if (!Modal) return null;
  return (
    <Suspense fallback={null}>
      <Modal onClose={onClose} />
    </Suspense>
  );
}
