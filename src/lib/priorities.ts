// The "what work does a priority own, and how is it tracking" rule — lifted out
// of the bigRocks editor so the Week's Plan / Review (composeWeek) and the editor
// share one definition. A priority (big rock) owns tasks directly via
// tasks.big_rock_id, and can optionally spotlight a linked bet/project's work.

import { initiativeById, isProjectInFlight, projectById, tasksOf, type Project, type VerticalData, type VTask } from "./vertical";
import { portfolioDemand, type ProjectPace } from "./pace";
import { isTended } from "./tending";
import type { BigRock } from "./types";

export interface RockWork {
  tasks: VTask[]; // everything serving the rock (done included)
  done: number;
  total: number;
  scheduledMins: number;
  pullable: VTask[]; // existing project/bet work, ready, not yet pulled in
  label: string | null; // the linked project/bet name
}

export function priorityWork(data: VerticalData, rock: BigRock): RockWork {
  const init = initiativeById(data, rock.initiative_id);
  const proj = projectById(data, rock.project_id ?? null);
  const serves = (t: VTask) =>
    t.bigRockId === rock.id ||
    (proj != null && t.projectId === proj.id) ||
    (init != null && (t.initiativeId === init.id || (t.projectId ? projectById(data, t.projectId)?.initiativeId === init.id : false)));
  const tasks = data.tasks.filter(serves);
  return {
    tasks,
    done: tasks.filter((t) => t.status === "done").length,
    total: tasks.length,
    scheduledMins: tasks.filter((t) => t.status === "scheduled").reduce((s, t) => s + t.durationMins, 0),
    pullable: tasks.filter((t) => t.bigRockId !== rock.id && t.status === "ready" && !t.sprint),
    label: proj?.name ?? init?.name ?? null,
  };
}

/** A priority's verdict for the Review / forming Plan. */
export type PriorityVerdict = "landed" | "carried" | "open";

/**
 * The reckoning for one priority:
 *  - landed  → checked off this week (`done_at` set)
 *  - carried → unfinished but already rolled from a prior week (`roll_count > 0`)
 *  - open    → unfinished, first week
 */
export function priorityVerdict(rock: BigRock): PriorityVerdict {
  if (rock.done_at) return "landed";
  return rock.roll_count > 0 ? "carried" : "open";
}

// ── "Projects asking for you" — the bottom-up feed ───────────────────────────
// The timeline already knows which projects are slipping (portfolioDemand) or
// due to start. Surface those as one-tap priority proposals on Sunday — but ONLY
// fully-groomed ones (isTended = structurally active AND Nuvo-verified sound), so
// what we bring in carries real durations, never the 30-min default fiction.

export interface ProposedPriority {
  project: Project;
  reason: string; // why it's asking — "6d overdue", "behind pace", "starts this week"
  win: string; // the project's outcome, as a starting "what done looks like"
}

export interface PriorityProposals {
  /** Groomed (tended + sound) projects — one tap brings them in with real durations. */
  groomed: ProposedPriority[];
  /** Slipping projects that AREN'T groomed yet — count only. We won't bring in
   *  fiction, but we name them so the human knows to refine them first. */
  ungroomed: number;
}

function pressReason(p: ProjectPace): string {
  if (p.read === "overdue") return p.daysLeft != null ? `${Math.abs(p.daysLeft)}d overdue` : "overdue";
  if (p.read === "stalled") return "stalled · no recent motion";
  if (p.read === "behind") return p.driftDays != null ? `behind · ~${p.driftDays}d late at this pace` : "behind pace";
  return "needs attention";
}

/** The bottom-up feed for Sunday: groomed projects that deserve to be this week's
 *  priorities — slipping ones first (worst drift), then ones due to start — plus a
 *  count of slipping-but-ungroomed ones. Excludes anything already bound this week. */
export function proposedPriorities(
  d: VerticalData,
  now: Date,
  boundProjectIds: Set<string>,
  limit = 4,
): PriorityProposals {
  const groomed: ProposedPriority[] = [];
  const seen = new Set<string>();
  let ungroomed = 0;
  const add = (project: Project, reason: string): boolean => {
    if (seen.has(project.id) || boundProjectIds.has(project.id)) return false;
    seen.add(project.id);
    if (!isTended(d, "project", project.id)) { ungroomed++; return false; } // refine first — no fiction
    groomed.push({ project, reason, win: project.outcome });
    return true;
  };

  // 1) Slipping — behind / overdue / stalled, already sorted worst-first.
  for (const { project, pace } of portfolioDemand(d, now).pressing) add(project, pressReason(pace));

  // 2) Due to start — in flight, a start date within the next week, work remaining.
  //    (Ungroomed starters don't add to the nudge — that's reserved for slippage.)
  const soon = now.getTime() + 7 * 86_400_000;
  for (const project of d.projects) {
    if (!isProjectInFlight(project.status) || !project.startDate) continue;
    const start = new Date(project.startDate + "T00:00:00").getTime();
    if (Number.isNaN(start) || start > soon) continue;
    if (!tasksOf(d, project.id).some((t) => t.status !== "done")) continue;
    if (seen.has(project.id) || boundProjectIds.has(project.id)) continue;
    if (isTended(d, "project", project.id)) { seen.add(project.id); groomed.push({ project, reason: "starts this week", win: project.outcome }); }
  }

  return { groomed: groomed.slice(0, limit), ungroomed };
}
