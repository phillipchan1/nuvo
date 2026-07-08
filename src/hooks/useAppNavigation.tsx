import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_NAV,
  NAV_HISTORY_KEY,
  NAV_STACK_INDEX_KEY,
  mergeNav,
  navEqual,
  readNavState,
  type AppNavState,
  type FloorModal,
  type FlowFocus,
  type OverlayKind,
  type SettingsSection,
} from "../lib/appNav";
import type { Rung, Focus } from "../components/AppShell";
import type { FlowName } from "../components/Spine";
import type { ProjectView, DetailView } from "../components/FloorPane";
import type { RailTab } from "../components/LeftRail";
import type { CalView } from "../components/CalendarPane";
import { writeAgentOpen } from "../components/AgentSidebar";

export type HistoryMode = "push" | "replace" | "none";

interface AppNavigationContextValue {
  nav: AppNavState;
  navigate: (patch: Partial<AppNavState>, mode?: HistoryMode) => void;
  back: () => void;
  canGoBack: () => boolean;
  panelAnchor: DOMRect | null;
  setPanelAnchor: (anchor: DOMRect | null) => void;
  setRung: (r: Rung) => void;
  goRung: (r: Rung) => void;
  setTab: (t: RailTab) => void;
  setCalView: (v: CalView) => void;
  openFlow: (f: FlowName, focus?: FlowFocus) => void;
  closeFlow: () => void;
  setFlowStep: (step: number) => void;
  openOverlay: (kind: OverlayKind, id?: string | null, anchor?: DOMRect | null) => void;
  closeOverlay: () => void;
  /** Open a project / initiative as the centered Record modal. */
  openRecord: (kind: "project" | "initiative", id: string) => void;
  openFloorModal: (modal: FloorModal) => void;
  closeFloorModal: () => void;
  toggleAgent: () => void;
  focusDomain: (focus: Focus) => void;
  focusInitiative: (focus: Focus) => void;
  openInitiative: (focus: Focus) => void;
  openProject: (focus: Focus) => void;
  setProjectView: (v: ProjectView) => void;
  setInitiativeView: (v: DetailView) => void;
  setSettingsSection: (s: SettingsSection) => void;
  setNowMoment: (m: AppNavState["nowMoment"], taskId?: string | null) => void;
}

const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

