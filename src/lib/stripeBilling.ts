import { supabase } from "./supabase";
import { isDesktopTauri } from "./platform";
import { clearPendingReferralCode, readPendingReferralCode } from "./referral";

export type CheckoutPlan = "monthly" | "annual";

/** Where Stripe should return us. The desktop app sends nothing: checkout
 *  opens in the system browser, which can't navigate back to Tauri's
 *  internal origin, so the server falls back to APP_URL. On web/PWA this is
 *  what lets a dev machine return to itself instead of production. */
function returnOrigin(): string | undefined {
  if (isDesktopTauri()) return undefined;
  return typeof window === "undefined" ? undefined : window.location.origin;
}

export async function startCheckout(plan: CheckoutPlan): Promise<string> {
  const code = readPendingReferralCode() ?? undefined;
  const { data, error } = await supabase.functions.invoke<{ url: string }>("stripe-checkout", {
    body: { plan, origin: returnOrigin(), code },
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Could not start checkout");
  // Applied (or offered) at Checkout — don't keep re-applying on a later attempt
  // if they abandon and come back without the link.
  if (code) clearPendingReferralCode();
  return data.url;
}

/** Mint or fetch this account's personal share code. BillingPane is the only
 *  caller — quiet, no counts, no theater. */
export async function fetchReferralCode(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ code?: string; error?: string }>(
    "referral-code",
    { body: {} },
  );
  if (error || !data?.code) {
    throw new Error(data?.error ?? error?.message ?? "Could not load your code");
  }
  return data.code;
}

export async function fetchPortalUrl(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>("stripe-portal", {
    body: { origin: returnOrigin() },
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Could not open billing portal");
  return data.url;
}

/** Desktop opens the system browser — a card-entry page must never load
 *  inside the embedded Tauri webview. Web/PWA just navigates the tab. */
export async function openBillingUrl(url: string): Promise<void> {
  if (isDesktopTauri()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } else {
    window.location.href = url;
  }
}
