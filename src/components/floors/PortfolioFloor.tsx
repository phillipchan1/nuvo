// Projects — high level first, as a Notion-style collection: the same project
// data in Table · Board · Calendar · Timeline. Click any record to drill into
// its detail. Filter the set by domain along the top.

import { useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import {
  domainById,
  initiativeById,
  projectProgress,
  projectSprintCount,
  tasksOf,
} from "../../lib/vertical";
import { FloorHeader, PROJECT_STATUS, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABEL } from "./parts";
import Collection, { type CollectionRecord } from "./Collection";
import { DomainFilter } from "./DomainFilter";
import NewProject from "./NewProject";

export default function PortfolioFloor({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, updateProject } = useVertical();
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const projects = data.projects.filter((p) => !domainFilter || p.domainId === domainFilter);

  const records: CollectionRecord[] = projects.map((p) => {
    const domain = domainById(data, p.domainId);
    const initiative = initiativeById(data, p.initiativeId);
    const tasks = tasksOf(data, p.id);
    const done = tasks.filter((t) => t.status === "done").length;
    const inSprint = projectSprintCount(data, p.id);
    return {
      id: p.id,
      title: p.name,
      subtitle: initiative ? initiative.name : `${domain?.name ?? "—"} · no initiative`,
      domainId: p.domainId,
      domainName: domain?.name ?? "—",
      domainIcon: domain?.icon,
      accent: domain?.color ?? "var(--accent)",
      status: p.status,
      progress: projectProgress(data, p),
      startDate: p.startDate,
      targetDate: p.targetDate,
      meta: {
        tasks: { value: `${done}/${tasks.length}` },
        week: inSprint > 0 ? { value: `★ ${inSprint}`, color: "var(--signal)" } : { value: "—" },
      },
      setTitle: (v) => updateProject(p.id, { name: v }),
      setStatus: (s) => updateProject(p.id, { status: s as typeof p.status }),
      // moving to another domain drops the (now-mismatched) initiative link
      setDomain: (domId) => updateProject(p.id, { domainId: domId, initiativeId: null }),
      setStartDate: (v) => updateProject(p.id, { startDate: v }),
      setTargetDate: (v) => updateProject(p.id, { targetDate: v }),
      open: () => onOpen(p.id),
    };
  });

  return (
    <div className="mx-auto max-w-[1480px]">
      <FloorHeader eyebrow={`${data.projects.length} projects · ${data.projects.filter((p) => p.status === "active").length} in flight`}>
        <h1 className="text-[24px] font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-[13px] text-muted">Every project at a glance — switch the view, click any to drill in.</p>
      </FloorHeader>

      <DomainFilter value={domainFilter} onChange={setDomainFilter} />

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
          onNew: () => setCreating(true),
          newLabel: "+ new project",
          storageKey: "projects",
        }}
      />

      {creating && (
        <NewProject
          initialDomainId={domainFilter}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); onOpen(id); }}
        />
      )}
    </div>
  );
}
