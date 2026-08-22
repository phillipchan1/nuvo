import { lazy, Suspense } from "react";
import { IAP_ONLY, usesIapPaywall } from "../../lib/billingRail";
import type { Subscription } from "../../lib/subscription";

const IapLocked = lazy(() => import("./iap/LockedScreen"));
const WebLocked = IAP_ONLY ? null : lazy(() => import("./web/LockedScreen"));

/** The hard gate. iOS App Store binary → StoreKit only. Web / macOS → Stripe.
 *  A missing StoreKit catalog is a stub, never a Stripe fallback. */
export default function LockedScreen({
  subscription,
}: {
  subscription: Subscription | null | undefined;
}) {
  const Screen = IAP_ONLY || usesIapPaywall() ? IapLocked : WebLocked;
  if (!Screen) return null;
  return (
    <Suspense fallback={null}>
      <Screen subscription={subscription} />
    </Suspense>
  );
}
