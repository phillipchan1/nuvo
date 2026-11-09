/**
 * Dual-backend switch. Empty `VITE_API_BASE_URL` is today's path (Supabase).
 * Set it (e.g. `/api` or `https://api.nuvo.day/api`) to bake the Worker's
 * address in — but a baked build still talks to Supabase until the launch
 * probe (`resolveLaunchBackend` in `maintenance.ts`) reads
 * `cutover_flipped: true` from `GET /api/maintenance`. So `workersEnabled` is
 * a runtime switch, read at call time (an ES live binding), never at import.
 */
export function apiConfigured(): boolean {
  return Boolean((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim());
}

export let workersEnabled = false;

export function setWorkersEnabled(value: boolean): void {
  workersEnabled = value;
}

export function resetWorkersEnabledForTests(): void {
  workersEnabled = false;
}

/** The baked Worker base — returned even before the flip; the launch probe needs it. */
export function apiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
  return raw.replace(/\/+$/, "");
}

/** Edge-function URL. Not flipped → `${supabaseUrl}/functions/v1/<name>`. */
export function edgeFunctionUrl(supabaseOrigin: string, name: string): string {
  const raw = workersEnabled ? apiBaseUrl() : "";
  if (!raw) return `${supabaseOrigin.replace(/\/+$/, "")}/functions/v1/${name}`;
  if (raw.endsWith("/functions/v1") || raw.endsWith("/api")) return `${raw}/${name}`;
  return `${raw}/api/${name}`;
}

/** The Worker's `/api` root from the baked base. Callers gate on `workersEnabled`. */
export function authBaseUrl(): string {
  const raw = apiBaseUrl();
  if (!raw) return "";
  if (raw.endsWith("/api")) return raw;
  if (raw.endsWith("/functions/v1")) return raw.replace(/\/functions\/v1$/, "/api");
  return `${raw}/api`;
}

/** `GET /api/entitlement`. Empty until the Worker is flipped on. */
export function entitlementUrl(authBase = workersEnabled ? authBaseUrl() : ""): string {
  const base = authBase.replace(/\/+$/, "");
  return base ? `${base}/entitlement` : "";
}
