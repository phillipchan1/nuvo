// On Deck — the project altitude's front door. Not a filing cabinet: a
// demand-phased timeline of what's in flight over the next few weeks, the pinch
// called out, each lane naming its readiness gap. This is where grooming opens
// (like Schedule opens the day) — the filing-cabinet Collection is one tab over
// as "All projects". The board itself lives in OnDeckTimeline; here we host it
// as a floor and route its grooming taps into the focused Groom flow.

import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import type { LensRef } from "../../lib/lenses";
import OnDeckTimeline from "../ondeck/OnDeckTimeline";

export default function OnDeckFloor() {
  const { data } = useVertical();
  const { openFlow } = useAppNavigation();

  // Single lens chip → groom that one item pinned to its gap's lens.
  // The full "Groom the N that need it" queue → the demand-ordered project pass
  // (RefineRun rebuilds the identical queue from readOnDeck; both are hubless).
  const onStart = (refs: LensRef[]) => {
    if (refs.length === 1) {
      const r = refs[0];
      openFlow("refine", { kind: r.kind, id: r.id, lens: r.lens });
    } else {
      openFlow("refine", { pass: "project" });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <OnDeckTimeline data={data} onStart={onStart} />
    </div>
  );
}
