// The floor shell: the altitude router plus a context-aware top bar. The
// Project and Initiative rungs mirror each other — both open on On Deck (the
// demand timeline), with Table (the outline, D-220) and Shipped as sibling
// views, and drill into a single record's detail.

import { memo, useEffect } from "react";
import type { Focus, Rung } from "./AppShell";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { skipWhenAsleep } from "./KeepAlive";
import { AltitudeIcon } from "./icons";
import { PageBar, Tabs, usePageTabKeys, withPageTabKeys } from "./kit";
import DomainFloor from "./floors/DomainFloor";
import InitiativeOnDeckFloor from "./floors/InitiativeOnDeckFloor";
import OnDeckFloor from "./floors/OnDeckFloor";
import OutlineFloor from "./floors/OutlineFloor";
import ShippedWall from "./floors/ShippedWall";

const RUNG_LABEL: Record<Rung, string> = { day: "Schedule", project: "Projects", initiative: "Initiatives", domain: "Domains" };
// The three faces of a build altitude (D-099, D-220). ⌥⌘1–3 everywhere (the
// page's views, one chord below the sidebar's ⌘1–4); plain 1–3 too, on these
// rungs, while no list holds the keys.
const FACES = withPageTabKeys([
  { value: "ondeck", label: "On Deck" },
  { value: "all", label: "Table" },
  { value: "shipped", label: "Shipped" },
] as const);

// The faces of the project altitude: "ondeck" answers WHEN (time-box projects
// across weeks, with the needs-a-week inbox); "all" is the Table — the outline
// of every project and its tasks, where grooming happens now (D-220: Groom was
// folded into its Upcoming view); "shipped" is the retrospective wall of
// finished work. A single project opens in the Record modal.
export type ProjectView = "ondeck" | "all" | "shipped";
// The initiative rung mirrors the project one exactly — same faces, and a
// single initiative opens in the Record modal (no full page, like projects).
export type DetailView = "ondeck" | "all" | "shipped";

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
  const { openRecord } = useAppNavigation();

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

  // ⌥⌘1–4 — the same chord every page's views answer to (kit/pageTabKeys).
  usePageTabKeys(FACES, rung === "project" ? setProjectView : rung === "initiative" ? setInitiativeView : undefined, active);

  // Plain 1 · 2 · 3 switch the Build faces (On Deck · Table · Shipped)
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
      const map: Record<string, ProjectView & DetailView> = { "1": "ondeck", "2": "all", "3": "shipped" };
      const v = map[e.key];
      if (!v) return;
      e.preventDefault();
      if (rung === "project") setProjectView(v);
      else setInitiativeView(v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, rung, setProjectView, setInitiativeView]);

  const bar = (
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
    />
  );

  return (
    // Transparent: the floor overlay (AppShell) already paints .atmosphere, the
    // one continuous warm-paper canvas. Painting an opaque bg here covered it and
    // made each floor read as a flat panel instead of the same paper as Schedule.
    <div className="flex h-full flex-col">
      {/* The one bar (D-190), across the whole panel on EVERY face — planner or
          document — with the rail starting under it (D-208, amends D-207 §7).
          Its breadcrumb holds the rail's width, so the tabs stand at the same x
          on every page and never jump as a face gains or loses its rail. */}
      {bar}

      {/* The On Deck faces are PLANNER surfaces, not documents: rail + grid filling
          the pane, scrolling inside themselves, exactly like the Schedule. Every
          other face stays a padded, scrolling floor. */}
      <div
        key={`${rung}-${viewKey}`}
        className={`floor-enter min-h-0 flex-1 ${workspace ? "overflow-hidden" : "overflow-y-auto px-8 py-7"}`}
      >
        {rung === "project" && projectView === "ondeck" && <OnDeckFloor />}
        {rung === "project" && projectView === "all" && <OutlineFloor altitude="project" />}
        {rung === "project" && projectView === "shipped" && <ShippedWall rung="project" />}

        {rung === "initiative" && initiativeView === "ondeck" && <InitiativeOnDeckFloor />}
        {rung === "initiative" && initiativeView === "all" && <OutlineFloor altitude="initiative" />}
        {rung === "initiative" && initiativeView === "shipped" && <ShippedWall rung="initiative" />}

        {rung === "domain" && (
          <DomainFloor focus={focus} onSwitchDomain={focusDomain} onExitDomain={exitDomain} onOpenInitiative={openInitiativeRecord} onOpenProject={openProjectRecord} />
        )}
      </div>
    </div>
  );
}

export default memo(FloorPane, skipWhenAsleep);
