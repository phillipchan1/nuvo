import { supabase } from "./supabase";
import { isDesktopTauri } from "./platform";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled";

export interface Subscription {
  user_id: string;
  status: SubscriptionStatus;
  trial_ends_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** Computed by the `entitled(subscriptions)` Postgres function — the
   *  single source of truth for "does this account have access right now."
   *  Never re-derive this from trial_ends_at/status on the client. */
  entitled: boolean;
}

export function trialDaysRemaining(sub: Subscription | null | undefined): number {
  if (!sub?.trial_ends_at) return 0;
  return Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86_400_000));
}

const WAS_ENTITLED_KEY = "nuvo-was-entitled";

/** A device-local hint only — never a source of truth. `subscription` is
 *  deliberately excluded from the offline query cache (NEVER_PERSIST in
 *  lib/sync/persist.ts), so every launch re-checks entitlement over the
 *  network with nothing to show meanwhile. This flag lets the UI render
 *  optimistically on that first paint instead of blocking on it; real access
 *  stays enforced server-side via RLS no matter what this says, and the live
 *  check that follows corrects the UI within moments if it's stale. Cleared
 *  on sign-out so the next account on this device never inherits it. */
export function readWasEntitled(): boolean {
  try {
    return localStorage.getItem(WAS_ENTITLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWasEntitled(entitled: boolean): void {
  try {
    if (entitled) localStorage.setItem(WAS_ENTITLED_KEY, "1");
    else localStorage.removeItem(WAS_ENTITLED_KEY);
  } catch {
    /* ignore */
  }
}

export type Plan = "monthly" | "annual";

/** Where Stripe should return us. The desktop app sends nothing: checkout
 *  opens in the system browser, which can't navigate back to Tauri's
 *  internal origin, so the server falls back to APP_URL. On web/PWA this is
 *  what lets a dev machine return to itself instead of production. */
function returnOrigin(): string | undefined {
  if (isDesktopTauri()) return undefined;
  return typeof window === "undefined" ? undefined : window.location.origin;
}

export async function startCheckout(plan: Plan): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>("stripe-checkout", {
    body: { plan, origin: returnOrigin() },
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Could not start checkout");
  return data.url;
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
