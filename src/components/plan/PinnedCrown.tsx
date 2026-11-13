// The crown, pinned while a mode has the rail (docs/rail-modes.md §2: "the
// crown is pinned in every mode"). PlanRail and RepairRail replace LeftRail,
// and with it WeekPanel — so without this the one read of what the week is
// carrying vanished exactly while you changed it, and the Reach (D-202) had
// nowhere to land.
//
// SHUT, always: the slate pips and nothing else — no sentence, no second
// header; it rides the rail's own bar. It computes nothing: `useWeekCrown`
// for the week the mode is working on. During a plan, work HELD in the draft
// counts as placed, so a project's pip goes tinted the moment its last loose
// piece is held (and lands, once, as the Reach arrives).

import { useMemo } from "react";
import { useWeekCrown } from "../../hooks/useWeekCrown";
import { SlatePips } from "../progress/PaceTrack";

export default function PinnedCrown({
  weekISO,
  heldTaskIds,
}: {
  /** the week the mode works on — the plan may be next week's */
  weekISO?: string;
  /** tasks held in the plan's draft: placed, as far as the pips are concerned */
  heldTaskIds?: ReadonlySet<string>;
}) {
  const crown = useWeekCrown(weekISO);
  const allPlaced = useMemo(() => {
    const out = new Set<string>();
    for (const r of crown?.rows ?? []) {
      if (r.open === 0) continue;
      if (r.loose.every((t) => heldTaskIds?.has(t.id))) out.add(r.projectId);
    }
    return out;
  }, [crown, heldTaskIds]);
  if (!crown || crown.rows.length === 0) return null;
  const placedN = allPlaced.size;
  return (
    <span
      data-pinned-crown
      className="flex min-w-0 items-center overflow-hidden"
      role="img"
      aria-label={`${crown.weekLabel}: ${crown.landed} of ${crown.total} landed, ${placedN} with every piece placed`}
    >
      <SlatePips rows={crown.rows} allPlaced={allPlaced} />
    </span>
  );
}
