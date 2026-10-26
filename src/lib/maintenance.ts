/**
 * Write freeze the app reads during cutover. Source of truth is the Worker
 * (`MAINTENANCE_WRITE_FREEZE` → GET /api/maintenance). A baked
 * `VITE_WRITE_FREEZE=1` also freezes without a round trip.
 *
 * Fail-open if the flag URL cannot be reached — an offline Worker must not
 * freeze everyday writes — unless a cutover is armed (`VITE_CUTOVER_ARMED`
 * or `cutover_armed` on the maintenance payload). Armed + unreachable is
 * fail-closed. Once the flag has been seen as on, the cache holds that
 * for a few seconds so a blip mid-window stays frozen.
 */
import { apiBaseUrl, workersEnabled } from "./backend";

export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";

const TTL_MS = 5_000;

let cached: { frozen: boolean; at: number } | null = null;
let seenArmed = false;

function flagOn(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase() ?? "";
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function bakedFreeze(): boolean {
  return flagOn(import.meta.env.VITE_WRITE_FREEZE as string | undefined);
}

function bakedArmed(): boolean {
  return flagOn(import.meta.env.VITE_CUTOVER_ARMED as string | undefined);
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
  seenArmed = false;
}

export async function writeFrozen(): Promise<boolean> {
  if (bakedFreeze()) return true;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.frozen;
  const url = maintenanceUrl();
  const armedFallback = bakedArmed() || seenArmed;
  if (!url) return armedFallback ? true : (cached?.frozen ?? false);
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return armedFallback ? true : (cached?.frozen ?? false);
    const body = (await res.json()) as { write_freeze?: unknown; cutover_armed?: unknown };
    seenArmed = Boolean(body.cutover_armed) || bakedArmed();
    cached = { frozen: Boolean(body.write_freeze), at: Date.now() };
    return cached.frozen;
  } catch {
    return armedFallback ? true : (cached?.frozen ?? false);
  }
}

/** Throw if writes are frozen. Agent / OKR / groom callers use this before fetch. */
export async function assertWritable(): Promise<void> {
  if (await writeFrozen()) throw new Error(WRITE_FROZEN_MESSAGE);
}
