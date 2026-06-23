// Projects — high level first, as a Notion-style collection: the same project
// data in Table · Board · Calendar · Timeline. Click any record to drill into
// its detail. Filter the set by domain along the top.

import { useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import {
  domainById,
  initiativeById,
  isProjectInFlight,
  projectProgress,
  projectSprintCount,
  tasksOf,
} from "../../lib/vertical";
import { ripenessOfProject, verdictOf } from "../../lib/tending";
import { FloorHeader, PROJECT_STATUS, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABEL, RefinedSeal, useRefinedCelebration } from "./parts";
import { readSpine } from "../../lib/readiness";
import Collection, { type CollectionRecord } from "./Collection";
import { DomainFilter } from "./DomainFilter";
import FloorStanding from "./FloorStanding";
import CommitmentMeter from "./CommitmentMeter";
import { StandingToggle } from "./StandingToggle";

export default function PortfolioFloor({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, updateProject, deleteProjects } = useVertical();
  const { openFloorModal, openFlow } = useAppNavigation();
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [view, setView] = useState<"standing" | "board">("standing");
  const atRest = readSpine(data).floors.project.calm;
  const celebrate = useRefinedCelebration("project", atRest);

  const projects = data.projects.filter((p) => !domainFilter || p.domainId === domainFilter);

  const records: CollectionRecord[] = projects.map((p) => {
    const domain = domainById(data, p.domainId);
    const initiative = initiativeById(data, p.initiativeId);
    const tasks = tasksOf(data, p.id);
    const done = tasks.filter((t) => t.status === "done").length;
    const inSprint = projectSprintCount(data, p.id);
    const ripe = ripenessOfProject(data, p);
    return {
      id: p.id,
      title: p.name,
      subtitle: initiative ? initiative.name : `${domain?.name ?? "—"} · no initiative`,
      domainId: p.domainId,
      domainName: domain?.name ?? "—",
      domainIcon: domain?.icon,
      accent: domain?.color ?? "var(--accent)",
      status: p.status,
      ripeness: ripe.stage,
      unsound: ripe.stage === "active" && verdictOf(data, "project", p.id)?.sound !== true,
      progress: projectProgress(data, p),
      startDate: p.startDate,
      targetDate: p.targetDate,
      meta: {
        tasks: { value: `${done}/${tasks.length}` },
        week: inSprint > 0 ? { value: `★ ${inSprint}`, color: "var(--signal)" } : { value: "—" },
      },
      setTitle: (v) => updateProject(p.id, { name: v }),
      setStatus: (s) => updateProject(p.id, { status: s as typeof p.status }),
      setDomain: (domId) => updateProject(p.id, { domainId: domId, initiativeId: null }),
      setStartDate: (v) => updateProject(p.id, { startDate: v }),
      setTargetDate: (v) => updateProject(p.id, { targetDate: v }),
      setDates: (start, target) => updateProject(p.id, { startDate: start, targetDate: target }),
      open: () => onOpen(p.id),
    };
  });

  return (
    <div className="mx-auto flex min-h-full max-w-[1480px] flex-col">
      <FloorHeader
        eyebrow={`${data.projects.length} projects · ${data.projects.filter((p) => isProjectInFlight(p.status)).length} in flight`}
        actions={atRest ? <RefinedSeal noun="projects" celebrate={celebrate} /> : undefined}
      >
        <h1 className="text-display masthead">Projects</h1>
        <p className="mt-1 text-body text-muted">Every project at a glance — switch the view, click any to drill in. Press <kbd className="mono rounded px-1 py-0.5 bg-bg text-label text-muted border border-line">N</kbd> to create.</p>
      </FloorHeader>

      <StandingToggle value={view} onChange={setView} />

      {view === "standing" ? (
        <>
          <CommitmentMeter onRefine={() => openFlow("refine")} onAllocate={() => openFlow("capacity")} />
          <FloorStanding kind="project" onRefine={() => openFlow("refine")} onAllocate={() => openFlow("capacity")} showCapacity={false} />
        </>
      ) : (
        <>
          <DomainFilter value={domainFilter} onChange={setDomainFilter} />

          <div className="flex min-h-0 flex-1 flex-col">
            <Collection
              config={{
                records,
                statusOptions: PROJECT_STATUS,
                statusColors: PROJECT_STATUS_COLORS,
                statusLabels: PROJECT_STATUS_LABEL,
                extraColumns: [
                  { key: "tasks", label: "Tasks" },
                  { key: "week", label: "Week" },
                ],
                onNew: () => openFloorModal("new-project"),
                newLabel: "+ new project",
                storageKey: "projects",
                selectable: true,
                onBulkDelete: deleteProjects,
              }}
            />
          </div>
        </>
      )}

    </div>
  );
}
