import { useCallback, useEffect, useState } from "react";
import {
  initiativeById,
  initiativesOf,
  projectById,
  projectsOf,
} from "../lib/vertical";
import { VerticalProvider, useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useIsMobile } from "../hooks/useIsMobile";
import { useEventRouter } from "../hooks/useEventRouter";
import MobileShell from "./mobile/MobileShell";
import FirstRun from "./FirstRun";
import Planner from "./Planner";
import Spine from "./Spine";
import FloorPane from "./FloorPane";
import RecordModal from "./record/RecordModal";
import ShortcutsModal from "./ShortcutsModal";
import AgentSidebar from "./AgentSidebar";
import Marquee from "./Marquee";
import { useAgentContext } from "../hooks/useAgentContext";
import SundayRitual from "./rituals/SundayRitual";
import SummitRitual from "./rituals/SummitRitual";
import CapacityRun from "./capacity/CapacityRun";
import QuickCreate from "./floors/QuickCreate";
import NewProject from "./floors/NewProject";
import NewInitiative from "./floors/NewInitiative";
import Orientation from "./orientation/Orientation";
import { OrientationProvider } from "../hooks/useOrientation";
import { TrialBanner } from "./billing/TrialBanner";
import StatusBar from "./terminal/StatusBar";
import { zoomIn, zoomOut, zoomReset } from "../hooks/useUiScale";

export type Rung = "day" | "project" | "initiative" | "domain";
export interface Focus {
  domainId: string;
  initiativeId: string;
  projectId: string;
}

// Top-to-bottom on the spine: ⌘1 = Schedule … ⌘4 = Domain. ⌘↓ widens, ⌘↑ narrows.
export const LADDER: Rung[] = ["day", "project", "initiative", "domain"];

