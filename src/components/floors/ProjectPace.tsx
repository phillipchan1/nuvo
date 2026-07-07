// The pace read — a project as a weekly rate and its drift against the target.
// Lifted out of the (retired) full-page ProjectFloor so the Record modal is the
// one place a project is viewed. Pure display over projectPace().

import { projectPace, type PaceRead, type ProjectPace } from "../../lib/pace";
import type { Project, VerticalData } from "../../lib/vertical";

const PACE_TONE: Record<PaceRead, "signal" | "accent" | "muted"> = {
  behind: "signal",
  overdue: "signal",
  stalled: "signal",
  ahead: "accent",
  on_track: "accent",
  undated: "muted",
  clear: "muted",
};

function hrs(mins: number): string {
  const h = mins / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

function driftPhrase(days: number, word: "behind" | "ahead"): string {
  if (days >= 14) return `${Math.round(days / 7)} wks ${word}`;
  if (days >= 7) return `1 wk ${word}`;
  return `${days}d ${word}`;
}

function paceVerdict(p: ProjectPace): string {
  switch (p.read) {
    case "behind":
      return driftPhrase(p.driftDays ?? 0, "behind");
    case "ahead":
      return driftPhrase(-(p.driftDays ?? 0), "ahead");
    case "on_track":
      return "on pace";
    case "overdue":
      return `${p.driftDays}d overdue`;
    case "stalled":
      return "stalled — no recent motion";
    case "undated":
      return "no finish line yet — set a target to pace it";
    case "clear":
      return "no open work to pace";
  }
}

export function ProjectPaceLine({ data, project, accent }: { data: VerticalData; project: Project; accent: string }) {
  const pace = projectPace(data, project, new Date());
  const tone = PACE_TONE[pace.read] === "signal" ? "var(--signal)" : PACE_TONE[pace.read] === "accent" ? accent : "var(--muted)";

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      {pace.read === "undated" || pace.read === "clear" ? (
        <span className="text-label text-muted">{paceVerdict(pace)}</span>
      ) : (
        <>
          {pace.read !== "overdue" && pace.requiredMinsPerWeek > 0 && (
            <span className="mono text-label text-muted">
              <span className="text-ink">~{hrs(pace.requiredMinsPerWeek)}/wk</span> to finish on time
            </span>
          )}
          <span className="mono text-label text-muted">{hrs(pace.remainingMins)} left</span>
          {pace.recentMinsPerWeek > 0 && <span className="mono text-label text-muted">~{hrs(pace.recentMinsPerWeek)}/wk lately</span>}
          <span className="mono ml-auto flex items-center gap-1.5 text-label" style={{ color: tone }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
            {paceVerdict(pace)}
          </span>
        </>
      )}
    </div>
  );
}
