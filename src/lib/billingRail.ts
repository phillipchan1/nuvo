// Which payment rail this surface is allowed to show.
//
// The iOS App Store binary is StoreKit only. A production iOS Tauri build
// sets VITE_IAP_ONLY=1 (see vite.config.ts) so Stripe checkout / portal /
// web prices are tree-shaken out of the IPA. `tauri ios dev` shares the
// ordinary Vite server, so `isTauriIOS()` is the runtime safety net — never
// fall back to Stripe on that shell.
import { isTauriIOS } from "./platform";

export const IAP_ONLY = import.meta.env.VITE_IAP_ONLY === "1";

export function usesIapPaywall(): boolean {
  if (IAP_ONLY) return true;
  return isTauriIOS();
}
