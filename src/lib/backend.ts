/**
 * Dual-backend switch. Empty `VITE_API_BASE_URL` means the Worker is not
 * baked in. Set it (e.g. `/api` or `https://api.nuvo.day/api`) to bake the
 * Worker's address. REST still waits for the launch probe
 * (`resolveLaunchBackend` in `maintenance.ts`) to read `cutover_flipped: true`
 * before `workersEnabled` flips — that gate is an ES live binding, never
 * import-time. Function URLs (`edgeFunctionUrl`) always use the baked base:
 * the production Supabase project is gone, so there is no origin to fall back
 * to.
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

/** Worker function URL from the baked API base. Empty when none is baked. */
export function edgeFunctionUrl(name: string): string {
  const raw = apiBaseUrl();
  if (!raw) return "";
  if (raw.endsWith("/functions/v1") || raw.endsWith("/api")) return `${raw}/${name}`;
  return `${raw}/api/${name}`;
}

/**
 * Calendar providers whose Worker OAuth *start* the SPA may navigate to.
 * M365 still has `/api/m365-oauth` (and the `/functions/v1` twin) but every
 * path is 503 `m365_disabled` without `MS_*` secrets — do not link it.
 */
const WORKER_CALENDAR_OAUTH = new Set(["google"]);

/** Start URL for calendar OAuth. Null when the provider has no live Worker route
 *  or the API base is not baked — callers hide/no-op rather than invent a host. */
export function calendarOauthStartHref(
  provider: string,
  token: string,
  redirect: string,
): string | null {
  if (!WORKER_CALENDAR_OAUTH.has(provider)) return null;
  const base = edgeFunctionUrl(`${provider}-oauth`);
  if (!base) return null;
  const params = new URLSearchParams({ action: "start", token, redirect });
  return `${base}?${params.toString()}`;
}

/** Start URL for Notion's consent screen (D-257): the Worker's `notion-oauth`
 *  from the baked API base, like calendar OAuth. Null when no base is baked —
 *  never `VITE_SUPABASE_URL`, whose project is gone (a dead host fails quietly). */
export function notionOauthStartHref(token: string, redirect: string): string | null {
  const base = edgeFunctionUrl("notion-oauth");
  if (!base || !token) return null;
  const params = new URLSearchParams({ action: "start", token, redirect });
  return `${base}?${params.toString()}`;
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
