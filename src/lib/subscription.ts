import { supabase } from "./supabase";
import { isDesktopTauri } from "./platform";
import { clearPendingReferralCode, readPendingReferralCode } from "./referral";

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
  /** Personal share code (Stripe Promotion Code). Null until Billing asks
   *  `referral-code` to mint or attach one. */
  referral_code?: string | null;
  /** Friends who used this code at Checkout. */
  referral_uses?: number;
  referral_last_use_at?: string | null;
  /** Free months granted via friend-codes (stripe-webhook). */
  referral_credits_earned?: number;
  referral_last_credit_at?: string | null;
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

/**
 * A subscriptions SELECT that returns zero rows is not "this account isn't
 * entitled." RLS answers empty for an expired/missing JWT the same way it
 * answers empty for a missing row, and PostgREST reports that as `null`, not
 * an error. Trusting that null as cancelled is how a paying customer lands
 * on the paywall (or has the was-entitled hint cleared) after a blip.
 *
 * `retry` = refresh the JWT and read again. `fail` = throw, so the shell
 * can keep the app up on last launch's hint instead of locking them out.
 */
export function interpretSubscriptionRead(
  row: Subscription | null,
  opts: { hasSession: boolean; alreadyRetried: boolean },
): { action: "return"; row: Subscription | null } | { action: "retry" } | { action: "fail" } {
  if (row !== null) return { action: "return", row };
  if (!opts.hasSession) return { action: "return", row: null };
  if (!opts.alreadyRetried) return { action: "retry" };
  return { action: "fail" };
}

export type EntitlementView = "loading" | "verify-error" | "locked" | "open";

/**
 * What the signed-in shell should render. A failed or empty subscription
 * check is never "not entitled" — only an actual row with `entitled = false`
 * is. Last launch's hint lets a paying account keep working through a blip
 * instead of unmounting the planner (and the capture they just typed).
 */
export function resolveEntitlementView(args: {
  subPending: boolean;
  subError: boolean;
  subscription: Subscription | null | undefined;
  checkoutPending: boolean;
  wasEntitled: boolean;
}): EntitlementView {
  const entitled = Boolean(args.subscription?.entitled);
  const trust = entitled || args.wasEntitled;
  const waiting = args.subPending || (args.checkoutPending && !entitled);

  if (waiting && !trust) return "loading";
  if (args.subError && !trust) return "verify-error";
  if (!entitled && !trust) return "locked";
  return "open";
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
