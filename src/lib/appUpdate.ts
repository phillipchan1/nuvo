// Shared desktop auto-update store (Tauri only).
//
// One module-level singleton drives both the background poll (surfaced by the
// bottom-right UpdateToast) and the manual "Check for updates" button in
// Settings → Desktop app, so they never disagree about state. No-ops in the
// web/PWA build. Modeled on Dayspring's appUpdate store, plus download-progress
// tracking for the toast's progress bar.

import { isDesktopTauri } from "./platform";

export type UpdateStatus =
  | "idle" // nothing to report
  | "checking" // a check is in flight (manual checks surface this)
  | "up-to-date" // transient: last check found nothing new
  | "downloading" // a newer version is being fetched + staged
  | "ready" // staged and waiting for the user to restart
  | "error"; // last check/install failed

export interface UpdateState {
  status: UpdateStatus;
  version: string | null; // the available/staged version, when known
  progress: number; // 0–100 while downloading (0 when indeterminate)
  error: string | null; // short message for the 'error' status, when known
  notes: string | null; // human-readable "what's new" (updater `body` / latest.json `notes`)
}

const POLL_MS = 30 * 60 * 1000; // background re-check every 30 min while open
const TRANSIENT_MS = 4000; // how long "up to date"/"error" lingers before idling

const IDLE: UpdateState = { status: "idle", version: null, progress: 0, error: null, notes: null };
let state: UpdateState = IDLE;
const listeners = new Set<() => void>();
let relaunchFn: (() => Promise<void>) | null = null;
let inFlight = false;
let staged = false; // an update is downloaded and waiting for restart
let stagedVersion: string | null = null; // survives past a later "checking"/"up-to-date" transient
let stagedNotes: string | null = null;
let pollStarted = false;
let transientTimer: number | undefined;

function emit() {
  for (const l of listeners) l();
}

function set(next: UpdateState) {
  state = next;
  emit();
}

// Rests on IDLE, unless a build is already staged — then a transient (checking
// / up-to-date / error) should fall back to re-showing "ready", not erase it.
// Reads the dedicated staged* vars rather than `state`, since `state` may
// already have been overwritten (e.g. to "checking") by the time this runs.
function restingState(): UpdateState {
  return staged
    ? { status: "ready", version: stagedVersion, progress: 100, error: null, notes: stagedNotes }
    : IDLE;
}

function setTransient(next: UpdateState) {
  const fallback = restingState();
  set(next);
  window.clearTimeout(transientTimer);
  transientTimer = window.setTimeout(() => {
    // Only clear if nothing more important happened since.
    if (state.status === next.status) set(fallback);
  }, TRANSIENT_MS);
}

/**
 * Run one update check. `manual` surfaces "checking" / "up to date" feedback
 * that the silent background poll suppresses. Safe to call concurrently — extra
 * calls no-op while one is already in flight.
 *
 * Keeps checking even after a build is staged: a release that ships while the
 * first one is just sitting there waiting for "Restart to update" would
 * otherwise go unnoticed until the user restarts into the stale build and
 * immediately gets prompted to restart again for the newer one. `runCheck`
 * compares against the already-staged version so a still-current staged build
 * is a silent no-op, not a redundant re-download.
 */
export async function checkForUpdate(manual = false): Promise<void> {
  if (!isDesktopTauri() || inFlight) return;
  inFlight = true;
  if (manual) set({ status: "checking", version: null, progress: 0, error: null, notes: null });
  try {
    await runCheck(manual);
  } finally {
    inFlight = false;
  }
}

// One check attempt, with a single automatic retry on transient failures —
// network blips and brief GitHub hiccups are common and shouldn't read as a
// dead end.
async function runCheck(manual: boolean, attempt = 1): Promise<void> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    let update = await check();

    if (!update) {
      if (manual) setTransient({ status: "up-to-date", version: null, progress: 0, error: null, notes: null });
      else if (state.status !== "ready") set(IDLE);
      return;
    }

    // A build is already staged and nothing newer has shipped since — `check()`
    // will keep reporting it as "available" every poll until we actually
    // relaunch (it compares against the still-running old binary, not what's
    // staged on disk). Re-downloading the same version would be pure waste.
    if (staged && update.version === stagedVersion) {
      if (manual) setTransient({ status: "up-to-date", version: null, progress: 0, error: null, notes: null });
      return;
    }

    // Download the update, then immediately re-check before notifying the user.
    // If we published a newer version while this download was in flight, grab
    // that one too — so the user only restarts once for the absolute latest.
    // Cap at 3 cascades to guard against pathological release loops.
    const MAX_CASCADE = 3;
    let cascade = 0;
    let lastVersion = update.version;
    let lastNotes = update.body?.trim() || null;

    while (update && cascade < MAX_CASCADE) {
      lastVersion = update.version;
      lastNotes = update.body?.trim() || null;
      set({ status: "downloading", version: lastVersion, progress: 0, error: null, notes: lastNotes });

      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          received = 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          const pct = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0;
          set({ status: "downloading", version: lastVersion, progress: pct, error: null, notes: lastNotes });
        }
      });

      cascade++;
      const next = cascade < MAX_CASCADE ? await check() : null;
      // `check()` compares against the still-running (pre-relaunch) binary, so
      // it keeps reporting the version we JUST installed as "available" —
      // forever, until an actual relaunch happens. Only treat it as another
      // cascade hop if it's a genuinely different (newer) version; otherwise
      // we'd redownload the same build up to MAX_CASCADE times for no reason.
      update = next && next.version !== lastVersion ? next : null;
    }

    const { relaunch } = await import("@tauri-apps/plugin-process");
    relaunchFn = relaunch;
    staged = true;
    stagedVersion = lastVersion;
    stagedNotes = lastNotes;
    set({ status: "ready", version: lastVersion, progress: 100, error: null, notes: lastNotes });
  } catch (err) {
    if (attempt < 2) {
      // brief backoff, then one retry
      await new Promise((r) => window.setTimeout(r, 1200));
      return runCheck(manual, attempt + 1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (manual) {
      // The user asked, so give feedback — but as one quiet warning, not a
      // per-attempt console.error. The UI shows a gentle, URL-free message.
      console.warn("[updater] check failed:", msg);
      setTransient({ status: "error", version: null, progress: 0, error: msg, notes: null });
    } else if (state.status !== "ready") {
      // Background poll: stay silent and idle. Offline / no published release yet
      // is expected and must not spam the console for someone whose app works.
      set(IDLE);
    }
  }
}

/** Relaunch into the staged update. No-op until one is ready. */
export async function restartForUpdate(): Promise<void> {
  if (relaunchFn) await relaunchFn();
}

/** Start the background poll once (idempotent). Called when the first hook mounts. */
function ensurePolling() {
  if (pollStarted || !isDesktopTauri()) return;
  pollStarted = true;
  void checkForUpdate(false);
  window.setInterval(() => void checkForUpdate(false), POLL_MS);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensurePolling();
  return () => listeners.delete(listener);
}

export function getSnapshot(): UpdateState {
  return state;
}
