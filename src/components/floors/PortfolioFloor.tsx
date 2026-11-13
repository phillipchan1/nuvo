// Projects → Table — the List layout (D-190). Every project as a grouped,
// sortable, bulk-editable row; click one to open its record. No hero (the
// PageBar names it): the filter row carries the domain filter, the floor's
// standing and the create button, and the rows are the content.

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import {
  domainById,
  initiativeById,
  projectProgress,
  projectSprintCount,
  tasksOf,
} from "../../lib/vertical";
import { ripenessOfProject, verdictOf } from "../../lib/tending";
import { spanElapsed } from "../../lib/pace";
import { PROJECT_STATUS, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABEL } from "./parts";
import Collection, { type CollectionRecord } from "./Collection";
import { DomainFilter } from "./DomainFilter";
import FloorStanding from "./FloorStanding";
import { ProjectShipAssess } from "../record/ShipAssess";

export default function PortfolioFloor({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, updateProject, deleteProjects } = useVertical();
  const { openFloorModal, setProjectView } = useAppNavigation();
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  // Shipping asks first here too — the table's status chip is one click, and it
  // used to seal a project (and orphan its open tasks) without ever showing them.
  const [shipId, setShipId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

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
      pieces: { done, total: tasks.length },
      // A shipped project has no clock left to compare against (P7).
      elapsed: p.status === "complete" ? null : spanElapsed(p, now),
      startDate: p.startDate,
      targetDate: p.targetDate,
      meta: {
        tasks: { value: `${done}/${tasks.length}` },
        week: { value: inSprint > 0 ? `${inSprint}` : "—" },
      },
      setTitle: (v) => updateProject(p.id, { name: v }),
      setStatus: (s) =>
        s === "complete" ? setShipId(p.id) : updateProject(p.id, { status: s as typeof p.status }),
      setDomain: (domId) => updateProject(p.id, { domainId: domId, initiativeId: null }),
      setStartDate: (v) => updateProject(p.id, { startDate: v }),
      setTargetDate: (v) => updateProject(p.id, { targetDate: v }),
      setDates: (start, target) => updateProject(p.id, { startDate: start, targetDate: target }),
      open: () => onOpen(p.id),
    };
  });

  return (
    <>
      <Collection
        config={{
          records,
          statusOptions: PROJECT_STATUS,
          statusColors: PROJECT_STATUS_COLORS,
          statusLabels: PROJECT_STATUS_LABEL,
          extraColumns: [
            { key: "tasks", label: "Pieces" },
            { key: "week", label: "This week" },
          ],
          onNew: () => openFloorModal("new-project"),
          newLabel: "New project",
          newKey: "P",
          storageKey: "projects",
          selectable: true,
          onBulkDelete: deleteProjects,
          domains: data.domains,
          recordKind: "project",
          filter: <DomainFilter value={domainFilter} onChange={setDomainFilter} />,
          aside: (
            <FloorStanding kind="project" onRefine={() => setProjectView("groom")} onAllocate={() => setProjectView("ondeck")} />
          ),
        }}
      />

      {shipId && <ProjectShipAssess id={shipId} onClose={() => setShipId(null)} />}
    </>
  );
}
