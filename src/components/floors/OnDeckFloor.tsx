// On Deck — the project altitude's front door. Not a filing cabinet: a planning
// surface. Projects live in an inbox until you time-box them onto a week (drag),
// mirroring how tasks time-box onto the Schedule. The rich full-page planner
// lives in OnDeckPlanner; the compact read-view (OnDeckTimeline) stays the groom
// flow / mobile hub. The filing-cabinet Collection is one tab over as "All
// projects".

import OnDeckPlanner from "../ondeck/OnDeckPlanner";

export default function OnDeckFloor({ onGroom }: { onGroom?: () => void }) {
  return <OnDeckPlanner onGroom={onGroom} />;
}
