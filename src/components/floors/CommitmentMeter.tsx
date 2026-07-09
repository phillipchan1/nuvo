// Commitment — the meter that answers "am I over-committed?" honestly, because it
// finally compares like with like: the portfolio's weekly hours-demand (every
// in-flight project's required pace, summed) against a typical week's real,
// calendar-derived capacity. Demand ÷ Capacity. The headline of the projects
// Standing. See docs/commitment-model.md.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { portfolioDemand } from "../../lib/pace";
import { weekForecast } from "../../lib/capacity";
import { readStanding } from "../../lib/standing";
import { Bar, fmtDate, PROJECT_STATUS_COLORS } from "./parts";
import { READY } from "./ReadinessBanner";

const CAUTION = PROJECT_STATUS_COLORS.waiting; // the one caution amber, shared with the gauges
const RIBBON_WEEKS = 10; // how many weeks of load forecast to show
const CAP_CEILING = 0.78; // capacity (ratio = 1) sits here, leaving headroom to show overflow

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Band = "room" | "committed" | "over";

function fmtH(mins: number): string {
  const h = mins / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

export default function CommitmentMeter({ onRefine, onAllocate }: { onRefine?: () => void; onAllocate?: () => void }) {
  const { data } = useVertical();
  const now = useMemo(() => new Date(), []);
  const demand = portfolioDemand(data, now);
  const standing = readStanding(data, "project");
  const { weeklyAvgMins, thisWeekMins, byWeek } = useCapacity();

  // Per-week load forecast — demand spread across the weeks each project is live,
  // against that week's *realistic* capacity. Far-future weeks look artificially
  // open (one-offs aren't booked yet), so cap their free time at the near-term
  // typical; recurring meetings already on the calendar keep actual ≤ cap anyway.
  const forecast = useMemo(
    () => weekForecast(data, now, byWeek.slice(0, RIBBON_WEEKS), weeklyAvgMins),
    [data, now, byWeek, weeklyAvgMins],
  );
  const anyOver = forecast.some((f) => f.over);

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
    synthesis = `Your initiatives need ≈${fmtH(demandMins)} a week. Set your working hours to gauge that against real capacity.`;
  } else {
    const head = `Your initiatives need ≈${fmtH(demandMins)} a week against ≈${fmtH(capMins)} of open time`;
    synthesis =
      band === "over"
        ? `${head} — you're ${pct}% committed. Move a finish line, cut scope, or drop an initiative.`
        : band === "committed"
          ? `${head}. ${pct}% committed — full, but it fits.`
          : `${head}. ${pct}% committed — room to pull another initiative.`;
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

      {hasDemand && capMins > 0 && forecast.length > 1 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="section-label !p-0">Load forecast</span>
            <span className="mono text-micro text-muted">{anyOver ? "weeks over the line need a move" : "fits within capacity"}</span>
          </div>
          <div className="flex items-end gap-1 overflow-x-auto pb-0.5">
            {forecast.map((f, i) => {
              const tone = f.over ? CAUTION : READY;
              const fillFrac = Math.min(Number.isFinite(f.ratio) ? f.ratio : 1.4, 1.4) * CAP_CEILING;
              return (
                <div key={i} className="flex min-w-[26px] flex-1 flex-col items-center gap-1">
                  <div
                    className="relative w-full overflow-hidden rounded-sm"
                    style={{ height: 40, background: "var(--line)" }}
                    title={`${i === 0 ? "This week" : `${i} week${i === 1 ? "" : "s"} out`} (of ${fmtDate(toISODate(f.weekStart))}) · need ≈${fmtH(f.demandMins)} / ≈${fmtH(f.freeMins)} free${f.over ? " · over capacity" : ""}`}
                  >
                    {/* capacity ceiling — bars crossing it are over the week's open time */}
                    <div className="absolute inset-x-0" style={{ bottom: `${CAP_CEILING * 100}%`, height: 1, background: "var(--line-strong)" }} />
                    <div
                      className="fast absolute inset-x-0 bottom-0"
                      style={{ height: `${Math.min(fillFrac * 100, 100)}%`, background: tone, opacity: i === 0 ? 1 : 0.82 }}
                    />
                  </div>
                  <span className="mono text-micro" style={{ color: i === 0 ? "var(--signal)" : "var(--muted)" }}>
                    {i === 0 ? "now" : `+${i}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1.5 text-caption">
        {/* concurrency — folded in from the old WIP "Capacity" gauge: how many initiatives
            are in flight at once, and whether any lack a path. Distinct from hours. */}
        {standing.inFlight > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span style={{ color: standing.capacity === "comfortable" ? "var(--muted)" : CAUTION }}>{standing.capacityBlurb}</span>
            {standing.capacity !== "comfortable" && onAllocate && (
              <button onClick={onAllocate} className="fast group flex items-center gap-1 font-medium" style={{ color: "var(--accent)" }}>
                Triage
                <span className="fast transition-transform group-hover:translate-x-0.5">›</span>
              </button>
            )}
          </div>
        )}
        {(latent > 0 || pressing > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {pressing > 0 && (
              <span className="mono" style={{ color: CAUTION }}>
                {pressing} behind pace
              </span>
            )}
            {latent > 0 &&
              (onRefine ? (
                <button onClick={onRefine} className="fast group flex items-center gap-1 font-medium" style={{ color: "var(--accent)" }}>
                  {latent} not yet counted — groom to commit
                  <span className="fast transition-transform group-hover:translate-x-0.5">›</span>
                </button>
              ) : (
                <span className="mono text-muted">{latent} not yet counted (unsized or undated)</span>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
