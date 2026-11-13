// Initiatives → Table — the List layout (D-190), the twin of the projects
// Table: every initiative across every domain as a grouped, sortable,
// bulk-editable row. On Deck (the quarter deck) is the visual surface and Groom
// is where you shape them; this is the filing cabinet. Click any to open its
// record. No hero — the PageBar names it, and the bar's tabs are the doors to
// the other faces, so the old "Groom the initiatives →" button is gone.

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";

import { domainById, initiativeProgress, isProjectComplete, projectsOf } from "../../lib/vertical";
import { ripenessOfInitiative, verdictOf } from "../../lib/tending";
import { spanElapsed } from "../../lib/pace";
import { PROJECT_STATUS, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABEL } from "./parts";
import Collection, { type CollectionRecord } from "./Collection";
import { DomainFilter } from "./DomainFilter";
import FloorStanding from "./FloorStanding";

// Momentum is a read, said in words (↑ rising) — tabular, never tinted: the
// signal is spent on *now* only (D-187), and the accent on intent.
const MOMENTUM = {
  up: { value: "↑ Rising" },
  flat: { value: "→ Steady" },
  down: { value: "↓ Stalled" },
};

export default function InitiativesFloor({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, updateInitiative, updateProject, deleteInitiatives } = useVertical();
  const { openFloorModal, setInitiativeView } = useAppNavigation();
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

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
      // An initiative's pieces are its projects; the pace track counts them shipped.
      pieces: projects.length > 0 ? { done: projects.filter((p) => isProjectComplete(p.status)).length, total: projects.length } : undefined,
      elapsed: i.status === "complete" ? null : spanElapsed(i, now),
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
        newLabel: "New initiative",
        newKey: "I",
        storageKey: "initiatives",
        selectable: true,
        onBulkDelete: deleteInitiatives,
        domains: data.domains,
        recordKind: "initiative",
        filter: <DomainFilter value={domainFilter} onChange={setDomainFilter} />,
        aside: (
          <FloorStanding kind="initiative" onRefine={() => setInitiativeView("groom")} onAllocate={() => setInitiativeView("ondeck")} />
        ),
      }}
    />
  );
}
