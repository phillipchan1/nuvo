// Initiatives — high level first, the same Notion-style collection as projects:
// every initiative across every domain in Table · Board · Calendar · Timeline.
// Click one to drill into its detail (goal, key results, project timeline).

import { useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";

import {
  domainById,
  initiativeProgress,
  isProjectComplete,
  isProjectInFlight,
  projectsOf,
} from "../../lib/vertical";
import { ripenessOfInitiative, verdictOf } from "../../lib/tending";
import { FloorHeader, PROJECT_STATUS, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABEL, RefinedSeal, useRefinedCelebration, type TimelineItem } from "./parts";
import { readSpine } from "../../lib/readiness";
import Collection, { type CollectionRecord } from "./Collection";
import { DomainFilter } from "./DomainFilter";
import FloorStandingStrip from "./FloorStandingStrip";
import GroomBlockCTA from "./GroomBlockCTA";
import FloorReadinessPanel from "./FloorReadinessPanel";
import { StandingToggle } from "./StandingToggle";

const MOMENTUM = {
  up: { value: "↑ rising", color: "var(--accent)" },
  flat: { value: "→ steady", color: "var(--muted)" },
  down: { value: "↓ stalled", color: "var(--signal)" },
};

export default function InitiativesFloor({
  onOpen,
  pin,
}: {
  onOpen: (id: string) => void;
  /** When set, the floor renders only that surface and hides the toggle — the
   *  rung tabs drive it (Grooming = "standing", All initiatives = "board"). */
  pin?: "standing" | "board";
}) {
  const { data, updateInitiative, updateProject, deleteInitiatives } = useVertical();
  const { openFloorModal, openRecord, openFlow } = useAppNavigation();
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [view, setView] = useState<"standing" | "board">(pin ?? "standing");
  const effectiveView = pin ?? view;
  const atRest = readSpine(data).floors.initiative.calm;
  const celebrate = useRefinedCelebration("initiative", atRest);

  const initiatives = data.initiatives.filter((i) => !domainFilter || i.domainId === domainFilter);

  const records: CollectionRecord[] = initiatives.map((i) => {
    const domain = domainById(data, i.domainId);
    const projects = projectsOf(data, i.id);
    const ripe = ripenessOfInitiative(data, i);
    return {
      id: i.id,
      title: i.name,
      subtitle: `${domain?.name ?? "—"}`,
      domainId: i.domainId,
      domainName: domain?.name ?? "—",
      domainIcon: domain?.icon,
      accent: domain?.color ?? "var(--accent)",
      status: i.status,
      ripeness: ripe.stage,
      unsound: ripe.stage === "active" && verdictOf(data, "initiative", i.id)?.sound !== true,
      progress: initiativeProgress(data, i),
      startDate: i.startDate,
      targetDate: i.targetDate,
      meta: {
        momentum: MOMENTUM[i.momentum],
        projects: { value: `${projects.length}` },
        krs: { value: `${i.keyResults.length}` },
      },
      setTitle: (v) => updateInitiative(i.id, { name: v }),
      setStatus: (s) => updateInitiative(i.id, { status: s as typeof i.status }),
      setDomain: (domId) => {
        updateInitiative(i.id, { domainId: domId });
        projectsOf(data, i.id).forEach((p) => updateProject(p.id, { domainId: domId }));
      },
      setStartDate: (v) => updateInitiative(i.id, { startDate: v }),
      setTargetDate: (v) => updateInitiative(i.id, { targetDate: v }),
      setDates: (start, target) => updateInitiative(i.id, { startDate: start, targetDate: target }),
      open: () => onOpen(i.id),
      childItems: projects.length > 0 ? projects.map((p): TimelineItem => ({
        id: p.id,
        label: p.name,
        color: domain?.color ?? "var(--accent)",
        start: p.startDate,
        end: p.targetDate,
        progress: p.progress,
        dim: isProjectComplete(p.status),
        onClick: () => openRecord("project", p.id),
        onChangeDates: (start, end) => updateProject(p.id, { startDate: start, targetDate: end }),
      })) : undefined,
    };
  });

  const shipped = data.initiatives.filter(
    (i) => isProjectComplete(i.status) && (!domainFilter || i.domainId === domainFilter),
  );

  return (
    <div className="mx-auto flex min-h-full max-w-[1480px] flex-col">
      <FloorHeader
        eyebrow={`${data.initiatives.length} initiatives · ${data.initiatives.filter((i) => isProjectInFlight(i.status)).length} in flight`}
        actions={
          <>
            {atRest && <RefinedSeal noun="initiatives" celebrate={celebrate} />}
            <button
              onClick={() => openFlow("refine", { pass: "initiative" })}
              className="tap fast rounded-lg px-3.5 py-2 text-caption font-medium text-white active:scale-[.98]"
              style={{ background: "var(--accent)" }}
            >
              Groom the bets →
            </button>
          </>
        }
      >
        <h1 className="text-display masthead">Initiatives</h1>
        <p className="mt-1 text-body text-muted">The bets with finish lines, across every domain — switch the view, click any to drill in. Press <kbd className="mono rounded px-1 py-0.5 bg-bg text-label text-muted border border-line">N</kbd> to create.</p>
      </FloorHeader>

      {!pin && <StandingToggle value={view} onChange={setView} />}

      {effectiveView === "standing" ? (
        <>
          <FloorStandingStrip kind="initiative" />
          <GroomBlockCTA kind="initiative" />
          <FloorReadinessPanel kind="initiative" />
        </>
      ) : (
        <>
          <DomainFilter value={domainFilter} onChange={setDomainFilter} />

          <div className="flex min-h-0 flex-1 flex-col">
            <Collection
              config={{
                records,
                statusOptions: [...PROJECT_STATUS],
                statusColors: PROJECT_STATUS_COLORS,
                statusLabels: PROJECT_STATUS_LABEL,
                extraColumns: [
                  { key: "momentum", label: "Momentum" },
                  { key: "projects", label: "Projects" },
                ],
                onNew: () => openFloorModal("new-initiative"),
                newLabel: "+ new initiative",
                storageKey: "initiatives",
                selectable: true,
                onBulkDelete: deleteInitiatives,
                domains: data.domains,
              }}
            />
          </div>

          {shipped.length > 0 && (
        <section className="mt-10">
          <div className="section-label mb-2">The shelf · {shipped.length} complete</div>
          <div className="flex flex-wrap gap-2.5">
            {shipped.map((i) => {
              const domain = domainById(data, i.domainId);
              return (
                <button
                  key={i.id}
                  onClick={() => onOpen(i.id)}
                  className="fast flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-muted"
                >
                  <span className="text-body" style={{ color: domain?.color }}>✓</span>
                  <span className="text-caption font-medium">{i.name}</span>
                  {i.targetDate && <span className="mono text-micro text-muted">{i.targetDate.slice(0, 7)}</span>}
                </button>
              );
            })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
