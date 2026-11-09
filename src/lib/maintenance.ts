/**
 * Write freeze + launch backend, both from GET /api/maintenance.
 *
 * Write freeze: source of truth is the Worker (`MAINTENANCE_WRITE_FREEZE` →
 * `write_freeze`). A baked `VITE_WRITE_FREEZE=1` also freezes without a round
 * trip. Fail-open if the flag URL cannot be reached — an offline Worker must
 * not freeze everyday writes — unless a cutover is armed (`VITE_CUTOVER_ARMED`
 * or `cutover_armed` on the maintenance payload). Armed + unreachable is
 * fail-closed. Once the flag has been seen as on, the cache holds that for a
 * few seconds so a blip mid-window stays frozen.
 *
 * Launch backend: a build may bake `VITE_API_BASE_URL` long before the flip.
 * `resolveLaunchBackend` reads `cutover_flipped` once before the app mounts:
 * true → the Worker, explicit false → Supabase (and forget any earlier flip),
 * anything else (omitted, non-OK, timeout, offline) → Supabase, unless this
 * device already saw the flip (`CUTOVER_FLIP_STORAGE_KEY`), which is sticky so
 * a relaunch during a network blip doesn't fall back onto the old backend.
 */
import { apiBaseUrl, apiConfigured, setWorkersEnabled, workersEnabled } from "./backend";

export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";

const TTL_MS = 5_000;
export const LAUNCH_TIMEOUT_MS = 4_000;
export const CUTOVER_FLIP_STORAGE_KEY = "nuvo.cutover_flipped";

type MaintenanceBody = {
  write_freeze?: unknown;
  cutover_armed?: unknown;
  cutover_flipped?: unknown;
};

let cached: { frozen: boolean; at: number } | null = null;
let seenArmed = false;
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

/** Allowlisted. `Boolean("false")` is true — never use it on a payload flag. */
export function parseMaintenanceFlag(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
    if (v === "0" || v === "false" || v === "no" || v === "off" || v === "") return false;
  }
  return undefined;
}

function readPersistedFlip(): boolean {
  try {
    return globalThis.localStorage?.getItem(CUTOVER_FLIP_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistFlip(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(CUTOVER_FLIP_STORAGE_KEY, "1");
    else globalThis.localStorage?.removeItem(CUTOVER_FLIP_STORAGE_KEY);
  } catch {
    // Private mode / no storage — memory still holds this session's decision.
  }
}

/** Never point the app at a Worker it has no address for. */
function chooseWorker(on: boolean): void {
  setWorkersEnabled(on && apiConfigured());
}

/** Auth and the sync layer can't switch backends mid-flight — start over on the new one. */
function requestMidSessionReload(): void {
  if (typeof window === "undefined" || typeof window.location?.reload !== "function") return;
  window.location.reload();
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
  resolved = false;
  persistFlip(false);
  setWorkersEnabled(false);
}

export function launchBackendResolved(): boolean {
  return resolved || !apiConfigured();
}

function applyBody(body: MaintenanceBody, atLaunch: boolean): void {
  seenArmed = parseMaintenanceFlag(body.cutover_armed) === true || bakedArmed();
  cached = { frozen: parseMaintenanceFlag(body.write_freeze) === true, at: Date.now() };

  const flipped = parseMaintenanceFlag(body.cutover_flipped);
  if (flipped === true) persistFlip(true);
  else if (flipped === false) persistFlip(false);

  if (atLaunch) {
    chooseWorker(flipped ?? readPersistedFlip());
    return;
  }
  // Later polls: explicit false rolls back; omitted stays where it is (sticky);
  // a flip seen mid-session reloads rather than half-switching auth.
  if (flipped === false && workersEnabled) chooseWorker(false);
  else if (flipped === true && !workersEnabled && apiConfigured()) requestMidSessionReload();
}

async function fetchMaintenance(url: string, timeoutMs?: number): Promise<Response> {
  if (timeoutMs === undefined) return fetch(url, { method: "GET", cache: "no-store" });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "GET", cache: "no-store", signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Launch-time backend choice, awaited before anything reads a session or
 * drains the outbox. One binary works before and after the flip. Failure never
 * freezes writes on its own — `writeFrozen` keeps its fail-open-unless-armed rule.
 */
export async function resolveLaunchBackend(): Promise<void> {
  const url = maintenanceUrl();
  if (!url) {
    setWorkersEnabled(false);
    resolved = true;
    return;
  }
  try {
    const res = await fetchMaintenance(url, LAUNCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`maintenance ${res.status}`);
    applyBody((await res.json()) as MaintenanceBody, true);
  } catch {
    // Fail-safe: Supabase, unless this device already saw the flip.
    chooseWorker(readPersistedFlip());
  }
  resolved = true;
}

export async function writeFrozen(): Promise<boolean> {
  if (bakedFreeze()) return true;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.frozen;
  const url = maintenanceUrl();
  const armedFallback = bakedArmed() || seenArmed;
  if (!url) return armedFallback ? true : (cached?.frozen ?? false);
  try {
    const res = await fetchMaintenance(url);
    if (!res.ok) return armedFallback ? true : (cached?.frozen ?? false);
    applyBody((await res.json()) as MaintenanceBody, false);
    return cached?.frozen ?? false;
  } catch {
    return armedFallback ? true : (cached?.frozen ?? false);
  }
}

/** Throw if writes are frozen. Agent / OKR / groom callers use this before fetch. */
export async function assertWritable(): Promise<void> {
  if (await writeFrozen()) throw new Error(WRITE_FROZEN_MESSAGE);
}
