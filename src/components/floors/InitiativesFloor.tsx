// Initiatives — high level first, the same Notion-style collection as projects:
// every initiative across every domain in Table · Board · Calendar · Timeline.
// Click one to drill into its detail (goal, key results, project timeline).

import { useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import {
  domainById,
  initiativeProgress,
  projectsOf,
} from "../../lib/vertical";
// (project cascade on domain move keeps children coherent)
import { FloorHeader, INITIATIVE_STATUS, INITIATIVE_STATUS_COLORS } from "./parts";
import Collection, { type CollectionRecord } from "./Collection";
import { DomainFilter } from "./DomainFilter";

const MOMENTUM = {
  up: { value: "↑ rising", color: "var(--accent)" },
  flat: { value: "→ steady", color: "var(--muted)" },
  down: { value: "↓ stalled", color: "var(--signal)" },
};

export default function InitiativesFloor({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, addInitiative, updateInitiative, updateProject } = useVertical();
  const [domainFilter, setDomainFilter] = useState<string | null>(null);

  const initiatives = data.initiatives.filter((i) => !domainFilter || i.domainId === domainFilter);

  const records: CollectionRecord[] = initiatives.map((i) => {
    const domain = domainById(data, i.domainId);
    const projects = projectsOf(data, i.id);
    return {
      id: i.id,
      title: i.name,
      subtitle: `${domain?.name ?? "—"}`,
      domainId: i.domainId,
      domainName: domain?.name ?? "—",
      domainIcon: domain?.icon,
      accent: domain?.color ?? "var(--accent)",
      status: i.status,
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
      // move the initiative and carry its projects to the same domain
      setDomain: (domId) => {
        updateInitiative(i.id, { domainId: domId });
        projectsOf(data, i.id).forEach((p) => updateProject(p.id, { domainId: domId }));
      },
      setStartDate: (v) => updateInitiative(i.id, { startDate: v }),
      setTargetDate: (v) => updateInitiative(i.id, { targetDate: v }),
      open: () => onOpen(i.id),
    };
  });

  const newInitiative = () => {
    const domId = domainFilter ?? [...data.domains].sort((a, b) => a.sort - b.sort)[0]?.id;
    if (!domId) return;
    void addInitiative(domId).then((init) => onOpen(init.id));
  };

  // the trophy shelf — shipped bets stay visible; gains need a place to live
  const shipped = data.initiatives.filter(
    (i) => i.status === "shipped" && (!domainFilter || i.domainId === domainFilter),
  );

  return (
    <div className="mx-auto max-w-[1480px]">
      <FloorHeader eyebrow={`${data.initiatives.length} initiatives · ${data.initiatives.filter((i) => i.status === "active").length} active`}>
        <h1 className="text-[24px] font-semibold tracking-tight">Initiatives</h1>
        <p className="mt-1 text-[13px] text-muted">The bets with finish lines, across every domain — switch the view, click any to drill in.</p>
      </FloorHeader>

      <DomainFilter value={domainFilter} onChange={setDomainFilter} />

      <Collection
        config={{
          records,
          statusOptions: [...INITIATIVE_STATUS],
          statusColors: INITIATIVE_STATUS_COLORS,
          extraColumns: [
            { key: "momentum", label: "Momentum" },
            { key: "projects", label: "Projects" },
          ],
          onNew: newInitiative,
          newLabel: "+ new initiative",
          storageKey: "initiatives",
        }}
      />

      {shipped.length > 0 && (
        <section className="mt-10">
          <div className="section-label mb-2">The shelf · {shipped.length} shipped</div>
          <div className="flex flex-wrap gap-2.5">
            {shipped.map((i) => {
              const domain = domainById(data, i.domainId);
              return (
                <button
                  key={i.id}
                  onClick={() => onOpen(i.id)}
                  className="fast flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-muted"
                >
                  <span className="text-[13px]" style={{ color: domain?.color }}>✓</span>
                  <span className="text-[12px] font-medium">{i.name}</span>
                  {i.targetDate && <span className="mono text-[9px] text-muted">{i.targetDate.slice(0, 7)}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
