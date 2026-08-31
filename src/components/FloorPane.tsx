// The floor shell: the altitude router plus a context-aware top bar. The
// Project and Initiative rungs mirror each other — both open on On Deck (the
// demand timeline), with Groom and Table as sibling views, and drill into a
// single record's detail.

import { useEffect } from "react";
import type { Focus, Rung } from "./AppShell";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { Keycap } from "./ui";
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

// The faces of the project altitude: "ondeck" answers WHEN (time-box projects
// across weeks, with the needs-a-week inbox); "groom" answers WHAT (shape each
// project's outcome + steps on the wall); "all" is the filing-cabinet Collection
// (table); "shipped" is the retrospective wall of finished work. A single project
// opens in the Record modal.
export type ProjectView = "ondeck" | "groom" | "all" | "shipped";
// The initiative rung mirrors the project one exactly — same four faces, and a
// single initiative opens in the Record modal (no full page, like projects).
export type DetailView = "ondeck" | "groom" | "all" | "shipped";

export default function FloorPane({
  rung,
  focus,
  focusDomain,
  goRung,
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
      <div
        data-tauri-drag-region="deep"
        className="app-topbar flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-5"
      >
        {rung === "domain" && <span className="mono text-label font-medium text-ink">Domains</span>}
        <div className="flex-1" />
        {rung === "project" && (
          <RungTabs
            tabs={[
              { id: "ondeck", label: "On Deck", on: backToProjects },
              { id: "groom", label: "Groom", on: () => setProjectView("groom") },
              { id: "all", label: "Table", on: () => setProjectView("all") },
              { id: "shipped", label: "Shipped", on: () => setProjectView("shipped") },
            ]}
            active={projectView}
            detailName={null}
          />
        )}
        {rung === "initiative" && (
          <RungTabs
            tabs={[
              { id: "ondeck", label: "On Deck", on: backToInitiatives },
              { id: "groom", label: "Groom", on: () => setInitiativeView("groom") },
              { id: "all", label: "Table", on: () => setInitiativeView("all") },
              { id: "shipped", label: "Shipped", on: () => setInitiativeView("shipped") },
            ]}
            active={initiativeView}
            detailName={null}
          />
        )}
        <button
          onClick={toggleAgent}
          className={`fast flex items-center gap-1 rounded-md px-2 py-1 text-label ${agentOpen ? "text-accent" : "text-muted hover:text-ink"}`}
          title="Nuvo agent"
        >
          <Keycap>⌘J</Keycap>
        </button>
        <button onClick={() => goRung("day")} className="mono text-label text-muted hover:text-ink">Schedule ↓</button>
      </div>

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

// The face switcher — "which shape of this altitude am I looking at". It wears the
// Schedule's view-switcher idiom verbatim (CalendarPane's Spread · Day · Week ·
// Month pill: rounded-full, --surface-2 trough, the active face lifted onto
// --surface in the accent) and sits in the same place, the toolbar's right
// cluster. One control, one precedent — the number keys stay in the tooltip
// rather than printed in the pill, exactly like the calendar's.
function RungTabs({
  tabs,
  active,
  detailName,
}: {
  tabs: { id: string; label: string; on: () => void }[];
  active: string;
  detailName: string | null;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <span data-tabs="floor" className="inline-flex shrink-0 items-center gap-0 rounded-full border border-line bg-surface-2 p-0.5">
        {tabs.map((t, i) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              onClick={t.on}
              data-on={on}
              className="fast rounded-full px-2 py-0.5 text-label leading-none"
              style={{
                background: on ? "var(--surface)" : "transparent",
                color: on ? "var(--accent)" : "var(--muted)",
                fontWeight: on ? 600 : 500,
                boxShadow: on ? "var(--shadow-1)" : "none",
              }}
              title={`${t.label}  ·  ${i + 1}`}
            >
              {t.label}
            </button>
          );
        })}
      </span>
      {detailName && (
        <>
          <span className="text-muted">›</span>
          <span className="mono max-w-[220px] truncate text-label font-medium" style={{ color: "var(--accent)" }}>
            {detailName}
          </span>
        </>
      )}
    </span>
  );
}
