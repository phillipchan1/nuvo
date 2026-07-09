// The mobile distillation of the spine gauge. The phone has no spine, so the
// funnel's "now what" rides the top of the Now screen: one glass banner that
// surfaces the single most valuable next turn across the week and the vertical.
//
// Day-level faithfulness already lives in NowFloor's domain balance, so this
// stays focused on what the phone otherwise can't see — is the week composed,
// and are the initiatives ready. Build-floor work isn't fully tendable on a phone, so
// its demand routes to the Plan tab (browse/light edits) or Nuvo (the planner).

import { FLOOR_LABEL, readSpine, topTurn } from "../../lib/readiness";
import type { VerticalData } from "../../lib/vertical";
import { ReadinessBanner } from "../floors/ReadinessBanner";

export default function MobileReadiness({
  data,
  onAskNuvo,
  onOpenPlan,
}: {
  data: VerticalData;
  onAskNuvo: (seed?: string) => void;
  onOpenPlan: () => void;
}) {
  const spine = readSpine(data);
  const turn = topTurn(spine);

  // Calm: the reward state, gently — show the week meter with no cue.
  if (!turn) {
    return <ReadinessBanner eyebrow="This week" readiness={spine.floors.day.readiness} cue={null} />;
  }

  // The action depends on where the turn lives and what kind it is. The week's
  // own planning is a Nuvo job on the phone; everything in the vertical routes
  // to the Plan tab (browse + light edits).
  const action =
    turn.floor === "day"
      ? turn.cue?.tone === "invite"
        ? { label: "Plan with Nuvo", run: () => onAskNuvo("Help me plan this week") }
        : { label: "Review in Plan", run: onOpenPlan }
      : { label: "Review in Plan", run: onOpenPlan };

  return (
    <ReadinessBanner
      eyebrow={FLOOR_LABEL[turn.floor]}
      readiness={turn.readiness}
      cue={turn.cue}
      actionLabel={action.label}
      onAction={action.run}
    />
  );
}
