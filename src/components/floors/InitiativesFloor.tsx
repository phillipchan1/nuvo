// Initiatives — high level first, the same Notion-style collection as projects:
// every initiative across every domain in Table · Board · Calendar · Timeline.
// Click one to drill into its detail (goal, key results, project timeline).

import { useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import {
  domainById,
  initiativeProgress,
  projectsOf,
} from "../../lib/vertical";
import { FloorHeader, INITIATIVE_STATUS, INITIATIVE_STATUS_COLORS } from "./parts";
import Collection, { type CollectionRecord } from "./Collection";
import { DomainFilter } from "./DomainFilter";
import NewInitiative from "./NewInitiative";
import QuickCreate from "./QuickCreate";
import type { BlueprintSeed } from "../rituals/BlueprintFlow";

const MOMENTUM = {
  up: { value: "↑ rising", color: "var(--accent)" },
  flat: { value: "→ steady", color: "var(--muted)" },
  down: { value: "↓ stalled", color: "var(--signal)" },
};

export default function InitiativesFloor({
  onOpen,
  openBlueprint,
}: {
  onOpen: (id: string) => void;
  openBlueprint?: (seed: BlueprintSeed) => void;
}) {
  const { data, updateInitiative, updateProject, deleteInitiatives } = useVertical();
  const { nav, openFloorModal, closeFloorModal } = useAppNavigation();
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  // fast composer by default; "more options" expands into the full moment.
  const [full, setFull] = useState<{ domainId: string; name: string } | null>(null);

  const creating = nav.floorModal === "new-initiative";
  const close = () => { setFull(null); closeFloorModal(); };

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
      setDomain: (domId) => {
        updateInitiative(i.id, { domainId: domId });
        projectsOf(data, i.id).forEach((p) => updateProject(p.id, { domainId: domId }));
      },
      setStartDate: (v) => updateInitiative(i.id, { startDate: v }),
      setTargetDate: (v) => updateInitiative(i.id, { targetDate: v }),
      setDates: (start, target) => updateInitiative(i.id, { startDate: start, targetDate: target }),
      open: () => onOpen(i.id),
    };
  });

  const shipped = data.initiatives.filter(
    (i) => i.status === "shipped" && (!domainFilter || i.domainId === domainFilter),
  );

  return (
    <div className="mx-auto flex min-h-full max-w-[1480px] flex-col">
      <FloorHeader eyebrow={`${data.initiatives.length} initiatives · ${data.initiatives.filter((i) => i.status === "active").length} active`}>
        <h1 className="text-[24px] font-semibold tracking-tight">Initiatives</h1>
        <p className="mt-1 text-[13px] text-muted">The bets with finish lines, across every domain — switch the view, click any to drill in.</p>
      </FloorHeader>

      <DomainFilter value={domainFilter} onChange={setDomainFilter} />

      <div className="flex min-h-0 flex-1 flex-col">
        <Collection
        config={{
          records,
          statusOptions: [...INITIATIVE_STATUS],
          statusColors: INITIATIVE_STATUS_COLORS,
          extraColumns: [
            { key: "momentum", label: "Momentum" },
            { key: "projects", label: "Projects" },
          ],
          onNew: () => openFloorModal("new-initiative"),
          newLabel: "+ new initiative",
          storageKey: "initiatives",
          selectable: true,
          onBulkDelete: deleteInitiatives,
        }}
        />
      </div>

      {creating && !full && (
        <QuickCreate
          kind="initiative"
          initialDomainId={domainFilter}
          onClose={close}
          onCreated={(id) => { setFull(null); onOpen(id); }}
          onExpand={({ domainId, name }) => setFull({ domainId, name })}
        />
      )}
      {creating && full && (
        <NewInitiative
          initialDomainId={full.domainId}
          initialName={full.name}
          onClose={close}
          onCreated={(id) => { setFull(null); onOpen(id); }}
          onBlueprint={openBlueprint}
        />
      )}

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
