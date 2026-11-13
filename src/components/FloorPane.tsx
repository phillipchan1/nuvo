// The floor shell: the altitude router plus a context-aware top bar. The
// Project and Initiative rungs mirror each other — both open on On Deck (the
// demand timeline), with Groom and Table as sibling views, and drill into a
// single record's detail.

import { memo, useEffect } from "react";
import type { Focus, Rung } from "./AppShell";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { skipWhenAsleep } from "./KeepAlive";
import { Icon } from "./Icon";
import { AltitudeIcon } from "./icons";
import { IconButton, PageBar, Tabs } from "./kit";
import DomainFloor from "./floors/DomainFloor";
import InitiativesFloor from "./floors/InitiativesFloor";
import InitiativeOnDeckFloor from "./floors/InitiativeOnDeckFloor";
import PortfolioFloor from "./floors/PortfolioFloor";
import OnDeckFloor from "./floors/OnDeckFloor";
import GroomFloor from "./floors/GroomFloor";
import InitiativeGroomFloor from "./floors/InitiativeGroomFloor";
import ShippedWall from "./floors/ShippedWall";
import ProjectReadinessStrip from "./floors/ProjectReadinessStrip";
import InitiativeReadinessStrip from "./floors/InitiativeReadinessStrip";

const RUNG_LABEL: Record<Rung, string> = { day: "Schedule", project: "Projects", initiative: "Initiatives", domain: "Domains" };
// The four faces of a build altitude (D-099), numbered 1–4 in their tooltips.
const FACES = [
  { value: "ondeck", label: "On Deck", title: "On Deck (1)" },
  { value: "groom", label: "Groom", title: "Groom (2)" },
  { value: "all", label: "Table", title: "Table (3)" },
  { value: "shipped", label: "Shipped", title: "Shipped (4)" },
] as const;

// The faces of the project altitude: "ondeck" answers WHEN (time-box projects
// across weeks, with the needs-a-week inbox); "groom" answers WHAT (shape each
// project's outcome + steps on the wall); "all" is the filing-cabinet Collection
// (table); "shipped" is the retrospective wall of finished work. A single project
// opens in the Record modal.
export type ProjectView = "ondeck" | "groom" | "all" | "shipped";
// The initiative rung mirrors the project one exactly — same four faces, and a
// single initiative opens in the Record modal (no full page, like projects).
export type DetailView = "ondeck" | "groom" | "all" | "shipped";

