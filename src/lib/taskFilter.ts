// The browser's adapter onto the task-query kernel.
//
// The kernel (`_shared/taskQuery.ts`) is pure and knows nothing about labels,
// the vertical, or what day it is. This file is the only place that resolves
// those three things for it — so every surface that filters tasks does it
// through one predicate with one idea of "this week".
//
// It deliberately defines NO rule of its own. `tests/planning-kernel.test.ts`
// fails if it grows one.

import { planningWeekStartISO, toDateISO } from "./dates";
import { taskDomainId, type VerticalData } from "./vertical";
import type { Task } from "./types";
import {
  matchesQuery,
  type QueryClock,
  type TaskFacets,
  type TaskQuery,
} from "../../supabase/functions/_shared/taskQuery.ts";

export type { TaskQuery, SavedView, WhenWindow } from "../../supabase/functions/_shared/taskQuery.ts";
export {
  describeQuery,
  isEmptyQuery,
  MAX_SAVED_VIEWS,
  queryFacetCount,
  WHEN_WINDOWS,
} from "../../supabase/functions/_shared/taskQuery.ts";

/** The clock a query is asked against. The week comes from the planning kernel,
 *  never from a local `startOfWeek` — a filter must not invent a second idea of
 *  which week it is (that drift is exactly what the kernel exists to stop). */
export function queryClock(now: Date): QueryClock {
  const weekStart = planningWeekStartISO(now);
  const [y, m, d] = weekStart.split("-").map(Number);
  const sunday = new Date(Date.UTC(y, m - 1, d + 6));
  const p = (v: number) => String(v).padStart(2, "0");
  return {
    today: toDateISO(now),
    weekStart,
    weekEnd: `${sunday.getUTCFullYear()}-${p(sunday.getUTCMonth() + 1)}-${p(sunday.getUTCDate())}`,
    nowMs: now.getTime(),
  };
}

/** The two facts about a task that live outside its row.
 *
 *  `domainId` goes through `taskDomainId`, never `task.domain_id` — the column
 *  is a denormalized copy that goes stale the moment a project is re-homed, and
 *  reading it directly is how four projects' hours ended up credited to the
 *  wrong domains (D-088). */
export function facetsFor(t: Task, vertical: VerticalData | undefined): TaskFacets {
  return {
    labelIds: (t.task_labels ?? []).map((l) => l.label_id),
    domainId: vertical ? taskDomainId(vertical, t) : (t.domain_id ?? null),
  };
}

/** Filter a list. One call site's worth of plumbing, so no surface has to
 *  remember to resolve facets or build a clock. */
export function filterTasks(
  tasks: Task[],
  query: TaskQuery | null | undefined,
  vertical: VerticalData | undefined,
  now: Date,
): Task[] {
  if (!query) return tasks;
  const clock = queryClock(now);
  return tasks.filter((t) => matchesQuery(t, query, facetsFor(t, vertical), clock));
}

/** A stable key for a query — lets a memo depend on the question rather than on
 *  the object identity of a freshly-built one. */
export const queryKey = (q: TaskQuery | null | undefined): string => JSON.stringify(q ?? {});
