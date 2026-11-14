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
 *
 * Flip / unflip takes effect on the next cold start only; an already-running
 * session keeps its backend for the whole session. Sticky
 * `nuvo.cutover_flipped` records the last known allowlisted flag so the next
 * launch can flip or roll back even if maintenance is briefly unreachable.
 *
 * Downgrade-safe: the only thing this module persists is that key, holding
 * `"1"` or absent. Builds before it (≤ v1.2.794) never read it.
 */
import { apiBaseUrl, apiConfigured, setWorkersEnabled } from "./backend";

export const WRITE_FROZEN_MESSAGE =
  "Nuvo is briefly read-only during a maintenance window. Try again in a few minutes.";

const TTL_MS = 5_000;
/**
 * How long launch waits on `/api/maintenance` before falling back. ~3s keeps a
 * desktop cold start snappy, and the Worker answers maintenance from the local
 * edge (no database round trip), so a healthy read is far under this.
 * `BackendGate` caps its loading screen at the same number.
 */
export const LAUNCH_TIMEOUT_MS = 3_000;
export const CUTOVER_FLIP_STORAGE_KEY = "nuvo.cutover_flipped";

type MaintenanceBody = {
  write_freeze?: unknown;
  cutover_armed?: unknown;
  cutover_flipped?: unknown;
  inbound_mail_domain?: unknown;
};

let cached: { frozen: boolean; at: number } | null = null;
let seenArmed = false;
let resolved = false;
let liveInboundDomain: string | null = null;

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Inbox-address domain from GET /api/maintenance (`inbound_mail_domain`), or null before the first answer. */
export function liveInboundMailDomain(): string | null {
  return liveInboundDomain;
}

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

/**
 * The launch decision — made once. If `settleLaunchBackend` already gave up on
 * the probe, a late answer must not switch a session that has started.
 * Never points the app at a Worker it has no address for.
 */
function chooseWorker(on: boolean): void {
  if (resolved) return;
  setWorkersEnabled(on && apiConfigured());
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
  liveInboundDomain = null;
  resolved = false;
  persistFlip(false);
  setWorkersEnabled(false);
}

export function launchBackendResolved(): boolean {
  return resolved || !apiConfigured();
}

function isPlainObject(value: unknown): value is MaintenanceBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyBody(body: MaintenanceBody, atLaunch: boolean): void {
  if (typeof body.inbound_mail_domain === "string") {
    const d = body.inbound_mail_domain.trim().toLowerCase();
    if (DOMAIN_RE.test(d)) liveInboundDomain = d;
  }
  seenArmed = parseMaintenanceFlag(body.cutover_armed) === true || bakedArmed();
  cached = { frozen: parseMaintenanceFlag(body.write_freeze) === true, at: Date.now() };

  const flipped = parseMaintenanceFlag(body.cutover_flipped);
  if (flipped === true) persistFlip(true);
  else if (flipped === false) persistFlip(false);

  // The backend is chosen here, at launch, and nowhere else. Later polls only
  // refresh the freeze cache and the sticky key above — flip / unflip takes
  // effect on the next cold start, never mid-session (auth and the sync
  // layer can't switch backends mid-flight).
  if (atLaunch) chooseWorker(flipped ?? readPersistedFlip());
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
  try {
    const url = maintenanceUrl();
    if (!url) {
      chooseWorker(false);
      return;
    }
    // Offline: don't spend the timeout on a fetch that can't land.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      chooseWorker(readPersistedFlip());
      return;
    }
    const res = await fetchMaintenance(url, LAUNCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`maintenance ${res.status}`);
    const body: unknown = await res.json();
    if (!isPlainObject(body)) throw new Error("maintenance body");
    applyBody(body, true);
  } catch {
    // Fail-safe (unreachable, timeout, non-JSON, garbage): Supabase, unless
    // this device already saw the flip.
    chooseWorker(readPersistedFlip());
  } finally {
    resolved = true;
  }
}

/**
 * Belt-and-suspenders for `BackendGate`: if the probe hasn't decided by the
 * gate's own cap, decide now (sticky flip or Supabase) and ignore the late
 * answer — the next launch picks it up.
 */
export function settleLaunchBackend(): void {
  if (resolved) return;
  chooseWorker(readPersistedFlip());
  resolved = true;
}

/**
 * What `BackendGate` awaits: the probe, raced against a hard cap of
 * `LAUNCH_TIMEOUT_MS` so a hung promise can never leave the loading screen up.
 * The probe's own abort normally wins first; on the cap the probe keeps
 * running in the background but can no longer change this session's backend.
 */
export async function resolveLaunchBackendCapped(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, LAUNCH_TIMEOUT_MS);
  });
  try {
    await Promise.race([resolveLaunchBackend().catch(() => {}), cap]);
  } finally {
    clearTimeout(timer);
    settleLaunchBackend();
  }
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
    const body: unknown = await res.json();
    if (!isPlainObject(body)) return armedFallback ? true : (cached?.frozen ?? false);
    // Mid-session: freeze cache + sticky key only; the backend stays put until relaunch.
    applyBody(body, false);
    return cached?.frozen ?? false;
  } catch {
    return armedFallback ? true : (cached?.frozen ?? false);
  }
}

/** Throw if writes are frozen. Agent / OKR / groom callers use this before fetch. */
export async function assertWritable(): Promise<void> {
  if (await writeFrozen()) throw new Error(WRITE_FROZEN_MESSAGE);
}
