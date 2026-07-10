// The floor shell: the altitude router plus a context-aware top bar. The
// Project and Initiative rungs mirror each other — both open on On Deck (the
// demand timeline), with Groom and Table as sibling views, and drill into a
// single record's detail.

import { useEffect } from "react";
import { useVertical } from "../hooks/useVertical";
import { domainById } from "../lib/vertical";
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
import NowFloor from "./floors/NowFloor";

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
}: {
  rung: Rung;
  focus: Focus;
  focusDomain: (id: string) => void;
  goRung: (r: Rung) => void;
  projectView: ProjectView;
  setProjectView: (v: ProjectView) => void;
  initiativeView: DetailView;
  setInitiativeView: (v: DetailView) => void;
}) {
  const { data } = useVertical();
  const { openRecord, toggleAgent, nav } = useAppNavigation();
  const { agentOpen } = nav;
  const domain = domainById(data, focus.domainId);
  const accent = domain?.color ?? "var(--accent)";

  // Clicking a project / initiative anywhere opens its Record modal (the
  // beautiful, fully-editable command center). Neither rung has a full page — the
  // modal IS the single-record surface for both, so they stay symmetric.
  const openProjectRecord = (id: string) => openRecord("project", id);
  const openInitiativeRecord = (id: string) => openRecord("initiative", id);

  // "‹ all domains" always means the wall, full stop — it can't lean on
  // history.back(): focus.domainId persists across rung switches, so landing
  // on the domain rung (e.g. via the sidebar tab) with a domain already
  // focused never pushed a fresh "wall" entry to pop back to. back() would
  // instead exit the rung entirely, to whatever was open before Domains.
  const exitDomain = () => focusDomain("");

  // Direct navigation back to each rung's front door (On Deck).
  const backToProjects = () => setProjectView("ondeck");
  const backToInitiatives = () => setInitiativeView("ondeck");

  const viewKey = rung === "project" ? projectView : rung === "initiative" ? initiativeView : "";

  // Plain 1 · 2 · 3 · 4 switch the Build faces (On Deck · Groom · Table · Shipped)
  // — like the Schedule view's number keys. Scoped to the project & initiative
  // rungs, and never while typing (composer / brief / step edits). ⌘1–5 stays the
  // global rung nav. Both rungs share the same face order, so one map drives both.
  useEffect(() => {
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
  }, [rung, setProjectView, setInitiativeView]);

  return (
    // Transparent: the floor overlay (AppShell) already paints .atmosphere, the
    // one continuous warm-paper canvas. Painting an opaque bg here covered it and
    // made each floor read as a flat panel instead of the same paper as Schedule.
    <div className="flex h-full flex-col">
      <div
        data-tauri-drag-region
        className="app-topbar flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-5"
      >

        {rung === "now" && <span className="mono text-label font-medium text-ink">Today</span>}
        {rung === "domain" && <span className="mono text-label font-medium text-ink">Domains</span>}
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
            accent={accent}
            big
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
            accent={accent}
            big
          />
        )}
        <div className="flex-1" />
        <button
          onClick={toggleAgent}
          className={`fast flex items-center gap-1 rounded-md px-2 py-1 text-label ${agentOpen ? "text-accent" : "text-muted hover:text-ink"}`}
          title="Nuvo agent"
        >
          <Keycap>⌘J</Keycap>
        </button>
        <button onClick={() => goRung("day")} className="mono text-label text-muted hover:text-ink">Schedule ↓</button>
      </div>

      <div key={`${rung}-${viewKey}`} className="floor-enter min-h-0 flex-1 overflow-y-auto px-8 py-7">
        {rung === "now" && <NowFloor onOpenDay={() => goRung("day")} />}

        {rung === "project" && projectView !== "shipped" && (
          <ProjectReadinessStrip onGroom={projectView === "groom" ? undefined : () => setProjectView("groom")} />
        )}
        {rung === "project" && projectView === "ondeck" && <OnDeckFloor />}
        {rung === "project" && projectView === "groom" && <GroomFloor />}
        {rung === "project" && projectView === "all" && <PortfolioFloor onOpen={openProjectRecord} />}
        {rung === "project" && projectView === "shipped" && <ShippedWall rung="project" />}

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

function RungTabs({
  tabs,
  active,
  detailName,
  accent,
  big = false,
}: {
  tabs: { id: string; label: string; on: () => void }[];
  active: string;
  detailName: string | null;
  accent: string;
  /** the project rung's primary destinations — larger, segmented, higher-contrast. */
  big?: boolean;
}) {
  if (big) {
    return (
      <span className="flex items-center gap-2.5">
        <span className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
          {tabs.map((t, i) => {
            const on = active === t.id;
            return (
              <button
                key={t.id}
                onClick={t.on}
                className="fast flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-body font-medium tracking-tight"
                style={
                  on
                    ? { background: "var(--surface)", color: accent, boxShadow: "0 1px 2px rgba(0,0,0,.07)" }
                    : { color: "var(--muted)" }
                }
                title={`${t.label}  ·  ${i + 1}`}
              >
                <span className="mono text-micro font-normal tabular-nums" style={{ opacity: on ? 0.55 : 0.4 }}>{i + 1}</span>
                {t.label}
              </button>
            );
          })}
        </span>
        {detailName && (
          <>
            <span className="text-muted">›</span>
            <span className="mono max-w-[220px] truncate text-label font-medium" style={{ color: accent }}>{detailName}</span>
          </>
        )}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-3">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={t.on}
          className="fast mono text-label hover:text-ink"
          style={{ color: active === t.id ? accent : "var(--muted)", fontWeight: active === t.id ? 600 : 400 }}
        >
          {t.label}
        </button>
      ))}
      {detailName && (
        <>
          <span className="text-muted">›</span>
          <span className="mono max-w-[220px] truncate text-label font-medium" style={{ color: accent }}>{detailName}</span>
        </>
      )}
    </span>
  );
}
