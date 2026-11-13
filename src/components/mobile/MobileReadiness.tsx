// The mobile distillation of the spine gauge. The phone has no spine, so the
// funnel's "now what" rides the top of the Tasks → Week segment: one kit Card
// that surfaces the single most valuable next turn across the week and the
// vertical — its name, a 3px meter, the one cue, and the one act.
//
// It stays focused on what the phone otherwise can't see — is the week composed,
// and are the initiatives ready. Build-floor work isn't fully tendable on a
// phone, so its demand routes to the matching On Deck tab (Projects /
// Initiatives) or Nuvo (the planner).

import { FLOOR_LABEL, readSpine, topTurn, type Floor } from "../../lib/readiness";
import type { VerticalData } from "../../lib/vertical";
import { READY, toneColor } from "../floors/ReadinessBanner";
import { Card } from "../kit";
import { TouchButton } from "./touch";

export default function MobileReadiness({
  data,
  onAskNuvo,
  onReview,
}: {
  data: VerticalData;
  onAskNuvo: (seed?: string, say?: string) => void;
  onReview: (floor: Floor) => void;
}) {
  const spine = readSpine(data);
  const turn = topTurn(spine);

  // Calm: the reward state, gently — the week's meter, full, and no act.
  if (!turn) {
    return <ReadinessCard name="This week" readiness={spine.floors.day.readiness} />;
  }

  // The action depends on where the turn lives. The week's own planning is a Nuvo
  // job on the phone; vertical turns route to their On Deck tab (domains, which
  // have no tab, ride along to Initiatives where their bets live).
  const reviewLabel =
    turn.floor === "project" ? "Open Projects" : turn.floor === "day" ? "Review week" : "Open Initiatives";
  const action =
    turn.floor === "day" && turn.cue?.tone === "invite"
      ? { label: "Plan with Nuvo", run: () => onAskNuvo("Help me plan this week", "Plan my week") }
      : { label: reviewLabel, run: () => onReview(turn.floor) };

  return (
    <ReadinessCard
      name={FLOOR_LABEL[turn.floor]}
      readiness={turn.readiness}
      cue={turn.cue ? { label: turn.cue.label, color: toneColor(turn.cue.tone) } : null}
      action={action}
    />
  );
}

/** How ready one floor is: its name and share, a 3px meter of what is held
 *  (not what is missing), the one thing slipping, and the turn that fixes it. */
function ReadinessCard({
  name,
  readiness,
  cue = null,
  action,
}: {
  name: string;
  /** 0..1 — the meter fill. */
  readiness: number;
  cue?: { label: string; color: string } | null;
  action?: { label: string; run: () => void };
}) {
  const pct = Math.round(readiness * 100);
  const calm = !cue;
  return (
    <Card className="ph-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption font-semibold text-muted">{name}</span>
        <span className="text-caption font-semibold tabular-nums" style={{ color: calm ? READY : "var(--ink)" }}>
          {calm ? "Ready" : `${pct}%`}
        </span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-[2px] bg-[var(--line-2)]" aria-hidden>
        <div className="fast h-full rounded-[2px]" style={{ width: `${pct}%`, background: READY }} />
      </div>
      {cue ? (
        <div className="flex items-center gap-3">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cue.color }} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-head font-medium text-ink">{cue.label}</span>
          {action && (
            <TouchButton compact onClick={action.run} className="shrink-0">
              {action.label}
            </TouchButton>
          )}
        </div>
      ) : (
        <span className="text-body text-muted">Nothing slipping</span>
      )}
    </Card>
  );
}
