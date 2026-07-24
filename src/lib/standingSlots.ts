// Standing slots — recurring time with an affinity that the weekly plan fills.
// See docs/standing-slots.md. This is "layer 0" of the plan: before clustering
// or placement, route matching in-play work INTO the user's standing slots
// (cap, don't cram; spill across occurrences), then hand the remainder to the
// composer. A slot magnetizes work iff it recurs AND declares an affinity —
// a domain (a "domain slot") or a project.
//
// (Distinct from lib/standing.ts, which is the Project/Initiative "Standing"
// assessment — unrelated.)

import type { Slot, Task } from "./types";
import { resolveDomainId } from "./batch";
import type { VerticalData } from "./vertical";

export interface StandingAssignment {
  slot: Slot;
  taskIds: string[];
  /** minutes of work routed into this occurrence (for the surfacing summary) */
  addedMins: number;
}

export interface StandingRouting {
  assignments: StandingAssignment[];
  routedTaskIds: Set<string>;
}

const PRIORITY_RANK: Record<Task["priority"], number> = { high: 0, medium: 1, low: 2, none: 3 };

/** A slot magnetizes work iff it recurs AND declares an affinity. A one-off or
 *  affinity-less slot is just a labeled container — no surprise pulls. */
export function isStandingSlot(s: Slot): boolean {
  return !!s.recurrence_id && (!!s.domain_id || !!s.project_id);
}

/** Match rule: a project slot takes that project's tasks; a domain slot takes
 *  anything whose resolved domain (task → project → initiative) is the slot's. */
function matches(task: Task, slot: Slot, data: VerticalData): boolean {
  if (slot.project_id) return task.project_id === slot.project_id;
  if (slot.domain_id) return resolveDomainId(data, task) === slot.domain_id;
  return false;
}

/**
 * Route in-play `tasks` into the planning week's standing `slots`.
 *  - `slots`         : the week's slot occurrences (we filter to standing ones)
 *  - `occupiedMins`  : minutes already inside each slot (existing children), so a
 *                      part-full slot only takes what it still has room for
 *  - fill order      : project-affinity slots first, then earliest occurrence
 *                      first — so a daily block fills today before tomorrow, and
 *                      overflow naturally spills to the next occurrence
 *  - within a slot   : match by deadline, then priority; assign until the slot's
 *                      duration is reached (CAP — never cram past reserved time)
 *
 * Tasks not routed stay in the caller's pool for normal placement.
 */
export function routeToStanding(
  tasks: Task[],
  slots: Slot[],
  occupiedMins: Map<string, number>,
  data: VerticalData,
): StandingRouting {
  const standing = slots.filter(isStandingSlot).sort((a, b) => {
    const pa = a.project_id ? 0 : 1;
    const pb = b.project_id ? 0 : 1;
    return pa - pb || a.start_time.localeCompare(b.start_time);
  });

  const pool = [...tasks].sort((a, b) => {
    const da = a.deadline ?? "9999-12-31";
    const db = b.deadline ?? "9999-12-31";
    return da.localeCompare(db) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });

  const routedTaskIds = new Set<string>();
  const assignments: StandingAssignment[] = [];

  for (const slot of standing) {
    let used = occupiedMins.get(slot.id) ?? 0;
    const cap = slot.duration_minutes;
    if (used >= cap) continue;
    const taskIds: string[] = [];
    let added = 0;
    for (const t of pool) {
      if (routedTaskIds.has(t.id)) continue;
      if (!matches(t, slot, data)) continue;
      const mins = t.duration_minutes ?? 30;
      if (used + mins > cap) continue; // leave it for the next occurrence / general placement
      routedTaskIds.add(t.id);
      taskIds.push(t.id);
      used += mins;
      added += mins;
    }
    if (taskIds.length) assignments.push({ slot, taskIds, addedMins: added });
  }

  return { assignments, routedTaskIds };
}
