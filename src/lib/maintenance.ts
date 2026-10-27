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
export const LAUNCH_TIMEOUT_MS = 4_000;

let cached: { frozen: boolean; at: number } | null = null;
let seenArmed = false;
let seenFlipped = false;
let minVersion: string | null = null;
let resolved = false;
let sawMaintenanceBody = false;

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
  sawMaintenanceBody = false;
}

/** Allowlisted truthy. `Boolean("false")` is a JS trap — do not use it. */
export function parseMaintenanceFlag(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
    if (v === "0" || v === "false" || v === "no" || v === "off" || v === "") return false;
    return undefined;
  }
  return undefined;
}

function requestMidSessionReload(): void {
  if (typeof window === "undefined" || typeof window.location?.reload !== "function") return;
  window.location.reload();
}

export function clientMinVersion(): string | null {
  return minVersion;
}

function currentAppVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
}

export function clientBelowMinVersion(): boolean {
  if (!resolved || !sawMaintenanceBody) return false;
  if (!minVersion) return true;
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
}, atLaunch: boolean): void {
  sawMaintenanceBody = true;
  const armed = parseMaintenanceFlag(body.cutover_armed);
  if (armed === true || bakedArmed()) seenArmed = true;
  const flipped = parseMaintenanceFlag(body.cutover_flipped);
  if (flipped === true) seenFlipped = true;

  minVersion = readMinVersion(body);

  if (atLaunch) {
    setWorkersEnabled(seenFlipped);
  } else if (flipped === true && !workersEnabled) {
    requestMidSessionReload();
    return;
  } else if (seenFlipped && !workersEnabled) {
    setWorkersEnabled(true);
  }
  // {} or cutover_flipped:false after a sticky flip must not unflip.

  cached = {
    frozen: parseMaintenanceFlag(body.write_freeze) === true || clientBelowMinVersion(),
    at: Date.now(),
  };
}

function failSafe(): void {
  // Pre-flip: behave like master (fail-open). Armed or already flipped: freeze.
  cached = { frozen: seenArmed || seenFlipped || bakedArmed(), at: Date.now() };
  if (!seenFlipped) setWorkersEnabled(false);
}

async function fetchMaintenance(url: string, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "GET", cache: "no-store", signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
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
    const res = await fetchMaintenance(url, LAUNCH_TIMEOUT_MS);
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
    applyMaintenanceBody(body, true);
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
  const armedFallback = bakedArmed() || seenArmed || seenFlipped;
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
    applyMaintenanceBody(body, false);
    return (cached?.frozen ?? false) || clientBelowMinVersion();
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
