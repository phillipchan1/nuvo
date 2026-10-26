/**
 * Write freeze the app reads during cutover. Source of truth is the Worker
 * (`MAINTENANCE_WRITE_FREEZE` → GET /api/maintenance). A baked
 * `VITE_WRITE_FREEZE=1` also freezes without a round trip.
 *
 * Fail-open if the flag URL cannot be reached: an offline Worker must not
 * freeze everyday writes. Once the flag has been seen as on, the cache holds
 * that for a few seconds so a blip mid-window stays frozen.
 */
import { apiBaseUrl, workersEnabled } from "./backend";

export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";

const TTL_MS = 5_000;

let cached: { frozen: boolean; at: number } | null = null;

function bakedFreeze(): boolean {
  const v = (import.meta.env.VITE_WRITE_FREEZE as string | undefined)?.trim().toLowerCase() ?? "";
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function maintenanceUrl(): string {
  const explicit = (import.meta.env.VITE_MAINTENANCE_URL as string | undefined)?.trim() ?? "";
  if (explicit) return explicit.replace(/\/+$/, "");
  if (!workersEnabled) return "";
  const base = apiBaseUrl();
  if (!base) return "";
  if (base.endsWith("/api")) return `${base}/maintenance`;
  return `${base}/api/maintenance`;
}

export function resetMaintenanceCacheForTests(): void {
  cached = null;
}

export async function writeFrozen(): Promise<boolean> {
  if (bakedFreeze()) return true;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.frozen;
  const url = maintenanceUrl();
  if (!url) return cached?.frozen ?? false;
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return cached?.frozen ?? false;
    const body = (await res.json()) as { write_freeze?: unknown };
    cached = { frozen: Boolean(body.write_freeze), at: Date.now() };
    return cached.frozen;
  } catch {
    return cached?.frozen ?? false;
  }
}
