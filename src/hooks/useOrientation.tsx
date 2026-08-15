import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSettings } from "./useSettings";
import { makeOp, OWNER_ROW, queueWrite } from "../lib/sync";
import { ORIENTATION_VERSION } from "../components/orientation/version";

// The first-run welcome walkthrough is app chrome, not a route — it lives in its
// own tiny provider (like focus mode) rather than nav history, so Esc/Skip can't
// tangle with the back button. One provider wraps both shells; each shell renders
// <Orientation/> and reads `visible` here, and Settings replays it via `open()`.
//
// Persistence is localStorage-primary with a best-effort DB mirror:
//  • localStorage makes it work on this device with zero backend dependency, so the
//    tour ships even before the user_settings.onboarding_completed_version column is
//    migrated onto the (drifted) remote.
//  • The DB mirror is written directly + silently (NOT through the toasting settings
//    mutation), so once the column exists the flag also syncs across devices, and a
//    missing column just no-ops instead of raising a red error toast.
/**
 * Where first-run is.
 *  • `choose` — the welcome screen is up
 *  • `teach`  — the live walkthrough is running (TeachPanel)
 *
 * There was briefly a third, `show`: a card tour of rebuilt art offered beside the
 * live path. It's retired (D-065) — a diagram makes the reader map a picture onto
 * a screen they've never seen, which is the problem the live path exists to solve.
 * The name stays `choose` rather than `welcome` because the welcome still ends in
 * a choice: start, or skip.
 */
export type OrientationMode = "choose" | "teach";

interface OrientationCtx {
  /** Whether the welcome overlay is showing right now. */
  visible: boolean;
  /** Replay the tour (Settings → "Replay the welcome tour"). */
  open: () => void;
  /** Finish/skip: persist the current version and hide. */
  dismiss: () => void;
  /** The chosen door, persisted so a mid-walkthrough reload resumes it. */
  mode: OrientationMode;
  chooseMode: (m: OrientationMode) => void;
  /** Where the live walkthrough got to, likewise persisted. */
  teachStep: number;
  setTeachStep: (i: number) => void;
}

const Ctx = createContext<OrientationCtx | null>(null);

const LS_KEY = "nuvo.onboarding.version";
const LS_MODE = "nuvo.onboarding.mode";
const LS_STEP = "nuvo.onboarding.step";

function readLocalVersion(): number {
  try {
    return Number(localStorage.getItem(LS_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeLocalVersion(v: number) {
  try {
    localStorage.setItem(LS_KEY, String(v));
  } catch {
    /* ignore */
  }
}

function lsRead(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsWrite(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
function lsClear(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

// Mirror the flag to user_settings without the toasting mutation. If the column
// isn't there yet (remote migration pending), swallow the error — localStorage
// already carries the state on this device.
async function mirrorToDb(version: number) {
  // Queued like every other settings write, so finishing orientation on a
  // patchy connection still reaches the account. localStorage remains the
  // source of truth on this device either way.
  try {
    await queueWrite(
      makeOp("user_settings", "update", OWNER_ROW, {
        onboarding_completed_version: version,
      }),
    );
  } catch {
    /* storage unavailable — localStorage already carries the state */
  }
}

export function OrientationProvider({ children }: { children: ReactNode }) {
  const { settings, isLoading } = useSettings();
  const [visible, setVisible] = useState(false);
  // Auto-open runs at most once per mount: once the user has seen it (opened or
  // dismissed) we don't re-pop it just because settings re-resolve.
  const autoHandled = useRef(false);

  // The highest completed version we know about, from either store.
  const dbVersion = settings?.onboarding_completed_version ?? 0;
  const seenVersion = Math.max(readLocalVersion(), dbVersion || 0);
  const needsWelcome = seenVersion < ORIENTATION_VERSION;

  useEffect(() => {
    if (autoHandled.current) return;
    // Wait for settings so a cross-device "already seen" flag isn't missed and we
    // don't flash the tour at a returning user before their flag resolves.
    if (isLoading) return;
    autoHandled.current = true;
    if (needsWelcome) setVisible(true);
  }, [isLoading, needsWelcome]);

  // Publish "the walkthrough owns the screen" to CSS.
  //
  // The toaster is mounted OUTSIDE this provider (it is a sibling of AppShell,
  // so it survives every shell state including the signed-out one), which means
  // it cannot read this context — and it renders at z-index 999999999, well
  // over the coach card's z-80. Measured during first run: the toast covered a
  // 336×44px strip at the bottom of the card, which is where the card keeps its
  // action. A first-run walkthrough is the one moment the app controls
  // completely; a background notification must not land on the step's only
  // control. An attribute on <html> is the smallest bridge across that gap.
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.dataset.orientation = "on";
    else delete root.dataset.orientation;
    return () => {
      delete root.dataset.orientation;
    };
  }, [visible]);

  // The chosen door + how far the live walkthrough got. Persisted so a reload
  // mid-walkthrough (or the HMR remount that bit us during dev) resumes where it
  // was instead of dumping the reader back at the fork.
  const [mode, setMode] = useState<OrientationMode>(
    () => (lsRead(LS_MODE) as OrientationMode | null) ?? "choose",
  );
  const [teachStep, setTeachStepState] = useState(() => Number(lsRead(LS_STEP)) || 0);

  const chooseMode = useCallback((m: OrientationMode) => {
    setMode(m);
    lsWrite(LS_MODE, m);
  }, []);

  const setTeachStep = useCallback((i: number) => {
    setTeachStepState(i);
    lsWrite(LS_STEP, String(i));
  }, []);

  const open = useCallback(() => {
    autoHandled.current = true; // a manual replay also satisfies the auto-open gate
    // A replay starts at the fork again — the reader may want the other door.
    setMode("choose");
    setTeachStepState(0);
    lsClear(LS_MODE);
    lsClear(LS_STEP);
    setVisible(true);
  }, []);

  const dismiss = useCallback(() => {
    autoHandled.current = true;
    setVisible(false);
    setMode("choose");
    setTeachStepState(0);
    lsClear(LS_MODE);
    lsClear(LS_STEP);
    writeLocalVersion(ORIENTATION_VERSION);
    void mirrorToDb(ORIENTATION_VERSION);
  }, []);

  const value = useMemo<OrientationCtx>(
    () => ({ visible, open, dismiss, mode, chooseMode, teachStep, setTeachStep }),
    [visible, open, dismiss, mode, chooseMode, teachStep, setTeachStep]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrientation(): OrientationCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOrientation must be used within OrientationProvider");
  return ctx;
}
