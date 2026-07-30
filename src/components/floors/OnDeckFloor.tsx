// On Deck — the project altitude's front door. Not a filing cabinet: a planning
// surface. Projects live in an inbox until you time-box them onto a week (drag),
// mirroring how tasks time-box onto the Schedule. The rich full-page planner
// lives in OnDeckPlanner; the compact read-view (OnDeckTimeline) stays the groom
// flow / mobile hub. The filing-cabinet Collection is one tab over as "All
// projects".

import OnDeckPlanner from "../ondeck/OnDeckPlanner";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { FloorGuide } from "../orientation/FloorGuide";
import { OnDeckVisual } from "../orientation/Visuals";

export default function OnDeckFloor() {
  const { data } = useVertical();
  const { openFloorModal } = useAppNavigation();

  // First visit: no projects at all → teach what this surface is for, then hand
  // over the first-create. Self-cleans once a project exists.
  if (data.projects.length === 0) {
    return (
      <FloorGuide
        eyebrow="On Deck · Projects · ⌘2"
        title="Plan projects into your weeks."
        teach="A project is a finishable piece of work. Add one, then drag it onto the week you'll actually tackle it."
        Visual={OnDeckVisual}
        actionLabel="Add your first project"
        onAction={() => openFloorModal("new-project")}
      />
    );
  }

  return <OnDeckPlanner />;
}
