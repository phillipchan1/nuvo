// The "what work does a priority own, and how is it tracking" rule — lifted out
// of the bigRocks editor so the Week's Plan / Review (composeWeek) and the editor
// share one definition. A priority (big rock) owns tasks directly via
// tasks.big_rock_id, and can optionally spotlight a linked bet/project's work.

import { initiativeById, projectById, type VerticalData, type VTask } from "./vertical";
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
