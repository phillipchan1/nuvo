/**
 * Dual-backend switch. `VITE_API_BASE_URL` names the Worker so one binary
 * can talk to it after the flip. The live backend is chosen at launch from
 * GET /api/maintenance (`cutover_flipped`), not at build time.
 */
export function apiConfigured(): boolean {
  return Boolean((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim());
}

export function apiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
  return raw.replace(/\/+$/, "");
}

/** True only after launch resolution sees `cutover_flipped`. */
export let workersEnabled = false;

export function setWorkersEnabled(value: boolean): void {
  workersEnabled = Boolean(value);
}

export function resetWorkersEnabledForTests(): void {
  workersEnabled = false;
}

/** Edge-function URL. Worker only after the runtime flip. */
export function edgeFunctionUrl(supabaseOrigin: string, name: string): string {
  const raw = workersEnabled ? apiBaseUrl() : "";
  if (!raw) return `${supabaseOrigin.replace(/\/+$/, "")}/functions/v1/${name}`;
  if (raw.endsWith("/functions/v1") || raw.endsWith("/api")) return `${raw}/${name}`;
  return `${raw}/api/${name}`;
}

export function authBaseUrl(): string {
  const raw = apiBaseUrl();
  if (!raw) return "";
  if (raw.endsWith("/api")) return raw;
  if (raw.endsWith("/functions/v1")) return raw.replace(/\/functions\/v1$/, "/api");
  return `${raw}/api`;
}

/** `GET /api/entitlement`. Empty when the Worker path is not live. */
export function entitlementUrl(authBase = authBaseUrl()): string {
  if (!workersEnabled) return "";
  const base = authBase.replace(/\/+$/, "");
  return base ? `${base}/entitlement` : "";
}

/** Root of `/api/data` and `/api/rpc` when the Worker path is live. */
export function workerApiRoot(): string {
  if (!workersEnabled) return "";
  const raw = apiBaseUrl();
  if (!raw) return "";
  if (raw.endsWith("/api")) return raw;
  if (raw.endsWith("/functions/v1")) return raw.replace(/\/functions\/v1$/, "/api");
  return `${raw}/api`;
}

/** Billing / Stripe / StoreKit stay on Supabase. Do not rewrite these. */
export const BILLING_FUNCTION_NAMES = new Set([
  "apple-iap",
  "apple-webhook",
  "iap-catalog",
  "referral-code",
  "stripe-checkout",
  "stripe-portal",
  "stripe-webhook",
]);
