// The suggested weekly pull — rankNow generalized to a week. Pure heuristic,
// always shown as a proposal to prune, never auto-committed (the agent
// proposes; only you promote work toward the calendar).

import { fmtHours } from "./dates";
import { projectsOnDeck } from "./priorities";
import {
  backlogTasks,
  domainById,
  faithfulness,
  inboxTasks,
  initiativeById,
  isProjectComplete,
  isProjectInFlight,
  nextUpTask,
  projectById,
  tasksOf,
  weeklyCapacityHours,
  type VerticalData,
  type VTask,
} from "./vertical";

/** Why a piece of work is being suggested. Typed, not inferred from the reason
 *  string, so a surface can render a two-glyph badge (`↻10`, `2d`) instead of a
 *  sentence — the flow is read weekly, and prose you've read fifty times is noise. */
export type PullKind = "carried" | "project" | "lead" | "due" | "quiet";

export interface PullSuggestion {
  task: VTask;
  /** the long form, kept for tooltips and for the surfaces that have room */
  reason: string;
  kind: PullKind;
  /** the on-deck project whose work this is — the rail groups by it */
  projectId?: string | null;
}

/** `weekStartISO` turns on the primary source: the projects On Deck committed to
 *  that week. Without it the pull can only guess from deadlines + faithfulness —
 *  which is how a fully-groomed week used to yield a single unrelated task. */
export function suggestPull(d: VerticalData, weekStartISO?: string): PullSuggestion[] {
  const picked = new Map<string, PullSuggestion>();

  // On Deck decides WHEN a project happens, so it also decides when its work
  // happens. Without this, a deadline or a slip could drag a task back into a
  // week you'd deliberately pushed its project out of — which made "push it out"
  // a lie. A project with no week at all ("needs a week") is not this week's
  // either. Loose work (no project) still answers to deadlines/faithfulness.
  const onDeck = weekStartISO ? new Set(projectsOnDeck(d, weekStartISO).map((p) => p.id)) : null;
  const elsewhere = (task: VTask) => onDeck != null && task.projectId != null && !onDeck.has(task.projectId);

  const add = (task: VTask | null, reason: string, kind: PullKind, projectId?: string | null) => {
    if (!task || task.sprint || task.status === "done" || picked.has(task.id)) return;
    if (elsewhere(task)) return; // its project isn't on deck this week
    picked.set(task.id, { task, reason, kind, projectId: projectId ?? task.projectId ?? null });
  };

  // 1 · SLIPPED — already-owed commitments, re-timed first. (The carry-forward
  //     feed; exempt from the cap below, since it's debt, not a fresh pull.)
  const slipped = d.tasks
    .filter((t) => t.rollCount > 0 && t.status === "ready" && !t.inbox)
    .sort((a, b) => b.rollCount - a.rollCount);
  for (const t of slipped) add(t, `slipped ${t.rollCount}× — give it a new time`, "carried");

  // 2 · THE WEEK'S PROJECTS — the pushes you named on Set the week (derived from
  //     On Deck). Their open work IS the point of the week, so it comes before
  //     anything discretionary. This is the bridge between the two steps: naming
  //     a project has to bring its work with it, or Shape it has nothing to place.
  if (weekStartISO) {
    for (const p of projectsOnDeck(d, weekStartISO)) {
      for (const t of tasksOf(d, p.id)) {
        if (t.status === "done" || t.inbox) continue;
        add(t, `${p.name} moves this week`, "project", p.id);
      }
    }
  }

  // 3 · the lead bets: the next-up task of every active project under a
  //     focus initiative — the right next step, not a random middle.
  for (const initId of d.focusInitiativeIds) {
    const init = initiativeById(d, initId);
    if (!init || !isProjectInFlight(init.status)) continue;
    for (const p of d.projects.filter((p) => p.initiativeId === initId && !isProjectComplete(p.status))) {
      add(nextUpTask(d, p.id), `next up in ${p.name} (★ lead)`, "lead");
    }
  }

  // 4 · deadlines that land inside this week.
  for (const t of [...backlogTasks(d), ...inboxTasks(d)]) {
    if (t.deadlineDaysAway != null && t.deadlineDaysAway <= 7) {
      add(t, t.deadlineDaysAway <= 0 ? "deadline passed" : `due in ${t.deadlineDaysAway}d`, "due");
    }
  }

  // 5 · faithfulness: one small task from each domain that's going quiet.
  for (const domain of d.domains) {
    if (faithfulness(domain).lit) continue;
    const candidates = d.tasks
      .filter((t) => t.domainId === domain.id && t.status !== "done" && !t.sprint && !picked.has(t.id))
      .sort((a, b) => a.durationMins - b.durationMins);
    add(candidates[0] ?? null, `${domain.name} has been quiet ${domain.lastTouchedDays}d`, "quiet");
  }

  // cap the proposal at ~60% of weekly capacity — a starting pull, not a full
  // week. Slipped work is exempt: it's already-owed commitments, not a fresh pull,
  // so it always comes back even if it pushes past the soft cap.
  const slippedIds = new Set(slipped.map((t) => t.id));
  const capMins = weeklyCapacityHours(d) * 60 * 0.6 || 12 * 60;
  const out: PullSuggestion[] = [];
  let load = 0;
  for (const s of picked.values()) {
    const owed = slippedIds.has(s.task.id);
    if (!owed && load + s.task.durationMins > capMins && out.length > 0) continue;
    out.push(s);
    load += s.task.durationMins;
  }
  return out;
}

/** One-line summary for the suggestion strip. */
export function pullSummary(d: VerticalData, suggestions: PullSuggestion[]): string {
  const mins = suggestions.reduce((s, x) => s + x.task.durationMins, 0);
  const domains = new Set(
    suggestions.map((s) => domainById(d, s.task.domainId)?.name).filter(Boolean),
  );
  const projects = new Set(
    suggestions.map((s) => projectById(d, s.task.projectId)?.name).filter(Boolean),
  );
  return `${fmtHours(mins)}h across ${domains.size} domain${domains.size === 1 ? "" : "s"}, ${projects.size} project${projects.size === 1 ? "" : "s"}`;
}
