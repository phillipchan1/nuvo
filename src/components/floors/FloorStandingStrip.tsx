// The Readiness strip — the floor's headline read above the to-groom list. ONE
// blended 0..100 figure (the Readiness score) with the three contributors that
// compose it shown as bars: Groomed (the backbone), Capacity, and Motion. The
// score multiplies them so the weakest drags it down — see standingScore() in
// lib/standing.ts. So "Groomed" (the spine rung / Groom-run number) is one
// contributor; the blended Readiness score folds in load and movement on top.
// The to-groom list below is the actionable detail for the Groomed bar. Capacity
// stays tappable into the triage flow when it's not calm.

import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { readStanding, standingScore, type Band, type Kind } from "../../lib/standing";
import { PROJECT_STATUS_COLORS } from "./parts";
import { READY } from "./ReadinessBanner";

const CAUTION = PROJECT_STATUS_COLORS.waiting; // the one caution amber — tight & over
const BAND_LABEL: Record<Band, string> = {
  comfortable: "Comfortable",
  tight: "Tight",
  overcommitted: "Overcommitted",
};

/** One contributor — a "more = healthier" bar on the paper (no card frame). When
 *  onClick is set the whole stat is the doorway to the play that moves it. */
function Bar({
  label, value, fill, color, action, onClick,
}: {
  label: string;
  value: string;
  fill: number; // 0..1
  color: string;
  action?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="section-label !p-0">{label}</span>
        <span className="mono text-meta" style={{ color }}>{value}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div className="fast h-full rounded-full" style={{ width: `${Math.round(fill * 100)}%`, background: color }} />
      </div>
      {action && (
        <span className="mt-2 inline-flex items-center gap-1 text-meta font-medium" style={{ color: "var(--accent)" }}>
          {action}
          <span className="fast transition-transform group-hover:translate-x-0.5">›</span>
        </span>
      )}
    </>
  );
  if (onClick) {
    return (
      <button onClick={onClick} className="fast group -mx-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-surface-2">
        {inner}
      </button>
    );
  }
  return <div className="py-1">{inner}</div>;
}

export default function FloorStandingStrip({ kind }: { kind: Kind }) {
  const { data } = useVertical();
  const { openFlow } = useAppNavigation();
  const s = readStanding(data, kind);
  const sc = standingScore(s);

  const tight = s.inFlight > 0 && s.capacity !== "comfortable";

  return (
    <div className="mb-6 max-w-[920px]">
      {/* Hero — the blended figure */}
      <div className="section-label !px-0 !pb-1.5">Readiness</div>
      <div className="flex items-baseline gap-1.5">
        <span className="masthead text-display leading-none">{sc.score}</span>
        <span className="text-head text-muted">/100</span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div className="fast h-full rounded-full" style={{ width: `${sc.score}%`, background: READY }} />
      </div>
      <p className="masthead mt-3 max-w-[52ch] text-lead text-ink">{s.synthesis}</p>

      {/* Breakdown — the three contributors that multiply into Standing */}
      <div className="mt-5 grid max-w-[640px] grid-cols-3 gap-x-7 gap-y-1">
        <Bar
          label="Groomed"
          value={`${Math.round(sc.shaped * 100)}%`}
          fill={sc.shaped}
          color={sc.shaped >= 0.85 ? READY : "var(--muted)"}
        />
        <Bar
          label="Capacity"
          value={s.inFlight === 0 ? "Clear" : BAND_LABEL[s.capacity]}
          fill={s.inFlight === 0 ? 1 : sc.headroom}
          color={tight ? CAUTION : READY}
          action={tight ? "Triage" : undefined}
          onClick={tight ? () => openFlow("capacity") : undefined}
        />
        <Bar
          label="Motion"
          value={s.motionTotal ? `${s.motionMoving}/${s.motionTotal} moving` : "—"}
          fill={sc.motion}
          color={s.motionTotal && s.motionMoving < s.motionTotal ? CAUTION : READY}
        />
      </div>
    </div>
  );
}