export function AppNavigationProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<AppNavState[]>([DEFAULT_NAV]);
  const indexRef = useRef(0);
  const [nav, setNav] = useState<AppNavState>(DEFAULT_NAV);
  const navRef = useRef(nav);
  navRef.current = nav;

  const [panelAnchor, setPanelAnchor] = useState<DOMRect | null>(null);
  const syncingRef = useRef(false);
  const seededRef = useRef(false);

  useEffect(() => {
    writeAgentOpen(nav.agentOpen);
  }, [nav.agentOpen]);

  const writeHistory = useCallback((state: AppNavState, index: number, mode: HistoryMode) => {
    if (mode === "none") return;
    const payload = { [NAV_HISTORY_KEY]: state, [NAV_STACK_INDEX_KEY]: index };
    if (mode === "replace") history.replaceState(payload, "");
    else history.pushState(payload, "");
  }, []);

  const applyAtIndex = useCallback((index: number) => {
    indexRef.current = index;
    const state = stackRef.current[index] ?? DEFAULT_NAV;
    setNav(state);
    setPanelAnchor(null);
  }, []);

  const applyNav = useCallback(
    (next: AppNavState, mode: HistoryMode = "push") => {
      if (navEqual(stackRef.current[indexRef.current], next)) return;

      if (mode === "replace") {
        stackRef.current[indexRef.current] = next;
      } else if (mode === "push") {
        stackRef.current = stackRef.current.slice(0, indexRef.current + 1);
        stackRef.current.push(next);
        indexRef.current = stackRef.current.length - 1;
      } else {
        stackRef.current[indexRef.current] = next;
        setNav(next);
        return;
      }

      setNav(next);
      writeHistory(next, indexRef.current, mode);
    },
    [writeHistory],
  );

  const navigate = useCallback(
    (patch: Partial<AppNavState>, mode: HistoryMode = "push") => {
      if (syncingRef.current) {
        const next = mergeNav(stackRef.current[indexRef.current], patch);
        stackRef.current[indexRef.current] = next;
        setNav(next);
        return;
      }
      const next = mergeNav(stackRef.current[indexRef.current], patch);
      applyNav(next, mode);
    },
    [applyNav],
  );

  const canGoBack = useCallback(() => indexRef.current > 0, []);

  const back = useCallback(() => {
    if (indexRef.current <= 0) return;
    syncingRef.current = true;
    history.back();
    queueMicrotask(() => {
      syncingRef.current = false;
    });
  }, []);

  // Seed browser history once on mount.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const existing = readNavState(history.state?.[NAV_HISTORY_KEY]);
    const idx = history.state?.[NAV_STACK_INDEX_KEY];
    if (existing && typeof idx === "number") {
      stackRef.current[idx] = existing;
      applyAtIndex(idx);
    } else if (existing) {
      stackRef.current[0] = existing;
      applyAtIndex(0);
    } else {
      writeHistory(stackRef.current[0], 0, "replace");
    }
  }, [applyAtIndex, writeHistory]);

  // Browser back / forward + mouse back button.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const idx = e.state?.[NAV_STACK_INDEX_KEY];
      const restored = readNavState(e.state?.[NAV_HISTORY_KEY]);
      syncingRef.current = true;
      if (typeof idx === "number" && restored) {
        stackRef.current[idx] = restored;
        applyAtIndex(idx);
      } else if (restored) {
        const found = stackRef.current.findIndex((s) => navEqual(s, restored));
        applyAtIndex(found >= 0 ? found : 0);
      } else if (indexRef.current > 0) {
        applyAtIndex(indexRef.current - 1);
      }
      queueMicrotask(() => {
        syncingRef.current = false;
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      if (!canGoBack()) return;
      e.preventDefault();
      e.stopPropagation();
      back();
    };

    const onAuxClick = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      if (!canGoBack()) return;
      e.preventDefault();
      e.stopPropagation();
      back();
    };

    window.addEventListener("popstate", onPop);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("auxclick", onAuxClick, true);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("auxclick", onAuxClick, true);
    };
  }, [applyAtIndex, back, canGoBack]);

  const clearCalendarOverlay = useCallback((patch: Partial<AppNavState>) => {
    const { overlay } = navRef.current;
    if (overlay === "task" || overlay === "event" || overlay === "slot") {
      patch.overlay = "none";
      patch.overlayId = null;
    }
  }, []);

  const setRung = useCallback(
    (r: Rung) => {
      const patch: Partial<AppNavState> = { rung: r, floorModal: null };
      if (r === "project") patch.projectView = "ondeck";
      if (r === "initiative") patch.initiativeView = "ondeck";
      if (r !== "day") {
        clearCalendarOverlay(patch);
        setPanelAnchor(null);
      }
      navigate(patch);
    },
    [clearCalendarOverlay, navigate],
  );

  const goRung = setRung;

  const setTab = useCallback((t: RailTab) => navigate({ tab: t }), [navigate]);

  const setCalView = useCallback((v: CalView) => navigate({ calView: v }), [navigate]);

  const openFlow = useCallback(
    (f: FlowName, focus?: FlowFocus) =>
      navigate({ flow: f, flowStep: 0, flowFocus: focus ?? null, overlay: "none", overlayId: null, floorModal: null }),
    [navigate],
  );

  const closeFlow = useCallback(() => {
    const { flow, flowStep } = navRef.current;
    if (flow && flowStep >= 0) {
      history.go(-(flowStep + 1));
      return;
    }
    navigate({ flow: null, flowStep: 0 }, "replace");
  }, [navigate]);

  const setFlowStep = useCallback(
    (step: number) => navigate({ flowStep: step }),
    [navigate],
  );

  const openOverlay = useCallback(
    (kind: OverlayKind, id: string | null = null, anchor: DOMRect | null = null) => {
      setPanelAnchor(anchor);
      navigate({ overlay: kind, overlayId: id, floorModal: null });
    },
    [navigate],
  );

  const openFloorModal = useCallback(
    (modal: FloorModal) => {
      if (!modal) return;
      navigate({ floorModal: modal });
    },
    [navigate],
  );

  const closeFloorModal = useCallback(() => {
    if (navRef.current.floorModal) {
      if (canGoBack()) back();
      else navigate({ floorModal: null }, "replace");
    }
  }, [back, canGoBack, navigate]);

  const openRecord = useCallback(
    (kind: "project" | "initiative", id: string) =>
      navigate({
        overlay: kind === "project" ? "project-record" : "initiative-record",
        overlayId: id,
        floorModal: null,
      }),
    [navigate],
  );

  const closeOverlay = useCallback(() => {
    if (navRef.current.overlay !== "none") {
      // Prefer history.back() so the overlay open is removed from the stack.
      // Fall back to a direct replace when there's nowhere to go back to
      // (e.g. the app was reloaded mid-session with an overlay already open).
      if (canGoBack()) back();
      else navigate({ overlay: "none", overlayId: null, floorModal: null }, "replace");
    } else if (navRef.current.floorModal) {
      if (canGoBack()) back();
      else navigate({ floorModal: null }, "replace");
    } else if (navRef.current.flow) {
      closeFlow();
    } else if (navRef.current.rung !== "day") {
      setRung("day");
    }
  }, [back, canGoBack, navigate, closeFlow, setRung]);

  const toggleAgent = useCallback(() => {
    navigate({ agentOpen: !navRef.current.agentOpen });
  }, [navigate]);

  const focusDomain = useCallback(
    (focus: Focus) => navigate({ focus }),
    [navigate],
  );

  const focusInitiative = useCallback(
    (focus: Focus) => navigate({ focus, initiativeView: "detail", floorModal: null }),
    [navigate],
  );

  const openInitiative = useCallback(
    (focus: Focus) => {
      const patch: Partial<AppNavState> = {
        focus,
        rung: "initiative",
        initiativeView: "detail",
        flow: null,
        flowStep: 0,
        overlay: "none",
        overlayId: null,
        floorModal: null,
      };
      navigate(patch);
    },
    [navigate],
  );

  // A single project has no full page anymore — it opens in the Record modal.
  const openProject = useCallback(
    (focus: Focus) => { if (focus.projectId) openRecord("project", focus.projectId); },
    [openRecord],
  );

  const setProjectView = useCallback(
    (v: ProjectView) => navigate({ projectView: v, floorModal: null }),
    [navigate],
  );

  const setInitiativeView = useCallback(
    (v: DetailView) => navigate({ initiativeView: v, floorModal: null }),
    [navigate],
  );

  const setSettingsSection = useCallback(
    (s: SettingsSection) => navigate({ settingsSection: s }, "replace"),
    [navigate],
  );

  const setNowMoment = useCallback(
    (m: AppNavState["nowMoment"], taskId: string | null = null) =>
      navigate({ nowMoment: m, nowTaskId: m === "choose" ? null : taskId }),
    [navigate],
  );

  const value: AppNavigationContextValue = {
    nav,
    navigate,
    back,
    canGoBack,
    panelAnchor,
    setPanelAnchor,
    setRung,
    goRung,
    setTab,
    setCalView,
    openFlow,
    closeFlow,
    setFlowStep,
    openOverlay,
    closeOverlay,
    openRecord,
    openFloorModal,
    closeFloorModal,
    toggleAgent,
    focusDomain,
    focusInitiative,
    openInitiative,
    openProject,
    setProjectView,
    setInitiativeView,
    setSettingsSection,
    setNowMoment,
  };

  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>;
}

export function useAppNavigation(): AppNavigationContextValue {
  const ctx = useContext(AppNavigationContext);
  if (!ctx) throw new Error("useAppNavigation must be used within AppNavigationProvider");
  return ctx;
}
