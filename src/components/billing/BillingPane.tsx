import { lazy, Suspense } from "react";
import { IAP_ONLY, usesIapPaywall } from "../../lib/billingRail";

const IapPane = lazy(() => import("./iap/BillingPane").then((m) => ({ default: m.IapBillingPane })));
const WebPane = IAP_ONLY
  ? null
  : lazy(() => import("./web/BillingPane").then((m) => ({ default: m.WebBillingPane })));

export function BillingPane() {
  const Pane = IAP_ONLY || usesIapPaywall() ? IapPane : WebPane;
  if (!Pane) return null;
  return (
    <Suspense fallback={null}>
      <Pane />
    </Suspense>
  );
}
