// On Deck for the initiative altitude — the initiatives grouped by quarter. The sibling
// of OnDeckFloor (projects → weeks). Thin wrapper so the router stays symmetric
// with the project rung; the surface lives in InitiativeDeck.

import InitiativeDeck from "../ondeck/InitiativeDeck";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { FloorGuide } from "../orientation/FloorGuide";
import { FlowVisual } from "../orientation/Visuals";

export default function InitiativeOnDeckFloor() {
  const { data } = useVertical();
  const { openFloorModal } = useAppNavigation();

  // First visit: no initiatives yet → one line of where this altitude sits, then
  // the first-create. Self-cleans once an initiative exists.
  if (data.initiatives.length === 0) {
    return (
      <FloorGuide
        eyebrow="No initiatives yet"
        title="Set the arcs you're pursuing."
        teach="The big, multi-project arcs under a domain. Projects live beneath them."
        Visual={FlowVisual}
        actionLabel="Add your first initiative"
        onAction={() => openFloorModal("new-initiative")}
      />
    );
  }

  return <InitiativeDeck />;
}