function FloorPane({
  rung,
  focus,
  focusDomain,
  projectView,
  setProjectView,
  initiativeView,
  setInitiativeView,
  active = true,
}: {
  rung: Rung;
  focus: Focus;
  focusDomain: (id: string) => void;
  goRung: (r: Rung) => void;
  projectView: ProjectView;
  setProjectView: (v: ProjectView) => void;
  initiativeView: DetailView;
  setInitiativeView: (v: DetailView) => void;
  /** False while Schedule covers this overlay — face-switcher keys stand down. */
  active?: boolean;
  /** False while Schedule covers this overlay — skip reconciling under KeepAlive. */
  live?: boolean;
}) {
  const { openRecord, toggleAgent, nav } = useAppNavigation();
  const { agentOpen } = nav;

  // Clicking a project / initiative anywhere opens its Record modal (the
  // beautiful, fully-editable command center). Neither rung has a full page — the
  // modal IS the single-record surface for both, so they stay symmetric.
  const openProjectRecord = (id: string) => openRecord("project", id);
  const openInitiativeRecord = (id: string) => openRecord("initiative", id);

  // "‹ all domains" always means the wall, full stop — it can't lean on
  // history.back(): an open domain can be entered from outside the rung (Marquee
  // point-at, ⌘K), where no "wall" entry was ever pushed to pop back to, so
  // back() would exit the rung entirely, to whatever was open before Domains.
  const exitDomain = () => focusDomain("");

  // Direct navigation back to each rung's front door (On Deck).
  const backToProjects = () => setProjectView("ondeck");
  const backToInitiatives = () => setInitiativeView("ondeck");

  const viewKey = rung === "project" ? projectView : rung === "initiative" ? initiativeView : "";
  // The planner faces (On Deck at either altitude) are full-height workspaces —
  // the pool rail + the time grid own their own scrolling, so the floor shell must
  // not wrap them in padding or a scroll container of its own.
  const workspace =
    (rung === "project" && projectView === "ondeck") ||
    (rung === "initiative" && initiativeView === "ondeck");

  // Plain 1 · 2 · 3 · 4 switch the Build faces (On Deck · Groom · Table · Shipped)
  // — like the Schedule view's number keys. Scoped to the project & initiative
  // rungs, and never while typing (composer / brief / step edits). ⌘1–5 stays the
  // global rung nav. Both rungs share the same face order, so one map drives both.
  useEffect(() => {
    if (!active) return;
    if (rung !== "project" && rung !== "initiative") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const map: Record<string, ProjectView & DetailView> = { "1": "ondeck", "2": "groom", "3": "all", "4": "shipped" };
      const v = map[e.key];
      if (!v) return;
      e.preventDefault();
      if (rung === "project") setProjectView(v);
      else setInitiativeView(v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, rung, setProjectView, setInitiativeView]);

  return (
    // Transparent: the floor overlay (AppShell) already paints .atmosphere, the
    // one continuous warm-paper canvas. Painting an opaque bg here covered it and
    // made each floor read as a flat panel instead of the same paper as Schedule.
    <div className="flex h-full flex-col">
      {/* The band's LEFT is deliberately empty — it's the window-drag zone, and the
          rail's crown below it already names what you're looking at (the Schedule
          works the same way: no chrome header, drag on the toolbar's empty spacer).
          The face switcher rides the RIGHT cluster in the calendar toolbar's own
          idiom, so "which shape of this altitude" reads identically everywhere. */}
      {/* The one bar (D-190): breadcrumb · the altitude's four faces as tabs ·
          the chat. The sidebar already carries the Schedule, so the bar doesn't. */}
      <PageBar
        icon={<AltitudeIcon kind={rung} size={16} />}
        trail={[RUNG_LABEL[rung]]}
        tabs={
          rung === "project" ? (
            <Tabs
              label="Project views"
              value={projectView}
              onChange={(v) => (v === "ondeck" ? backToProjects() : setProjectView(v))}
              tabs={FACES}
            />
          ) : rung === "initiative" ? (
            <Tabs
              label="Initiative views"
              value={initiativeView}
              onChange={(v) => (v === "ondeck" ? backToInitiatives() : setInitiativeView(v))}
              tabs={FACES}
            />
          ) : undefined
        }
        actions={
          <IconButton
            label="Ask Nuvo"
            shortcut={["⌘", "J"]}
            active={agentOpen}
            icon={<Icon name="sparkles" size={14} />}
            onClick={toggleAgent}
          />
        }
      />

      {/* The On Deck faces are PLANNER surfaces, not documents: rail + grid filling
          the pane, scrolling inside themselves, exactly like the Schedule. Every
          other face stays a padded, scrolling floor. */}
      <div
        key={`${rung}-${viewKey}`}
        className={`floor-enter min-h-0 flex-1 ${workspace ? "overflow-hidden" : "overflow-y-auto px-8 py-7"}`}
      >
        {/* Readiness has ONE home per surface. On a planner surface it's the rail's
            crown, so the strip would be a second scoreboard — it only rides the
            document faces (Groom · Table). */}
        {rung === "project" && projectView === "groom" && <ProjectReadinessStrip />}
        {rung === "project" && projectView === "ondeck" && <OnDeckFloor />}
        {rung === "project" && projectView === "groom" && <GroomFloor />}
        {rung === "project" && projectView === "all" && <PortfolioFloor onOpen={openProjectRecord} />}
        {rung === "project" && projectView === "shipped" && <ShippedWall rung="project" />}

        {rung === "initiative" && initiativeView === "groom" && <InitiativeReadinessStrip />}
        {rung === "initiative" && initiativeView === "ondeck" && <InitiativeOnDeckFloor />}
        {rung === "initiative" && initiativeView === "groom" && <InitiativeGroomFloor />}
        {rung === "initiative" && initiativeView === "all" && (
          <InitiativesFloor onOpen={openInitiativeRecord} />
        )}
        {rung === "initiative" && initiativeView === "shipped" && <ShippedWall rung="initiative" />}

        {rung === "domain" && (
          <DomainFloor focus={focus} onSwitchDomain={focusDomain} onExitDomain={exitDomain} onOpenInitiative={openInitiativeRecord} onOpenProject={openProjectRecord} />
        )}
      </div>
    </div>
  );
}

export default memo(FloorPane, skipWhenAsleep);
