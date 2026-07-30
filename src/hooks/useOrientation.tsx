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
import { supabase } from "../lib/supabase";
import { ORIENTATION_VERSION } from "../components/orientation/steps";

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
 * Which door the reader chose on the welcome step.
 *  • `choose` — the fork itself, still open
 *  • `show`   — the visual tour (rebuilt art, one concept a step)
 *  • `teach`  — the live walkthrough over the real app (TeachPanel)
 * The pair exists because "show me and leave me alone" and "walk me through it"
 * are different people, and guessing which one you have is how a walkthrough
 * ends up either useless or insulting.
 */
export type OrientationMode = "choose" | "show" | "teach";

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
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase
      .from("user_settings")
      .upsert({ user_id: u.user.id, onboarding_completed_version: version });
  } catch {
    /* column may not exist yet — localStorage is the source of truth */
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
