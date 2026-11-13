// The head of Projects → Groom (D-190): one hero that states how many projects
// are left to shape — the raw and mid-groom columns of the board below, read
// from the very lanes the board draws (`useGroomLanes`) — and the one act the
// face offers beside it: Block time to groom.
//
// It used to be a slim card of its own ("Readiness 5/9 groomed · 4 need
// shaping"), counted off a different readiness model than the legend next to
// the "Groom" hero, so the two could disagree on one screen. The board's
// column headers carry the counts now; this says the one number that matters.

import GroomingSessionAction from "./GroomingSessionAction";
import { useGroomLanes } from "./GroomFloor";
import { Button } from "../kit";

export default function ProjectReadinessStrip({ onGroom }: { onGroom?: () => void }) {
  const lanes = useGroomLanes();
  const active = lanes.filter((l) => l.readyTier !== "parked");
  if (lanes.length === 0) return null;
  const toShape = active.filter((l) => l.readyTier === "raw" || l.readyTier === "grooming").length;

  return (
    <div className="fl-head">
      <div className="fl-head-main">
        <h1 className="text-display masthead">{toShape === 0 ? "All groomed" : `${toShape} to shape`}</h1>
      </div>
      {onGroom && toShape > 0 && (
        <Button kind="secondary" size="sm" onClick={onGroom}>
          Groom {toShape}
        </Button>
      )}
      <GroomingSessionAction kind="project" />
    </div>
  );
}
