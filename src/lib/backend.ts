/**
 * Dual-backend switch. Empty `VITE_API_BASE_URL` is today's path (Supabase).
 * Set it (e.g. `/api` or `https://nuvo-preview.<account>.workers.dev/api`)
 * to talk to the Worker. Tree-shaken / never loaded when unset.
 */
export const workersEnabled = Boolean(
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim(),
);

export function apiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
  return raw.replace(/\/+$/, "");
}

/** Edge-function URL. Flag off → `${supabaseUrl}/functions/v1/<name>`. */
export function edgeFunctionUrl(supabaseOrigin: string, name: string): string {
  const raw = apiBaseUrl();
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
