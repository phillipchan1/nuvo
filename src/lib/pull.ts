// The suggested weekly pull — rankNow generalized to a week. Pure heuristic,
// always shown as a proposal to prune, never auto-committed (the agent
// proposes; only you promote work toward the calendar).

import { fmtHours } from "./dates";
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
  weeklyCapacityHours,
  type VerticalData,
  type VTask,
} from "./vertical";

export interface PullSuggestion {
  task: VTask;
  reason: string;
}

export function suggestPull(d: VerticalData): PullSuggestion[] {
  const picked = new Map<string, PullSuggestion>();
  const add = (task: VTask | null, reason: string) => {
    if (!task || task.sprint || task.status === "done" || picked.has(task.id)) return;
    picked.set(task.id, { task, reason });
  };

  // 1 · the lead bets: the next-up task of every active project under a
  //     focus initiative — the right next step, not a random middle.
  for (const initId of d.focusInitiativeIds) {
    const init = initiativeById(d, initId);
    if (!init || !isProjectInFlight(init.status)) continue;
    for (const p of d.projects.filter((p) => p.initiativeId === initId && !isProjectComplete(p.status))) {
      add(nextUpTask(d, p.id), `next up in ${p.name} (★ lead)`);
    }
  }

  // 2 · deadlines that land inside this week.
  for (const t of [...backlogTasks(d), ...inboxTasks(d)]) {
    if (t.deadlineDaysAway != null && t.deadlineDaysAway <= 7) {
      add(t, t.deadlineDaysAway <= 0 ? "deadline passed" : `due in ${t.deadlineDaysAway}d`);
    }
  }

  // 2.5 · slipped commitments: work that's already rolled forward and still has
  //       no time. Bundle it back in so replanning RE-TIMES it, instead of letting
  //       it quietly age out on Today. Most-slipped first. (The carry-forward feed.)
  const slipped = d.tasks
    .filter((t) => t.rollCount > 0 && t.status === "ready" && !t.inbox)
    .sort((a, b) => b.rollCount - a.rollCount);
  for (const t of slipped) add(t, `slipped ${t.rollCount}× — give it a new time`);

  // 3 · faithfulness: one small task from each domain that's going quiet.
  for (const domain of d.domains) {
    if (faithfulness(domain).lit) continue;
    const candidates = d.tasks
      .filter((t) => t.domainId === domain.id && t.status !== "done" && !t.sprint && !picked.has(t.id))
      .sort((a, b) => a.durationMins - b.durationMins);
    add(candidates[0] ?? null, `${domain.name} has been quiet ${domain.lastTouchedDays}d`);
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
