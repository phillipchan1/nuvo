import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
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
  /** The live DOM element the current panel/popover is anchored to, when one
   *  exists — re-measured on scroll/resize so the popover follows its target
   *  instead of freezing at the DOMRect snapshot taken when it opened. */
  panelAnchorEl: HTMLElement | null;
  setRung: (r: Rung) => void;
  goRung: (r: Rung) => void;
  setTab: (t: RailTab) => void;
  setCalView: (v: CalView) => void;
  openFlow: (f: FlowName, focus?: FlowFocus) => void;
  closeFlow: () => void;
  setFlowStep: (step: number) => void;
  openOverlay: (
    kind: OverlayKind,
    id?: string | null,
    anchor?: DOMRect | null,
    anchorEl?: HTMLElement | null,
  ) => void;
  /** Open a task inside the current slot popover (overlay must be "slot"). */
  openSlotTask: (taskId: string) => void;
  closeOverlay: () => void;
  /** Open a project / initiative as the centered Record modal. */
  openRecord: (kind: "project" | "initiative", id: string) => void;
  openFloorModal: (modal: FloorModal) => void;
  closeFloorModal: () => void;
  toggleAgent: () => void;
  focusDomain: (focus: Focus) => void;
  openInitiative: (focus: Focus) => void;
  openProject: (focus: Focus) => void;
  setProjectView: (v: ProjectView) => void;
  setInitiativeView: (v: DetailView) => void;
  setSettingsSection: (s: SettingsSection) => void;
}

const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

