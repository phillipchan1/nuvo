import { useEffect, useState } from "react";
import {
  initiativeById,
  initiativesOf,
  projectById,
  projectsOf,
} from "../lib/vertical";
import { VerticalProvider, useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useIsMobile } from "../hooks/useIsMobile";
import MobileShell from "./mobile/MobileShell";
import { parseDateISO, planningWeekStartISO, todayISO } from "../lib/dates";
import Planner from "./Planner";
import Spine, { type FlowName } from "./Spine";
import FloorPane from "./FloorPane";
import RecordModal from "./record/RecordModal";
import AgentSidebar from "./AgentSidebar";
import { useAgentContext } from "../hooks/useAgentContext";
import SundayRitual from "./rituals/SundayRitual";
import SummitRitual from "./rituals/SummitRitual";
import BlueprintFlow, { type BlueprintSeed } from "./rituals/BlueprintFlow";
import QuickCreate from "./floors/QuickCreate";
import NewProject from "./floors/NewProject";
import NewInitiative from "./floors/NewInitiative";

export type Rung = "now" | "day" | "project" | "initiative" | "domain";
export interface Focus {
  domainId: string;
  initiativeId: string;
  projectId: string;
}

// Top-to-bottom on the spine: ⌘1 = Now … ⌘5 = Domain. ⌘↓ widens, ⌘↑ narrows.
export const LADDER: Rung[] = ["now", "day", "project", "initiative", "domain"];

export default function AppShell() {
  return (
    <VerticalProvider>
      <ResponsiveShell />
    </VerticalProvider>
  );
}

// On a phone the desktop spine / rail / calendar layout is unusable, so we swap
// in a single-column shell built for the thumb. Both share the same data layer
// (VerticalProvider + the task hooks) and navigation context.
function ResponsiveShell() {
  const isMobile = useIsMobile();
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
    closeOverlay,
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
  const { agent } = useAgentContext();

  // a half-typed bet handed from the quick-create moment into Blueprint
  const [blueprintSeed, setBlueprintSeed] = useState<BlueprintSeed | null>(null);
  const [sundayNudge, setSundayNudge] = useState(false);
  // the fast composer is the default create surface, summonable from anywhere;
  // "more options" swaps in the full moment, carrying what's already typed.
  const [createFull, setCreateFull] = useState<{ domainId: string; initiativeId: string | null; name: string } | null>(null);
  const closeCreate = () => { setCreateFull(null); closeFloorModal(); };

  const openBlueprint = (seed: BlueprintSeed) => {
    setBlueprintSeed(seed);
    openFlow("blueprint");
  };

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

  // Sunday nudge: around the turn of the week, if this week's sprint hasn't
  // been reviewed, offer the ritual once (dismissable per week).
  useEffect(() => {
    if (!ready) return;
    const dow = parseDateISO(todayISO()).getDay();
    const key = `nuvo-sunday-${planningWeekStartISO()}`;
    if ((dow === 0 || dow === 1) && !data.sprint?.reviewed_at && !localStorage.getItem(key)) {
      setSundayNudge(true);
    }
  }, [ready, data.sprint?.reviewed_at]);

  const dismissSundayNudge = () => {
    localStorage.setItem(`nuvo-sunday-${planningWeekStartISO()}`, "1");
    setSundayNudge(false);
  };

  // ⌘1–5 jump to a rung; ⌘↑ / ⌘↓ travel the ladder; ⌘[ goes back.
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

  const openFlowWithSeed = (f: FlowName) => {
    if (f === "blueprint") setBlueprintSeed(null);
    openFlow(f);
  };

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

  // P / I summon the fast composer from anywhere (no modifier, so ⌘P print is
  // untouched). Stay out of the way while typing or when another surface owns
  // the screen — an overlay, a flow, or a composer already open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key !== "p" && key !== "i") return;
      if (nav.overlay !== "none" || nav.flow || nav.floorModal) return;
      e.preventDefault();
      setCreateFull(null);
      openFloorModal(key === "p" ? "new-project" : "new-initiative");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav.overlay, nav.flow, nav.floorModal, openFloorModal]);

  return (
    <div className="atmosphere flex h-full">
      <Spine rung={rung} setRung={goRung} openFlow={openFlowWithSeed} />
      <div className="flex min-w-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <Planner openFlow={openFlowWithSeed} />
          {rung !== "day" && (
            <div className="atmosphere floor-enter absolute inset-0 z-30">
              <FloorPane
                rung={rung}
                focus={focus}
                focusDomain={focusDomain}
                openInitiative={openInitiativeDetail}
                goRung={goRung}
                projectView={projectView}
                setProjectView={setProjectView}
                initiativeView={initiativeView}
                setInitiativeView={setInitiativeView}
              />
            </div>
          )}

          {sundayNudge && !flow && (
          <div className="absolute bottom-6 left-1/2 z-40 -translate-x-1/2">
            <div className="rise elev-3 flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2">
              <span className="text-caption">A new week is here — plan it?</span>
              <button
                onClick={() => { openFlow("sunday"); setSundayNudge(false); }}
                className="fast rounded-full bg-accent px-3 py-1 text-label font-medium text-white shadow-sm hover:brightness-110 hover:shadow-[0_6px_16px_-6px_var(--accent-glow)] active:translate-y-px"
              >
                Plan the week ▸
              </button>
              <button onClick={dismissSundayNudge} className="fast text-label text-muted hover:text-ink">
                not now
              </button>
            </div>
          </div>
        )}
        </div>

        <AgentSidebar agent={agent} open={agentOpen} onToggle={toggleAgent} />
      </div>

      {flow === "sunday" && <SundayRitual onClose={closeFlow} />}
      {flow === "summit" && (
        <SummitRitual
          step={flowStep}
          setStep={(s) => navigate({ flowStep: s })}
          onClose={closeFlow}
          onOpenBlueprint={() => openFlowWithSeed("blueprint")}
        />
      )}
      {flow === "blueprint" && (
        <BlueprintFlow
          seed={blueprintSeed ?? undefined}
          onClose={() => { closeFlow(); setBlueprintSeed(null); }}
          onCreated={(id) => { setBlueprintSeed(null); openInitiativeDetail(id); }}
        />
      )}

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
            onBlueprint={openBlueprint}
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
          onExpand={() =>
            nav.overlay === "project-record"
              ? openProjectDetail(nav.overlayId!)
              : openInitiativeDetail(nav.overlayId!)
          }
          onOpenProject={(pid) => openRecord("project", pid)}
          onOpenInitiative={(iid) => openRecord("initiative", iid)}
        />
      )}
    </div>
  );
}
