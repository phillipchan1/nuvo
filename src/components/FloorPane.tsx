// The floor shell: the altitude router plus a context-aware top bar. The
// Project and Initiative rungs are both "portfolio-first" — they open on a
// high-level collection (Table/Board/Calendar/Timeline) and drill into a single
// record's detail. Projects additionally carry the weekly Sprint funnel.

import { useVertical } from "../hooks/useVertical";
import { domainById, initiativeById, projectById } from "../lib/vertical";
import type { Focus, Rung } from "./AppShell";
import { useAppNavigation } from "../hooks/useAppNavigation";
import type { BlueprintSeed } from "./rituals/BlueprintFlow";
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
  openProject,
  goRung,
  projectView,
  setProjectView,
  initiativeView,
  setInitiativeView,
  openBlueprint,
}: {
  rung: Rung;
  focus: Focus;
  focusDomain: (id: string) => void;
  openInitiative: (id: string) => void;
  openProject: (id: string) => void;
  goRung: (r: Rung) => void;
  projectView: ProjectView;
  setProjectView: (v: ProjectView) => void;
  initiativeView: DetailView;
  setInitiativeView: (v: DetailView) => void;
  openBlueprint: (seed: BlueprintSeed) => void;
}) {
  const { data } = useVertical();
  const { back } = useAppNavigation();
  const domain = domainById(data, focus.domainId);
  const accent = domain?.color ?? "var(--accent)";

  const viewKey = rung === "project" ? projectView : rung === "initiative" ? initiativeView : "";

  return (
    <div className="flex h-full flex-col bg-bg">
      <div
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-5"
      >
        {rung === "now" && <span className="mono text-[11px] font-medium text-ink">Today</span>}
        {rung === "domain" && <span className="mono text-[11px] font-medium text-ink">Domains</span>}
        {rung === "project" && (
          <RungTabs
            tabs={[
              { id: "portfolio", label: "Portfolio", on: () => setProjectView("portfolio") },
              { id: "sprint", label: "This Week", on: () => setProjectView("sprint") },
            ]}
            active={projectView}
            detailName={projectView === "detail" ? projectById(data, focus.projectId)?.name ?? "Project" : null}
            accent={accent}
          />
        )}
        {rung === "initiative" && (
          <RungTabs
            tabs={[{ id: "portfolio", label: "Initiatives", on: () => setInitiativeView("portfolio") }]}
            active={initiativeView}
            detailName={initiativeView === "detail" ? initiativeById(data, focus.initiativeId)?.name ?? "Initiative" : null}
            accent={accent}
          />
        )}
        <div className="flex-1" />
        <button onClick={() => goRung("day")} className="mono text-[11px] text-muted hover:text-ink">day ↓</button>
      </div>

      <div key={`${rung}-${viewKey}`} className="floor-enter min-h-0 flex-1 overflow-y-auto px-8 py-7">
        {rung === "now" && <NowFloor onOpenDay={() => goRung("day")} />}

        {rung === "project" && projectView === "portfolio" && <PortfolioFloor onOpen={openProject} />}
        {rung === "project" && projectView === "sprint" && <SprintFloor />}
        {rung === "project" && projectView === "detail" && (
          <ProjectFloor
            focus={focus}
            accent={accent}
            onUp={() => focus.initiativeId && openInitiative(focus.initiativeId)}
            onBack={back}
          />
        )}

        {rung === "initiative" && initiativeView === "portfolio" && (
          <InitiativesFloor onOpen={openInitiative} openBlueprint={openBlueprint} />
        )}
        {rung === "initiative" && initiativeView === "detail" && (
          <InitiativeFloor
            focus={focus}
            onUp={() => goRung("domain")}
            onBack={back}
            onOpenProject={openProject}
          />
        )}

        {rung === "domain" && (
          <DomainFloor focus={focus} onSwitchDomain={focusDomain} onOpenInitiative={openInitiative} />
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
          className="fast mono text-[11px] hover:text-ink"
          style={{ color: active === t.id ? accent : "var(--muted)", fontWeight: active === t.id ? 600 : 400 }}
        >
          {t.label}
        </button>
      ))}
      {detailName && (
        <>
          <span className="text-muted">›</span>
          <span className="mono max-w-[220px] truncate text-[11px] font-medium" style={{ color: accent }}>{detailName}</span>
        </>
      )}
    </span>
  );
}
