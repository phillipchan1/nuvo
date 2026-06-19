// The floor's "now what" — the readiness gauge woven into the hero of the
// Project / Initiative floors (the views that don't otherwise guide you; Today
// has its brief, the Domain chapel has its lamps). Names the single ripest item
// and its next move, and the action launches the intelligent Tending ritual.

import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { RIPENESS_ADVANCE, readTending } from "../../lib/tending";
import { readinessOfInitiativeFloor, readinessOfProjectFloor, type FloorCue } from "../../lib/readiness";
import { ReadinessBanner } from "./ReadinessBanner";

export default function FloorReadiness({ kind }: { kind: "project" | "initiative" }) {
  const { data } = useVertical();
  const { openFlow } = useAppNavigation();

  const top = readTending(data).groomable.find((c) => c.kind === kind) ?? null;
  const readiness = kind === "project" ? readinessOfProjectFloor(data) : readinessOfInitiativeFloor(data);
  const cue: FloorCue | null = top
    ? { tone: top.silent ? "drift" : "attention", label: `${top.name} — ${RIPENESS_ADVANCE[top.ripeness.stage]}` }
    : null;

  return (
    <div className="mb-6 max-w-[680px]">
      <ReadinessBanner
        eyebrow={kind === "project" ? "Projects" : "Initiatives"}
        readiness={readiness}
        cue={cue}
        actionLabel={top ? "Tend" : undefined}
        onAction={top ? () => openFlow("tending") : undefined}
      />
    </div>
  );
}