// Focus mode — one gesture (⌘. / the toolbar's "Show panels" exit when collapsed)
// slides the spine + the inbox·today rail out of the way so the calendar goes
// full-bleed. Desktop-only chrome; persisted so the workspace opens the way you
// left it. Enter via ⌘. — the Focus pill was removed from the default toolbar.
const FOCUS_KEY = "nuvo-focus-mode";
function readFocusMode(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === "1";
  } catch {
    return false;
  }
}
function writeFocusMode(v: boolean) {
  try {
    localStorage.setItem(FOCUS_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export default function AppShell() {
  return (
    <VerticalProvider>
      <OrientationProvider>
        <ResponsiveShell />
      </OrientationProvider>
    </VerticalProvider>
  );
}

// On a phone the desktop spine / rail / calendar layout is unusable, so we swap
// in a single-column shell built for the thumb. Both share the same data layer
// (VerticalProvider + the task hooks) and navigation context.
function ResponsiveShell() {
  const isMobile = useIsMobile();
  const { data, ready } = useVertical();
  const [skippedFirstRun, setSkippedFirstRun] = useState(false);
  useEventRouter(); // quietly attribute events on unmapped calendars (Layer 3)

  // Signup seeds no domains (migration 42), so zero domains means a brand-new
  // account. One gate for both shells — the picker is single-column by design.
  // Skipping is session-only on purpose: nothing is persisted, and the funnel
  // genuinely can't do its job until the account has named what it carries.
  if (ready && data.domains.length === 0 && !skippedFirstRun) {
    return <FirstRun onSkip={() => setSkippedFirstRun(true)} />;
  }

  return isMobile ? <MobileShell /> : <AppShellInner />;
}

function AppShellInner() {
  const { data, ready } = useVertical();
  const {
    nav,
    goRung,
    openFlow,
    closeFlow,
    focusDomain: navFocusDomain,
    openInitiative,
    openProject,
    openRecord,
    openOverlay,
    closeOverlay,
    setSettingsSection,
    setProjectView,
    setInitiativeView,
    navigate,
    toggleAgent,
    openFloorModal,
    closeFloorModal,
    back,
    canGoBack,
  } = useAppNavigation();

  const { rung, projectView, initiativeView, focus, flow, flowStep, agentOpen } = nav;
  const { agent, setNavFocus } = useAgentContext();

  useEffect(() => {
    setNavFocus({
      rung,
      domainId: focus.domainId || undefined,
      initiativeId: focus.initiativeId || undefined,
      projectId: focus.projectId || undefined,
    });
  }, [rung, focus.domainId, focus.initiativeId, focus.projectId, setNavFocus]);

  // Auto-collapse the agent sidebar on narrow viewports so the calendar isn't crushed.
  // Spine (188) + LeftRail (360) + AgentSidebar (380) + Calendar min (280) = 1208px.
  const [narrowViewport, setNarrowViewport] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 1280
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1279px)");
    const onChange = () => setNarrowViewport(mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  const effectiveAgentOpen = agentOpen && !narrowViewport;

  // Focus mode: collapse the spine + the inbox·today rail to give the calendar
  // the whole workspace. Lives here (the common ancestor of Spine and Planner)
  // rather than in nav history — the back button shouldn't toggle chrome.
  const [focusMode, setFocusMode] = useState(readFocusMode);
  const toggleFocus = useCallback(() => {
    setFocusMode((v) => {
      const next = !v;
      writeFocusMode(next);
      return next;
    });
  }, []);

  // the fast composer is the default create surface, summonable from anywhere;
  // "more options" swaps in the full moment, carrying what's already typed.
  const [createFull, setCreateFull] = useState<{ domainId: string; initiativeId: string | null; name: string } | null>(null);
  const closeCreate = () => { setCreateFull(null); closeFloorModal(); };

  const focusDomain = (id: string) => {
    const init = initiativesOf(data, id)[0];
    const proj = init ? projectsOf(data, init.id)[0] : null;
    navFocusDomain({
      domainId: id,
      initiativeId: init?.id ?? "",
      projectId: proj?.id ?? "",
    });
  };

  const openInitiativeDetail = (id: string) => {
    const init = initiativeById(data, id);
    const proj = projectsOf(data, id)[0];
    openInitiative({
      domainId: init?.domainId ?? focus.domainId,
      initiativeId: id,
      projectId: proj?.id ?? "",
    });
  };

  const openProjectDetail = (id: string) => {
    const proj = projectById(data, id);
    openProject({
      domainId: proj?.domainId ?? focus.domainId,
      initiativeId: proj?.initiativeId ?? focus.initiativeId,
      projectId: id,
    });
  };

  // Live data arrives async: seed the focus branch once domains land.
  useEffect(() => {
    if (!ready || focus.domainId) return;
    const dom = [...data.domains].sort((a, b) => a.sort - b.sort)[0];
    if (!dom) return;
    const init = initiativesOf(data, dom.id)[0];
    const proj = init ? projectsOf(data, init.id)[0] : null;
    navigate({
      focus: { domainId: dom.id, initiativeId: init?.id ?? "", projectId: proj?.id ?? "" },
    }, "none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data.domains.length]);

  // ⌘1–4 jump to a rung; ⌘↑ / ⌘↓ travel the ladder; ⌘[ goes back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (!(e.metaKey || e.ctrlKey)) return;

      // ⌘[ — back navigation (standard macOS convention)
      if (e.key === "[") {
        e.preventDefault();
        if (canGoBack()) back();
        else closeOverlay();
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const i = LADDER.indexOf(rung);
        const next = e.key === "ArrowDown" ? Math.min(LADDER.length - 1, i + 1) : Math.max(0, i - 1);
        goRung(LADDER[next]);
        return;
      }

      const num = Number(e.key);
      if (num >= 1 && num <= LADDER.length) {
        e.preventDefault();
        goRung(LADDER[num - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goRung, rung, back, canGoBack, closeOverlay]);

  // ⌘J toggles Nuvo from any floor — not just the schedule view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "j") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      e.preventDefault();
      toggleAgent();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleAgent]);

  // ⌘. slides the side panels away (and back) — focus the calendar from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== ".") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      e.preventDefault();
      toggleFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocus]);

  // ⌘= / ⌘+ zoom in, ⌘− zooms out, ⌘0 resets — whole-UI zoom, works from any
  // focus (including inputs), matching the OS/browser zoom convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        zoomReset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // P / I summon the fast composer from anywhere (no modifier, so ⌘P print is
  // untouched). Stay out of the way while typing or when another surface owns
  // the screen — an overlay, a flow, or a composer already open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (nav.overlay !== "none" || nav.flow || nav.floorModal) return;
      // "?" opens the shortcuts reference from anywhere.
      if (e.key === "?") {
        e.preventDefault();
        openOverlay("shortcuts");
        return;
      }
      const key = e.key.toLowerCase();
      if (key !== "p" && key !== "i") return;
      e.preventDefault();
      setCreateFull(null);
      openFloorModal(key === "p" ? "new-project" : "new-initiative");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav.overlay, nav.flow, nav.floorModal, openFloorModal, openOverlay]);

  return (
    <div className="atmosphere flex h-full flex-col">
      <TrialBanner />
      <div className="flex min-h-0 flex-1">
      <Spine
        collapsed={focusMode}
        rung={rung}
        setRung={goRung}
        openSettings={() => openOverlay("settings")}
        openShortcuts={() => openOverlay("shortcuts")}
      />

      <div className="flex min-w-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <Planner openFlow={openFlow} focusMode={focusMode} onToggleFocus={toggleFocus} />
          {rung !== "day" && (
            // Sits ABOVE the Schedule beneath it: the LeftRail is z-40, so the
            // floor overlay must clear that (z-30 let the rail paint through).
            // The atmosphere backdrop is also opaque from frame 1 so the Schedule
            // never "peers through" during the floor-enter fade — only the inner
            // content rises/fades over the opaque canvas.
            <div className="atmosphere absolute inset-0 z-[41]">
              <div className="floor-enter h-full">
                <FloorPane
                  rung={rung}
                  focus={focus}
                  focusDomain={focusDomain}
                  goRung={goRung}
                  projectView={projectView}
                  setProjectView={setProjectView}
                  initiativeView={initiativeView}
                  setInitiativeView={setInitiativeView}
                />
              </div>
            </div>
          )}

        </div>

        <AgentSidebar agent={agent} open={effectiveAgentOpen} onToggle={toggleAgent} />
      </div>
      </div>

      {/* The terminal skin's status bar — renders null on every other material. */}
      <StatusBar />

      {/* the plan's step rides nav history, so browser/mouse back-forward walks
          the sources instead of dropping out of the flow */}
      {flow === "sunday" && (
        <SundayRitual step={flowStep} setStep={(s) => navigate({ flowStep: s })} onClose={closeFlow} />
      )}
      {flow === "summit" && (
        <SummitRitual
          step={flowStep}
          setStep={(s) => navigate({ flowStep: s })}
          onClose={closeFlow}
          onNewBet={() => openFloorModal("new-initiative")}
        />
      )}
      {flow === "capacity" && <CapacityRun onClose={closeFlow} />}

      {/* The fast composer — summoned by P / I or any "+ new" button, mounted
          globally so it works from any rung. "more options" swaps in the full
          moment for the chunks of work that earn the ceremony. */}
      {nav.floorModal === "new-project" && (
        createFull ? (
          <NewProject
            initialDomainId={createFull.domainId}
            initialInitiativeId={createFull.initiativeId}
            initialName={createFull.name}
            onClose={closeCreate}
            onCreated={(id) => { setCreateFull(null); openProjectDetail(id); }}
          />
        ) : (
          <QuickCreate
            kind="project"
            initialDomainId={focus.domainId || null}
            onClose={closeCreate}
            onCreated={(id) => { setCreateFull(null); openProjectDetail(id); }}
            onExpand={setCreateFull}
          />
        )
      )}
      {nav.floorModal === "new-initiative" && (
        createFull ? (
          <NewInitiative
            initialDomainId={createFull.domainId}
            initialName={createFull.name}
            onClose={closeCreate}
            onCreated={(id) => { setCreateFull(null); openInitiativeDetail(id); }}
          />
        ) : (
          <QuickCreate
            kind="initiative"
            initialDomainId={focus.domainId || null}
            onClose={closeCreate}
            onCreated={(id) => { setCreateFull(null); openInitiativeDetail(id); }}
            onExpand={({ domainId, name }) => setCreateFull({ domainId, initiativeId: null, name })}
          />
        )
      )}

      {/* The Record command center — a project / initiative opened as a modal. */}
      {(nav.overlay === "project-record" || nav.overlay === "initiative-record") && nav.overlayId && (
        <RecordModal
          kind={nav.overlay === "project-record" ? "project" : "initiative"}
          id={nav.overlayId}
          onClose={closeOverlay}
          onOpenProject={(pid) => openRecord("project", pid)}
          onOpenInitiative={(iid) => openRecord("initiative", iid)}
        />
      )}

      {nav.overlay === "shortcuts" && <ShortcutsModal onClose={closeOverlay} />}

      {/* Marquee — lets Nuvo drive this canvas (navigate + spotlight) in step
          with its reply. Desktop only; the orb portals above everything. */}
      <Marquee messages={agent.messages} />

      {/* First-run welcome — portals above everything; the Calendars CTA drops
          the user into Settings › Connections. */}
      <Orientation
        onAction={(action) => {
          if (action === "connect-calendars") {
            setSettingsSection("connections");
            openOverlay("settings");
          }
        }}
      />
    </div>
  );
}
