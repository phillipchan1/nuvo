// Commitment — the meter that answers "am I over-committed?" honestly, because it
// finally compares like with like: the portfolio's weekly hours-demand (every
// in-flight project's required pace, summed) against a typical week's real,
// calendar-derived capacity. Demand ÷ Capacity. The headline of the projects
// Standing. See docs/commitment-model.md.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { portfolioDemand } from "../../lib/pace";
import { Bar, PROJECT_STATUS_COLORS } from "./parts";
import { READY } from "./ReadinessBanner";

const CAUTION = PROJECT_STATUS_COLORS.waiting; // the one caution amber, shared with the gauges

type Band = "room" | "committed" | "over";

function fmtH(mins: number): string {
  const h = mins / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

export default function CommitmentMeter({ onRefine }: { onRefine?: () => void }) {
  const { data } = useVertical();
  const now = useMemo(() => new Date(), []);
  const demand = portfolioDemand(data, now);
  const { weeklyAvgMins, thisWeekMins } = useCapacity();

  const demandMins = demand.perWeekMins;
  const capMins = weeklyAvgMins;
  const hasDemand = demandMins > 0;
  const ratio = capMins > 0 ? demandMins / capMins : hasDemand ? Infinity : 0;
  const pct = Number.isFinite(ratio) ? Math.round(ratio * 100) : null;
  const band: Band = ratio > 1 ? "over" : ratio >= 0.7 ? "committed" : "room";
  const color = band === "over" ? CAUTION : READY;

  const latent = demand.latent.length;
  const pressing = demand.pressing.length;

  // Empty / not-yet-meterable states — the funnel still has something to say.
  let synthesis: string;
  if (!hasDemand && latent === 0) {
    synthesis = "Nothing in flight to pace yet. Commit a project with a finish line and it shows up here.";
  } else if (!hasDemand) {
    synthesis = `${latent} project${latent === 1 ? " is" : "s are"} in flight but not yet counted — size them and set a finish line to see your commitment.`;
  } else if (capMins <= 0) {
    synthesis = `Your bets need ≈${fmtH(demandMins)} a week. Set your working hours to gauge that against real capacity.`;
  } else {
    const head = `Your bets need ≈${fmtH(demandMins)} a week against ≈${fmtH(capMins)} of open time`;
    synthesis =
      band === "over"
        ? `${head} — you're ${pct}% committed. Move a finish line, cut scope, or drop a bet.`
        : band === "committed"
          ? `${head}. ${pct}% committed — full, but it fits.`
          : `${head}. ${pct}% committed — room to pull another bet.`;
  }

  const BAND_LABEL: Record<Band, string> = { room: "Room to commit", committed: "Committed", over: "Overcommitted" };

  return (
    <div className="glass-card mb-6 max-w-[920px] rounded-xl border border-line p-4" style={{ boxShadow: "var(--shadow-2)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="section-label !p-0">Commitment</span>
        {hasDemand && capMins > 0 && (
          <span className="mono shrink-0 text-meta" style={{ color }}>
            {BAND_LABEL[band]} · {pct}%
          </span>
        )}
      </div>

      {hasDemand && capMins > 0 ? (
        <div className="mt-2.5">
          <Bar pct={Math.min(pct ?? 0, 100)} color={color} />
          <div className="mono mt-2 flex items-center gap-3 text-meta text-muted">
            <span style={{ color: "var(--ink)" }}>≈{fmtH(demandMins)}/wk needed</span>
            <span>·</span>
            <span>≈{fmtH(capMins)}/wk free</span>
            <span>·</span>
            <span>≈{fmtH(thisWeekMins)} left this week</span>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 h-1.5 rounded-full" style={{ background: "var(--line)" }} />
      )}

      <p className="masthead mt-3 max-w-[52ch] text-lead text-ink">{synthesis}</p>

      {(latent > 0 || pressing > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption">
          {pressing > 0 && (
            <span className="mono" style={{ color: CAUTION }}>
              {pressing} behind pace
            </span>
          )}
          {latent > 0 &&
            (onRefine ? (
              <button onClick={onRefine} className="fast group flex items-center gap-1 font-medium" style={{ color: "var(--accent)" }}>
                {latent} not yet counted — refine to commit
                <span className="fast transition-transform group-hover:translate-x-0.5">›</span>
              </button>
            ) : (
              <span className="mono text-muted">{latent} not yet counted (unsized or undated)</span>
            ))}
        </div>
      )}
    </div>
  );
}