export function AppNavigationProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<AppNavState[]>([DEFAULT_NAV]);
  const indexRef = useRef(0);
  const [nav, setNav] = useState<AppNavState>(DEFAULT_NAV);
  const navRef = useRef(nav);
  navRef.current = nav;

  const [panelAnchor, setPanelAnchor] = useState<DOMRect | null>(null);
  const [panelAnchorEl, setPanelAnchorEl] = useState<HTMLElement | null>(null);
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
    const prev = navRef.current;
    setNav(state);
    // Drop the anchor only when a *different* panel takes over. Going back
    // within one panel (closing the task slide-out inside a slot popover)
    // never unmounts it, so clearing the anchor here would strand the still-
    // open popover on `fallbackPanelAnchor()` — it visibly teleported off its
    // calendar block the moment you closed a task.
    if (state.overlay !== prev.overlay || state.overlayId !== prev.overlayId) {
      setPanelAnchor(null);
      setPanelAnchorEl(null);
    }
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
    if (overlay === "task" || overlay === "event" || overlay === "slot" || overlay === "week-plan") {
      patch.overlay = "none";
      patch.overlayId = null;
      patch.overlaySubId = null;
    }
  }, []);

  const setRung = useCallback(
    (r: Rung) => {
      const patch: Partial<AppNavState> = { rung: r, floorModal: null };
      if (r === "project") patch.projectView = "ondeck";
      if (r === "initiative") patch.initiativeView = "ondeck";
      // Every rung opens on its front door: On Deck for project/initiative, the
      // wall for domains. Opening a domain is a drill-in (the domain analogue of
      // opening a record), and no other rung reopens the last record you were in,
      // so a sticky focus.domainId must not survive the trip either. Pointing at
      // one domain from elsewhere (Marquee, ⌘K) navigates rung+focus together and
      // bypasses this on purpose.
      if (r === "domain") patch.focus = { domainId: "", initiativeId: "", projectId: "" };
      if (r !== "day") {
        clearCalendarOverlay(patch);
        setPanelAnchor(null);
        setPanelAnchorEl(null);
      }
      navigate(patch);
    },
    [clearCalendarOverlay, navigate],
  );

  const goRung = setRung;

  const setTab = useCallback((t: RailTab) => navigate({ tab: t }), [navigate]);

  const setCalView = useCallback((v: CalView) => navigate({ calView: v }), [navigate]);

  /** The stack index the current flow was opened from, so closing can return
   *  there no matter how its steps were navigated. */
  const flowOpenedAtRef = useRef<number | null>(null);

  const openFlow = useCallback(
    (f: FlowName, focus?: FlowFocus) =>
      {
        flowOpenedAtRef.current = indexRef.current;
        navigate({ flow: f, flowStep: 0, flowFocus: focus ?? null, overlay: "none", overlayId: null, floorModal: null });
      },
    [navigate],
  );

  /**
   * Close the flow and unwind whatever history it pushed.
   *
   * This used to assume `flowStep` counted the entries the flow had pushed —
   * true for a gated wizard you walk one step at a time, false the moment a flow
   * lets you *jump* between steps: clicking step 3 from step 1 is one push but
   * sets `flowStep` to 2, so closing tried to go back three entries, sailed past
   * the app, and left the flow open with no way out. Remember where the flow
   * actually started instead; the step index isn't a count of anything.
   */
  const closeFlow = useCallback(() => {
    const openedAt = flowOpenedAtRef.current;
    flowOpenedAtRef.current = null;
    if (navRef.current.flow && openedAt != null && openedAt < indexRef.current) {
      history.go(openedAt - indexRef.current);
      return;
    }
    navigate({ flow: null, flowStep: 0 }, "replace");
  }, [navigate]);

  const setFlowStep = useCallback(
    (step: number) => navigate({ flowStep: step }),
    [navigate],
  );

  const openOverlay = useCallback(
    (
      kind: OverlayKind,
      id: string | null = null,
      anchor: DOMRect | null = null,
      anchorEl: HTMLElement | null = null,
    ) => {
      setPanelAnchor(anchor);
      setPanelAnchorEl(anchorEl);
      const patch: Partial<AppNavState> = { overlay: kind, overlayId: id, floorModal: null };
      if (kind === "slot") patch.overlaySubId = null;
      navigate(patch);
    },
    [navigate],
  );

  const openSlotTask = useCallback(
    (taskId: string) =>
      // Opening the drill-in pushes (so back closes it); switching between
      // tasks while it's already open replaces, so back is always "close the
      // pane", not a walk back through every task you glanced at.
      navigate({ overlaySubId: taskId }, navRef.current.overlaySubId ? "replace" : "push"),
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
      // Replace when the create sheet is up: Create used to PUSH the record on
      // top of `new-project`, so Esc / ✕ / the scrim ran `history.back()` and
      // the create modal came straight back — ⌘⏎ looked like a no-op.
      navigate(
        {
          overlay: kind === "project" ? "project-record" : "initiative-record",
          overlayId: id,
          floorModal: null,
        },
        navRef.current.floorModal ? "replace" : "push",
      ),
    [navigate],
  );

  const closeOverlay = useCallback(() => {
    if (navRef.current.overlaySubId) {
      if (canGoBack()) back();
      else navigate({ overlaySubId: null }, "replace");
      return;
    }
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

  // A single bet / project has no full page anymore — both open in the Record
  // modal (the same command center), so the two rungs stay symmetric.
  const openInitiative = useCallback(
    (focus: Focus) => { if (focus.initiativeId) openRecord("initiative", focus.initiativeId); },
    [openRecord],
  );

  const openProject = useCallback(
    (focus: Focus) => { if (focus.projectId) openRecord("project", focus.projectId); },
    [openRecord],
  );

  const setProjectView = useCallback(
    (v: ProjectView) => {
      // Re-asserting the current face (On Deck tab while already there, TeachPanel
      // landing on Projects) must not dismiss the create sheet — that made the
      // empty-state CTA look like a no-op. Switching faces still closes it.
      const patch: Partial<AppNavState> = { projectView: v };
      if (navRef.current.projectView !== v) patch.floorModal = null;
      navigate(patch);
    },
    [navigate],
  );

  const setInitiativeView = useCallback(
    (v: DetailView) => {
      const patch: Partial<AppNavState> = { initiativeView: v };
      if (navRef.current.initiativeView !== v) patch.floorModal = null;
      navigate(patch);
    },
    [navigate],
  );

  const setSettingsSection = useCallback(
    (s: SettingsSection) => navigate({ settingsSection: s }, "replace"),
    [navigate],
  );

  // Memoized: this was a fresh object literal on every provider render, so all
  // 25 consumers re-rendered whenever anything above re-rendered the provider,
  // not only when navigation actually changed. Every member below is a
  // useCallback, so the identity now tracks real state.
  const value: AppNavigationContextValue = useMemo(
    () => ({
      nav,
      navigate,
      back,
      canGoBack,
      panelAnchor,
      setPanelAnchor,
      panelAnchorEl,
      setRung,
      goRung,
      setTab,
      setCalView,
      openFlow,
      closeFlow,
      setFlowStep,
      openOverlay,
      openSlotTask,
      closeOverlay,
      openRecord,
      openFloorModal,
      closeFloorModal,
      toggleAgent,
      focusDomain,
      openInitiative,
      openProject,
      setProjectView,
      setInitiativeView,
      setSettingsSection,
    }),
    [
      nav,
      navigate,
      back,
      canGoBack,
      panelAnchor,
      setPanelAnchor,
      panelAnchorEl,
      setRung,
      goRung,
      setTab,
      setCalView,
      openFlow,
      closeFlow,
      setFlowStep,
      openOverlay,
      openSlotTask,
      closeOverlay,
      openRecord,
      openFloorModal,
      closeFloorModal,
      toggleAgent,
      focusDomain,
      openInitiative,
      openProject,
      setProjectView,
      setInitiativeView,
      setSettingsSection,
    ],
  );

  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>;
}

export function useAppNavigation(): AppNavigationContextValue {
  const ctx = useContext(AppNavigationContext);
  if (!ctx) throw new Error("useAppNavigation must be used within AppNavigationProvider");
  return ctx;
}
