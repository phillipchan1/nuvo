// The head of Initiatives → Groom (D-190), the sibling of ProjectReadinessStrip:
// one hero that states how many bets are left to shape — the Raw and Grooming
// columns of the board below, read from the same lanes and the same tiering
// (`useInitiativeGroomLanes` · `initiativeTier`) — and Block time to groom.

import { useVertical } from "../../hooks/useVertical";
import GroomingSessionAction from "./GroomingSessionAction";
import { useInitiativeGroomLanes } from "./InitiativeGroomFloor";
import { initiativeTier } from "../ondeck/InitiativeGroomWall";
import { Button } from "../kit";

export default function InitiativeReadinessStrip({ onGroom }: { onGroom?: () => void }) {
  const { data } = useVertical();
  const lanes = useInitiativeGroomLanes();
  if (lanes.length === 0) return null;
  const tiers = lanes.map((l) => initiativeTier(data, l));
  const toShape = tiers.filter((t) => t === "raw" || t === "grooming").length;

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
      <GroomingSessionAction kind="initiative" />
    </div>
  );
}
