// The floor shell: the altitude router plus a context-aware top bar. The
// Project and Initiative rungs are both "portfolio-first" — they open on a
// high-level collection (Table/Board/Calendar/Timeline) and drill into a single
// record's detail. Projects additionally carry the weekly Sprint funnel.

import { useVertical } from "../hooks/useVertical";
import { domainById, initiativeById, projectById } from "../lib/vertical";
import type { Focus, Rung } from "./AppShell";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { Keycap } from "./ui";
import DomainFloor from "./floors/DomainFloor";
import InitiativeFloor from "./floors/InitiativeFloor";
import InitiativesFloor from "./floors/InitiativesFloor";
import ProjectFloor from "./floors/ProjectFloor";
import PortfolioFloor from "./floors/PortfolioFloor";
import SprintFloor from "./floors/SprintFloor";
import NowFloor from "./floors/NowFloor";

export type ProjectView = "portfolio" | "sprint" | "detail";
export type DetailView = "portfolio" | "detail";

export default function FloorPane({
  rung,
  focus,
  focusDomain,
  openInitiative,
  goRung,
  projectView,
  setProjectView,
  initiativeView,
  setInitiativeView,
}: {
  rung: Rung;
  focus: Focus;
  focusDomain: (id: string) => void;
  openInitiative: (id: string) => void;
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
  // beautiful, fully-editable command center). The full-page floor stays one
  // "Open full page ↗" away from inside the modal.
  const openProjectRecord = (id: string) => openRecord("project", id);
  const openInitiativeRecord = (id: string) => openRecord("initiative", id);

  // Direct navigation back to the portfolio list — does not rely on history.back()
  // so it works regardless of how the user arrived at the detail view (e.g. via
  // "full page ↗" from a Record modal, which would otherwise pop back to the modal).
  const backToProjects = () => setProjectView("portfolio");
  const backToInitiatives = () => setInitiativeView("portfolio");

  // Show a back arrow in the top bar when a detail is open AND there's no
  // natural breadcrumb (i.e. the user can't see which list to click back to).
  const showBackBtn = (rung === "project" && projectView === "detail") ||
                      (rung === "initiative" && initiativeView === "detail");
  const onBackBtn = rung === "project" ? backToProjects : backToInitiatives;

  const viewKey = rung === "project" ? projectView : rung === "initiative" ? initiativeView : "";

  return (
    // Transparent: the floor overlay (AppShell) already paints .atmosphere, the
    // one continuous warm-paper canvas. Painting an opaque bg here covered it and
    // made each floor read as a flat panel instead of the same paper as Schedule.
    <div className="flex h-full flex-col">
      <div
        data-tauri-drag-region
        className="app-topbar flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-5"
      >
        {/* Back arrow — always reachable, replaces the need to find the breadcrumb */}
        {showBackBtn && (
          <button
            onClick={onBackBtn}
            title="Back (⌘[)"
            className="fast mono mr-1 flex items-center gap-0.5 text-body text-muted hover:text-ink"
          >
            ‹
          </button>
        )}

        {rung === "now" && <span className="mono text-label font-medium text-ink">Today</span>}
        {rung === "domain" && <span className="mono text-label font-medium text-ink">Domains</span>}
        {rung === "project" && (
          <RungTabs
            tabs={[
              { id: "portfolio", label: "Portfolio", on: backToProjects },
              { id: "sprint", label: "This Week", on: () => setProjectView("sprint") },
            ]}
            active={projectView}
            detailName={projectView === "detail" ? projectById(data, focus.projectId)?.name ?? "Project" : null}
            accent={accent}
          />
        )}
        {rung === "initiative" && (
          <RungTabs
            tabs={[{ id: "portfolio", label: "Initiatives", on: backToInitiatives }]}
            active={initiativeView}
            detailName={initiativeView === "detail" ? initiativeById(data, focus.initiativeId)?.name ?? "Initiative" : null}
            accent={accent}
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

        {rung === "project" && projectView === "portfolio" && <PortfolioFloor onOpen={openProjectRecord} />}
        {rung === "project" && projectView === "sprint" && <SprintFloor />}
        {rung === "project" && projectView === "detail" && (
          <ProjectFloor
            focus={focus}
            accent={accent}
            onUp={() => focus.initiativeId && openInitiative(focus.initiativeId)}
            onBack={backToProjects}
          />
        )}

        {rung === "initiative" && initiativeView === "portfolio" && (
          <InitiativesFloor onOpen={openInitiativeRecord} />
        )}
        {rung === "initiative" && initiativeView === "detail" && (
          <InitiativeFloor
            focus={focus}
            onUp={() => goRung("domain")}
            onBack={backToInitiatives}
            onOpenProject={openProjectRecord}
          />
        )}

        {rung === "domain" && (
          <DomainFloor focus={focus} onSwitchDomain={focusDomain} onOpenInitiative={openInitiativeRecord} onOpenProject={openProjectRecord} />
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
}: {
  tabs: { id: string; label: string; on: () => void }[];
  active: string;
  detailName: string | null;
  accent: string;
}) {
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
