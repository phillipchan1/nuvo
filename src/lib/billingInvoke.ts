/**
 * Billing function calls. Before the flip these stay on Supabase
 * (`functions.invoke` + GoTrue JWT). After the flip they hit the Worker
 * proxy, which verifies Better Auth and forwards service-role.
 *
 * `billingViaWorker()` is the hook #117's launch switch should keep
 * calling. Do not add a second flip check here.
 */
import { billingViaWorker } from "./backend";
import { currentAccessToken } from "./sessionAuth";
import { functionUrl, supabase } from "./supabase";

export const BILLING_PROXY_NAMES = [
  "apple-iap",
  "stripe-checkout",
  "stripe-portal",
  "referral-code",
] as const;

export type BillingProxyName = (typeof BILLING_PROXY_NAMES)[number];

export async function invokeBilling<T>(
  name: BillingProxyName,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  if (!billingViaWorker()) {
    return supabase.functions.invoke<T>(name, { body });
  }
  const token = await currentAccessToken();
  try {
    const res = await fetch(functionUrl(name), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) {
      const message =
        data && typeof data.error === "string" && data.error.trim()
          ? data.error
          : `Could not reach ${name}`;
      return { data: null, error: { message } };
    }
    return { data: data as T, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}
