// Initiatives — the "All initiatives" table: every initiative across every domain as a
// filterable, sortable, bulk-editable Notion-style collection. On Deck (quarter
// kanban) is the visual surface and Grooming is where you shape them; this is the
// pure browse/bulk filing cabinet. Click any to drill into its record.

import { useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";

import {
  domainById,
  initiativeProgress,
  isProjectInFlight,
  projectsOf,
} from "../../lib/vertical";
import { ripenessOfInitiative, verdictOf } from "../../lib/tending";
import { FloorHeader, PROJECT_STATUS, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABEL } from "./parts";
import Collection, { type CollectionRecord } from "./Collection";
import { DomainFilter } from "./DomainFilter";
import ShippedStrip from "./ShippedStrip";

const MOMENTUM = {
  up: { value: "↑ rising", color: "var(--accent)" },
  flat: { value: "→ steady", color: "var(--muted)" },
  down: { value: "↓ stalled", color: "var(--signal)" },
};

export default function InitiativesFloor({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, updateInitiative, updateProject, deleteInitiatives } = useVertical();
  const { openFloorModal, setInitiativeView } = useAppNavigation();
  const [domainFilter, setDomainFilter] = useState<string | null>(null);

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
    };
  });

  return (
    <div className="mx-auto flex min-h-full max-w-[1480px] flex-col">
      <FloorHeader
        eyebrow={`${data.initiatives.length} initiatives · ${data.initiatives.filter((i) => isProjectInFlight(i.status)).length} in flight`}
        actions={
          <>
            <ShippedStrip rung="initiative" />
            <button
              onClick={() => setInitiativeView("groom")}
              className="tap fast rounded-lg px-3.5 py-2 text-caption font-medium text-white active:scale-[.98]"
              style={{ background: "var(--accent)" }}
            >
              Groom the initiatives →
            </button>
          </>
        }
      >
        <h1 className="text-display masthead">Table</h1>
        <p className="mt-1 text-body text-muted">Every initiative at a glance — filter, sort, and bulk-edit. Click any to drill in. Press <kbd className="mono rounded px-1 py-0.5 bg-bg text-label text-muted border border-line">N</kbd> to create.</p>
      </FloorHeader>

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
    </div>
  );
}
