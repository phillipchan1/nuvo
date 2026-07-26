// The "what work does a priority own, and how is it tracking" rule — lifted out
// of the bigRocks editor so the Week's Plan / Review (composeWeek) and the editor
// share one definition. A priority (big rock) owns tasks directly via
// tasks.big_rock_id, and can optionally spotlight a linked bet/project's work.

import { initiativeById, isProjectInFlight, projectById, tasksOf, type Project, type VerticalData, type VTask } from "./vertical";
import { portfolioDemand, type ProjectPace } from "./pace";
import { isCompleteStatus, isOnDeckThisWeek, isOnSlate } from "../../supabase/functions/_shared/planningRules.ts";
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

// ── what's on deck for a week — the ONE definition ───────────────────────────
// On Deck owns *when* a project happens: dragging it onto a week writes its
// committed span (start_date → target_date). So the week's pushes are DERIVED
// from that span, never stored. A stored membership list is what let Sunday drift
// from the board (showing a project you'd already moved to another week, and
// missing one you'd moved in). No span at all = "needs a week" — not on deck.
//
// The sprint's big_rocks jsonb survives ONLY as the per-week verdict (landed /
// carried), looked up by project_id — that's the one fact a project can't tell
// you, since a push landing isn't the project finishing. For PAST weeks the
// snapshot is the historical record and must NOT be re-derived (that would
// rewrite what you actually committed to back then).

// The membership rules themselves live in the planning kernel
// (supabase/functions/_shared/planningRules.ts) — the agent derives the week
// from the same file, so the chat and the UI cannot disagree about what is on
// this week. Everything below is the client's *shape* over those rules.

/** The projects you can still WORK on this week — open, committed to this week.
 *  This is the planning/pull question ("what should I pull from?"), so shipped
 *  and dropped projects are correctly gone. For the week's SCOREBOARD, which
 *  must keep what you shipped, use `weekPushes`. */
export function projectsOnDeck(d: VerticalData, weekStartISO: string): Project[] {
  return d.projects.filter((p) => isOnDeckThisWeek(p, weekStartISO));
}

/** A push: a project committed to this week, plus its stored verdict. */
export interface WeekPush {
  project: Project;
  rock: BigRock | null; // the verdict record, if one exists yet
  done: boolean;
  /** shipped inside this week — the loudest possible verdict. */
  shipped: boolean;
}

/** The week's SLATE — what you committed to this week, derived from the spans,
 *  joined to the stored verdict.
 *
 *  Deliberately NOT `projectsOnDeck`: that drops anything complete, so shipping
 *  a project on Wednesday used to erase it from the week's plan and quietly
 *  shrink "N of M landed" — finishing your biggest thing made the scoreboard
 *  forget it. A project that shipped *inside* this week stays on this week's
 *  slate and reads as the win it is; one that shipped in an earlier week is
 *  correctly gone. */
export function weekPushes(d: VerticalData, weekStartISO: string): WeekPush[] {
  return d.projects
    .filter((p) => isOnSlate(p, weekStartISO))
    .map((project) => {
      const rock = d.bigRocks.find((r) => r.project_id === project.id) ?? null;
      const shipped = isCompleteStatus(project.status);
      // Shipping the project inside the week says the week moved it, louder than
      // the checkbox does — so it READS landed. Display only: shipping never
      // writes the verdict, so un-shipping simply reveals the verdict again.
      return { project, rock, done: Boolean(rock?.done_at) || shipped, shipped };
    });
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
  /** Slipping projects that AREN'T groomed yet. Bring-in-able as a NOT-READY Push —
   *  the Sunday card's gate then lets you groom it on the spot or push it out. */
  ungroomed: ProposedPriority[];
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
  const ungroomed: ProposedPriority[] = [];
  const seen = new Set<string>();
  const add = (project: Project, reason: string): boolean => {
    if (seen.has(project.id) || boundProjectIds.has(project.id)) return false;
    seen.add(project.id);
    if (!isTended(d, "project", project.id)) { ungroomed.push({ project, reason, win: project.outcome }); return false; }
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

  return { groomed: groomed.slice(0, limit), ungroomed: ungroomed.slice(0, limit) };
}
