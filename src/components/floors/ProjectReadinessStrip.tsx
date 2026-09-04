// The persistent project-readiness strip — one slim line pinned above every
// project view (On Deck · Groom · Table), because "how ready is the portfolio to
// be worked?" is the same answer regardless of which view you're looking at.
// Reads the SAME lens axes the deck/Groom cards route by (lib/lenses.ts), so the
// roll-up and the per-card meters can never disagree. Grooming is the action, so
// off the Groom view the strip offers a jump into it.
//
// NOTE: this consolidates presentation only. The tangle of readiness *models*
// (this axis roll-up vs the blended Standing score vs ripeness/tending) is a
// separate pass — flagged, not resolved here.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { isProjectInFlight } from "../../lib/vertical";
import { lensGaps } from "../../lib/lenses";
import { PROJECT_STATUS_COLORS } from "./parts";
import { READY } from "./ReadinessBanner";
import GroomingSessionAction from "./GroomingSessionAction";

const CAUTION = PROJECT_STATUS_COLORS.waiting;

export default function ProjectReadinessStrip({ onGroom }: { onGroom?: () => void }) {
  const { data } = useVertical();
  const now = useMemo(() => new Date(), []);

  const inflight = data.projects.filter((p) => isProjectInFlight(p.status));
  const needy = inflight.filter((p) => lensGaps(data, "project", p, now).length > 0);
  const total = inflight.length;
  const groomed = total - needy.length;

  if (total === 0) return null;
  const allSet = needy.length === 0;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line bg-surface-2 px-4 py-2.5">
      <span className="section-label !p-0">Readiness</span>
      <span className="flex items-center gap-1.5 text-caption">
        <span className="h-2 w-2 rounded-full" style={{ background: READY }} />
        <span className="text-ink">
          <span className="mono font-medium">{groomed}/{total}</span> groomed
        </span>
      </span>
      {!allSet && (
        <span className="flex items-center gap-1.5 text-caption">
          <span className="h-2 w-2 rounded-full" style={{ background: CAUTION }} />
          <span className="text-ink">
            <span className="mono font-medium">{needy.length}</span> need shaping
          </span>
        </span>
      )}
      <div className="flex-1" />
      {allSet ? (
        <span className="text-caption text-muted">Every project is ready to schedule.</span>
      ) : (
        <>
          {onGroom ? (
            <button
              onClick={onGroom}
              className="tap fast rounded-lg px-2.5 py-1 text-caption font-medium"
              style={{ color: "var(--accent)" }}
            >
              Groom {needy.length} →
            </button>
          ) : (
            <span className="text-caption text-muted">Thinnest first, below.</span>
          )}
          <GroomingSessionAction kind="project" />
        </>
      )}
    </div>
  );
}
