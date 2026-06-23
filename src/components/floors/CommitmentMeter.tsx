// Commitment — the honest "how full is my week, really?" read. It counts what
// actually fills a week: meetings/obligations (learned from your trailing calendar)
// + the project pace your bets demand, against your weekday work window, with a
// buffer held back. A wall-to-wall meeting week reads as highly committed even
// before any project work. See docs/commitment-model.md.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { demandByWeek, portfolioDemand } from "../../lib/pace";
import { readStanding } from "../../lib/standing";
import { fmtDate, PROJECT_STATUS_COLORS } from "./parts";
import { READY } from "./ReadinessBanner";

const CAUTION = PROJECT_STATUS_COLORS.waiting; // the one caution amber, shared with the gauges
const MEET = "color-mix(in srgb, var(--muted) 42%, transparent)"; // consumed-by-meetings tone
const BUFFER_TINT = "color-mix(in srgb, var(--muted) 16%, transparent)";
const RIBBON_WEEKS = 10;
const CEIL = 0.82; // ribbon track headroom above the capacity line

type Band = "room" | "committed" | "over";
const BAND_LABEL: Record<Band, string> = { room: "Room to commit", committed: "Committed", over: "Overcommitted" };

function fmtH(mins: number): string {
  const h = Math.max(0, mins) / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CommitmentMeter({ onRefine, onAllocate }: { onRefine?: () => void; onAllocate?: () => void }) {
  const { data } = useVertical();
  const now = useMemo(() => new Date(), []);
  const demand = portfolioDemand(data, now);
  const standing = readStanding(data, "project");
  const cap = useCapacity();

  const win = cap.windowMins;
  const busy = cap.typicalBusyMins;
  const buffer = cap.bufferMins;
  const project = demand.perWeekMins;
  const focus = cap.focusBudgetMins;
  const freeAfter = win - busy - buffer - project;

  const band: Band = project > focus ? "over" : freeAfter < 0.2 * win ? "committed" : "room";
  const color = band === "over" ? CAUTION : READY;
  const committedPct = win > 0 ? Math.round(((busy + project) / win) * 100) : null;

  const latent = demand.latent.length;
  const pressing = demand.pressing.length;

  // Per-week forecast — meetings (carried forward from trailing-typical) + project
  // pace, against each week's window with the buffer ceiling.
  const forecast = useMemo(() => {
    const dem = demandByWeek(data, now, cap.byWeek.map((w) => w.weekStart));
    return cap.byWeek.slice(0, RIBBON_WEEKS).map((w, i) => {
      const wMins = Math.max(1, w.windowMins);
      const projectMins = dem[i]?.demandMins ?? 0;
      const ceiling = Math.max(0, w.windowMins - w.bufferMins);
      return {
        weekStart: w.weekStart,
        busyMins: w.busyMins,
        projectMins,
        busyFrac: Math.min(w.busyMins / wMins, 1),
        projFrac: Math.min(projectMins / wMins, 1),
        ceilFrac: ceiling / wMins,
        over: w.busyMins + projectMins > ceiling,
      };
    });
  }, [data, now, cap.byWeek]);
  const anyOver = forecast.some((f) => f.over);

  // Headline stacked bar widths (share of the window), clamped so segments fit.
  const winSafe = Math.max(1, win);
  const bFrac = Math.min(busy / winSafe, 1);
  const pFrac = Math.min(project / winSafe, 1 - bFrac);
  const buffFrac = Math.min(buffer / winSafe, 1 - bFrac - pFrac);

  // Synthesis
  let synthesis: string;
  if (win <= 0) {
    synthesis = "Set your working hours in Settings so Nuvo can gauge how full your week really is.";
  } else if (project <= 0) {
    synthesis = `Your weeks run ≈${fmtH(busy)} of meetings; after a ≈${fmtH(buffer)} buffer, ≈${fmtH(focus)} of focus remains. No project pace is committed yet — that focus is open.`;
  } else {
    const head = `Your weeks run ≈${fmtH(busy)} of meetings. After a ≈${fmtH(buffer)} buffer, ≈${fmtH(focus)} of focus remains and your bets need ≈${fmtH(project)}`;
    synthesis =
      band === "over"
        ? `${head} — over by ≈${fmtH(-freeAfter)}. Cut scope, move a finish line, or clear a meeting.`
        : band === "committed"
          ? `${head}. Nearly full — protect the buffer before pulling more.`
          : `${head}, leaving ≈${fmtH(freeAfter)} open. Room for one more bet.`;
  }

  return (
    <div className="glass-card mb-6 max-w-[920px] rounded-xl border border-line p-4" style={{ boxShadow: "var(--shadow-2)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="section-label !p-0">Commitment</span>
        {win > 0 && committedPct != null && (
          <span className="mono shrink-0 text-meta" style={{ color }}>
            {BAND_LABEL[band]} · {committedPct}%
          </span>
        )}
      </div>

      {win > 0 ? (
        <div className="mt-2.5">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }} title="meetings · project work · buffer · open">
            <div style={{ width: `${bFrac * 100}%`, background: MEET }} />
            <div className="fast" style={{ width: `${pFrac * 100}%`, background: color }} />
            <div style={{ width: `${buffFrac * 100}%`, background: BUFFER_TINT }} />
          </div>
          <div className="mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: MEET }} />≈{fmtH(busy)} meetings</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: color }} />≈{fmtH(project)} projects</span>
            <span style={{ color: "var(--ink)" }}>≈{fmtH(Math.max(0, freeAfter))} open</span>
            <span>of ≈{fmtH(win)}/wk</span>
            <span>·</span>
            <span>≈{fmtH(cap.thisWeekFocusMins)} focus left this week</span>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 h-2.5 rounded-full" style={{ background: "var(--line)" }} />
      )}

      <p className="masthead mt-3 max-w-[56ch] text-lead text-ink">{synthesis}</p>

      {win > 0 && forecast.length > 1 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="section-label !p-0">Load forecast</span>
            <span className="mono text-micro text-muted">{anyOver ? "weeks over the line need a move" : "fits within capacity"}</span>
          </div>
          <div className="flex items-end gap-1 overflow-x-auto pb-0.5">
            {forecast.map((f, i) => {
              const projTone = f.over ? CAUTION : READY;
              const bH = Math.min(f.busyFrac, 1) * CEIL * 100;
              const pH = Math.min(f.projFrac, Math.max(0, 1 - f.busyFrac)) * CEIL * 100;
              return (
                <div key={i} className="flex min-w-[26px] flex-1 flex-col items-center gap-1">
                  <div
                    className="relative w-full overflow-hidden rounded-sm"
                    style={{ height: 40, background: "var(--line)" }}
                    title={`${i === 0 ? "This week" : `${i} week${i === 1 ? "" : "s"} out`} (of ${fmtDate(toISODate(f.weekStart))}) · ≈${fmtH(f.busyMins)} meetings + ≈${fmtH(f.projectMins)} projects${f.over ? " · over capacity" : ""}`}
                  >
                    <div className="absolute inset-x-0" style={{ bottom: `${f.ceilFrac * CEIL * 100}%`, height: 1, background: "var(--line-strong)" }} />
                    <div className="absolute inset-x-0 bottom-0" style={{ height: `${bH}%`, background: MEET }} />
                    <div className="fast absolute inset-x-0" style={{ bottom: `${bH}%`, height: `${pH}%`, background: projTone, opacity: i === 0 ? 1 : 0.82 }} />
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
                  {latent} not yet counted — refine to commit
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
