// The week's intake — where the week's work is coming FROM, and whether it fits.
//
// Planning a week is one act with three sources feeding it, and until now the two
// shells named them differently and the copy named them with invented verbs
// ("Slate", "Pull", "Shape") that appear nowhere else in the product. The sources
// themselves are plain, and they are what the operator actually says out loud:
//
//   · Projects   — work belonging to a project you committed to this week
//   · Leftovers  — what you already owed (carried), what's due, what's gone quiet
//   · Inbox      — raw captures that have never been sorted
//
// …all pouring into one measured week. That's the funnel the product already has
// (inbox → backlog → Week → Day, `overview.md`); this module is the arithmetic
// behind drawing it. One implementation, both shells — the same reason
// `useWeekDraft` exists at all.

export type WeekLane = "projects" | "loose" | "inbox";

export const LANE_LABEL: Record<WeekLane, string> = {
  projects: "Projects",
  loose: "Leftovers",
  inbox: "Inbox",
};

/** The one-line question each lane answers, in the app's reporting voice. */
export const LANE_QUESTION: Record<WeekLane, string> = {
  projects: "What are you moving this week?",
  // "Leftovers" is the operator's word and the plainest one, but the lane also
  // holds work that's *due* and one small task from each quiet domain — neither is
  // literally a leftover. The question carries the honesty the label can't. (D-034)
  loose: "What didn't get done, and what's due?",
  inbox: "What came in that you haven't sorted?",
};

export const LANES: WeekLane[] = ["projects", "loose", "inbox"];

/** Enough of a task row to place it in a lane — works for `Task` and `VTask`. */
export interface LaneInput {
  project_id?: string | null;
  projectId?: string | null;
  roll_count?: number | null;
  rollCount?: number | null;
  status?: string | null;
  /** `VTask`'s flag for a raw capture — the row form uses `status === "inbox"`. */
  inbox?: boolean;
}

/**
 * Which lane a piece of work belongs to. Order matters and is deliberate:
 *
 *  1. **Carried beats everything.** A slipped task that belongs to a week's
 *     project is still, to the person looking at it, a leftover to re-time — not
 *     a fresh push. Burying it under its project is how carry-forward stopped
 *     being a decision and started being noise.
 *  2. **Unsorted captures are the inbox**, wherever they end up placed.
 *  3. Anything project-attached is the point of the week.
 *  4. Everything else (deadlines, quiet-domain top-ups) is a loose end.
 */
export function laneOf(t: LaneInput): WeekLane {
  const rolled = t.roll_count ?? t.rollCount ?? 0;
  if (rolled > 0) return "loose";
  if (t.status === "inbox" || t.inbox) return "inbox";
  if (t.project_id ?? t.projectId) return "projects";
  return "loose";
}

export interface LaneRead {
  count: number;
  mins: number;
}

export interface WeekIntakeRead {
  projects: LaneRead;
  loose: LaneRead;
  inbox: LaneRead;
  /** Minutes already on the calendar before this plan — immovable, but real. */
  blockedMins: number;
  /**
   * Everything the week would carry once committed: the immovable calendar plus
   * every kept piece of work. Deliberately *not* "minutes that found a time slot"
   * — the Week is the gate (Principle 2), so work that joins the pool without a
   * block is still weight you agreed to carry, and hiding it would flatter the plan.
   */
  loadMins: number;
  /** The proven weekly pace (+ room to grow), or null with no history yet. */
  budgetMins: number | null;
  /** How far past the proven pace the load runs. 0 when it fits or is unknown. */
  overMins: number;
  /** Track width in minutes — the budget, stretched when the load exceeds it. */
  trackMins: number;
}

export interface IntakeTask extends LaneInput {
  duration_minutes?: number | null;
  durationMins?: number | null;
}

export function readIntake(
  tasks: IntakeTask[],
  opts: { blockedMins: number; budgetMins: number | null },
): WeekIntakeRead {
  const zero = (): LaneRead => ({ count: 0, mins: 0 });
  const lanes: Record<WeekLane, LaneRead> = { projects: zero(), loose: zero(), inbox: zero() };
  for (const t of tasks) {
    const lane = lanes[laneOf(t)];
    lane.count += 1;
    lane.mins += t.duration_minutes ?? t.durationMins ?? 30;
  }
  const { blockedMins, budgetMins } = opts;
  const loadMins = blockedMins + lanes.projects.mins + lanes.loose.mins + lanes.inbox.mins;
  return {
    ...lanes,
    blockedMins,
    loadMins,
    budgetMins,
    overMins: budgetMins != null ? Math.max(0, loadMins - budgetMins) : 0,
    trackMins: Math.max(budgetMins ?? 0, loadMins, 60),
  };
}

/**
 * The compact badge a row wears instead of its reason sentence.
 *
 * The flow is read every week. "slipped 10× — give it a new time" is a useful
 * sentence the first time and pure friction the fiftieth; `↻10` is the same fact
 * in two glyphs, and the sentence survives as the row's `title` for anyone who
 * wants it. Returns null when the reason is already implied by where the row sits
 * (project work under its project's name).
 */
export function workBadge(
  kind: "carried" | "project" | "lead" | "due" | "quiet",
  task: { rollCount?: number | null; deadlineDaysAway?: number | null },
): { text: string; urgent: boolean } | null {
  switch (kind) {
    case "carried":
      return { text: `↻${task.rollCount ?? 1}`, urgent: (task.rollCount ?? 0) >= 3 };
    case "due": {
      const d = task.deadlineDaysAway;
      if (d == null) return { text: "due", urgent: true };
      return d <= 0 ? { text: "overdue", urgent: true } : { text: `${d}d`, urgent: d <= 2 };
    }
    case "quiet":
      return { text: "quiet", urgent: false };
    case "lead":
      return { text: "★", urgent: false };
    case "project":
      return null;
  }
}
