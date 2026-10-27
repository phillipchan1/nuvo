/**
 * Write freeze + launch backend + min-version, all from GET /api/maintenance.
 *
 * Fail-safe if the flag URL cannot be reached: do not write (the backend
 * may already be frozen). A baked `VITE_WRITE_FREEZE=1` also freezes
 * without a round trip. Once the flag has been seen as on, the cache holds
 * that for a few seconds so a blip mid-window stays frozen.
 */
import { apiBaseUrl, apiConfigured, setWorkersEnabled, workersEnabled } from "./backend";
import { isBelowMinVersion, readMinVersion } from "./minVersion";

export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";

export const UPDATE_REQUIRED_MESSAGE =
  "This version of Nuvo is out of date. Update to keep writing.";

const TTL_MS = 5_000;

let cached: { frozen: boolean; at: number } | null = null;
let seenArmed = false;
let seenFlipped = false;
let minVersion: string | null = null;
let resolved = false;

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
  const base = apiBaseUrl();
  if (!base) return "";
  if (base.endsWith("/api")) return `${base}/maintenance`;
  return `${base}/api/maintenance`;
}

export function resetMaintenanceCacheForTests(): void {
  cached = null;
  seenArmed = false;
  seenFlipped = false;
  minVersion = null;
  resolved = false;
}

export function clientMinVersion(): string | null {
  return minVersion;
}

function currentAppVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
}

export function clientBelowMinVersion(): boolean {
  if (!minVersion) return false;
  return isBelowMinVersion(currentAppVersion(), minVersion);
}

export function launchBackendResolved(): boolean {
  return resolved || !apiConfigured();
}

function applyMaintenanceBody(body: {
  write_freeze?: unknown;
  cutover_armed?: unknown;
  cutover_flipped?: unknown;
  min_version?: unknown;
  min_client_version?: unknown;
  minimum_version?: unknown;
}): void {
  seenArmed = Boolean(body.cutover_armed) || bakedArmed();
  seenFlipped = Boolean(body.cutover_flipped) || seenFlipped;
  minVersion = readMinVersion(body);
  setWorkersEnabled(Boolean(body.cutover_flipped));
  cached = { frozen: Boolean(body.write_freeze) || clientBelowMinVersion(), at: Date.now() };
}

function failSafe(): void {
  cached = { frozen: true, at: Date.now() };
  if (!seenFlipped) setWorkersEnabled(false);
}

/** Launch-time backend choice. One binary works before and after the flip. */
export async function resolveLaunchBackend(): Promise<void> {
  if (bakedFreeze()) {
    cached = { frozen: true, at: Date.now() };
    resolved = true;
    return;
  }
  const url = maintenanceUrl();
  if (!url) {
    setWorkersEnabled(false);
    resolved = true;
    return;
  }
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) {
      failSafe();
      resolved = true;
      return;
    }
    const body = (await res.json()) as {
      write_freeze?: unknown;
      cutover_armed?: unknown;
      cutover_flipped?: unknown;
      min_version?: unknown;
      min_client_version?: unknown;
      minimum_version?: unknown;
    };
    applyMaintenanceBody(body);
    resolved = true;
  } catch {
    failSafe();
    resolved = true;
  }
}

export async function writeFrozen(): Promise<boolean> {
  if (bakedFreeze() || clientBelowMinVersion()) return true;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.frozen;
  const url = maintenanceUrl();
  const armedFallback = bakedArmed() || seenArmed || apiConfigured();
  if (!url) return armedFallback ? true : (cached?.frozen ?? false);
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return armedFallback ? true : (cached?.frozen ?? false);
    const body = (await res.json()) as {
      write_freeze?: unknown;
      cutover_armed?: unknown;
      cutover_flipped?: unknown;
      min_version?: unknown;
      min_client_version?: unknown;
      minimum_version?: unknown;
    };
    applyMaintenanceBody(body);
    return cached?.frozen ?? false;
  } catch {
    return armedFallback ? true : (cached?.frozen ?? false);
  }
}

/** Throw if writes are frozen or this build is below min_version. */
export async function assertWritable(): Promise<void> {
  if (clientBelowMinVersion()) throw new Error(UPDATE_REQUIRED_MESSAGE);
  if (await writeFrozen()) {
    throw new Error(clientBelowMinVersion() ? UPDATE_REQUIRED_MESSAGE : WRITE_FROZEN_MESSAGE);
  }
}

/** @deprecated use workersEnabled from backend — kept for existing tests that import it. */
export { workersEnabled };
