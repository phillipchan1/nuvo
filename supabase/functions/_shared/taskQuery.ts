// The task-query kernel — ONE definition of "does this task match this
// question", for BOTH runtimes.
//
// The audit's rank-6 finding was that Nuvo had no filters at all: fixed tabs,
// and no way to ask "@errand + high + due this week". The obvious fix is a
// filter bar per surface, and that is exactly how the rail, the collection
// table and the chat would end up disagreeing about what "this week" means —
// the same class of bug the planning kernel exists to prevent. So the predicate
// lives here, once, and every surface calls it.
//
// The same constraints as `planningRules.ts` apply and must not be broken:
//   1 · ZERO imports. Deno resolves no bare specifiers here.
//   2 · Pure. No I/O, no clock — "today" is passed IN, never read. A predicate
//       that reads the wall clock cannot be tested at a date boundary, and a
//       saved view that means something different on the server than in the
//       browser is worse than no saved views.
//   3 · Under `supabase/functions/_shared/` because the edge bundler only
//       guarantees that path. Read it as "shared kernel", not "server code".
//
// **A saved view holds a question, not an answer.** Every date in a TaskQuery
// is RELATIVE (`this_week`, `overdue`, `undated`) rather than an ISO range, so
// "Due this week" still means this week next month. An absolute range saved in
// a view is stale the day after you save it; there is deliberately no way to
// express one.
//
// It is also not a new pool (P10). A TaskQuery adds no noun to the funnel — it
// is a lens over the tasks that already exist, and a saved one is a row in
// `user_settings`, not a table.

// ── the vocabulary ───────────────────────────────────────────────────────────

export type QueryStatus = "open" | "done" | "any";

/** Relative date windows. Relative on purpose — see the header. */
export type WhenWindow =
  | "any"
  | "overdue"
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_week"
  | "undated";

export const WHEN_WINDOWS: WhenWindow[] = [
  "any",
  "overdue",
  "today",
  "tomorrow",
  "this_week",
  "next_week",
  "undated",
];

/** Which date the window is asked about: when you'll DO it, or when it's DUE. */
export type DateField = "do_date" | "deadline";

/**
 * One question about a task list. Every field is optional and every present
 * field NARROWS — the empty query matches every open task, which is what makes
 * "clear filters" a single value rather than a special case.
 *
 * Within a field the match is ANY-of (a task with either label matches
 * `labelIds: [a, b]`); across fields it is ALL-of. That is the shape people
 * expect from every list tool and the one that reads correctly aloud:
 * "errands or calls, that are high priority, due this week".
 */
export interface TaskQuery {
  /** Substring, case-insensitive, over the title — and the notes body when
   *  `deep` is on. Split on whitespace: every word must appear somewhere. */
  text?: string;
  /** Search the notes body too, not just the title. */
  deep?: boolean;
  labelIds?: string[];
  priorities?: string[];
  /** Defaults to "open" — a filter is a working question, not an archive one. */
  status?: QueryStatus;
  projectIds?: string[];
  /** The domain a task's hours COUNT toward — resolved by the caller via
   *  `taskDomainId`, never read off `task.domain_id`, which is a denormalized
   *  copy that goes stale when a project is re-homed (D-088). */
  domainIds?: string[];
  energies?: string[];
  when?: WhenWindow;
  /** Which date `when` applies to. Defaults to `do_date`. */
  dateField?: DateField;
}

/** As much of a task as a query needs to see. The client's `Task` matches
 *  structurally; the server maps its row into this shape. */
export interface QueryableTask {
  title: string;
  notes?: string | null;
  status: string;
  priority?: string | null;
  energy?: string | null;
  do_date?: string | null;
  deadline?: string | null;
  project_id?: string | null;
  /** Needed by "overdue", which is not a date comparison — see `isOverdue`. */
  start_time?: string | null;
  duration_minutes?: number | null;
}

/** The facts about a task that live outside its row — resolved by the caller,
 *  because both of them require data this kernel is forbidden to reach for. */
export interface TaskFacets {
  /** Label ids on the task (from the `task_labels` join). */
  labelIds: string[];
  /** Where the task's hours actually count — `taskDomainId`, NOT `domain_id`. */
  domainId: string | null;
}

/** Today and the week, passed in rather than computed, so the predicate is
 *  pure and testable at a boundary. `weekStart`/`weekEnd` are the PLANNING
 *  week (Monday-based, from the planning kernel) — a filter must not invent a
 *  second idea of which week it is. */
export interface QueryClock {
  today: string; // 'YYYY-MM-DD'
  weekStart: string; // 'YYYY-MM-DD', Monday
  weekEnd: string; // 'YYYY-MM-DD', the Sunday, inclusive
  /** `now` as epoch ms — "overdue" is a clock question, not a date one. */
  nowMs: number;
}

// ── the predicate ────────────────────────────────────────────────────────────

/** Grace after a block's END before it counts as late. An hour, because a
 *  meeting that ran long is not a slipped commitment. */
export const OVERDUE_GRACE_MS = 60 * 60_000;

/**
 * **The** overdue rule, for every surface and both runtimes.
 *
 * It moved here from `src/lib/dates.ts` because the filter needed it and a
 * second definition would have put two meanings of one word in the same panel
 * (P11): the rail's "Overdue" section counts a block that ran an hour past its
 * end, while a naive filter would have counted a past `do_date`. Both are real
 * — a task dated last Tuesday IS late, and so is the 9am block it's now 2pm on
 * — so overdue is the union, defined once.
 *
 * Not done, not undated, and never a task whose only claim is that it's dated
 * today: today is not late.
 */
export function isOverdue(
  task: { start_time?: string | null; duration_minutes?: number | null; do_date?: string | null; status?: string },
  nowMs: number,
  today?: string,
): boolean {
  if (task.status === "done" || task.status === "trashed") return false;
  if (task.start_time) {
    const end = new Date(task.start_time).getTime() + (task.duration_minutes ?? 30) * 60_000;
    if (nowMs > end + OVERDUE_GRACE_MS) return true;
  }
  // A date that has passed is late whether or not it was ever given a time.
  return !!(today && task.do_date && task.do_date < today);
}

const addDaysISO = (iso: string, n: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(t);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
};

/** Does `date` fall in `window`, relative to `clock`? A null date is only ever
 *  matched by "undated" and "any" — an undated task is not overdue, and it is
 *  not "this week" either. Calling it overdue is how a backlog turns into a
 *  wall of red that means nothing. */
export function matchesWindow(date: string | null | undefined, window: WhenWindow, clock: QueryClock): boolean {
  if (window === "any") return true;
  if (window === "undated") return !date;
  if (!date) return false;
  switch (window) {
    case "overdue":
      // Date-only half of the rule; `matchesQuery` also asks `isOverdue`, which
      // catches a block that ran past its end on a day that hasn't passed yet.
      return date < clock.today;
    case "today":
      return date === clock.today;
    case "tomorrow":
      return date === addDaysISO(clock.today, 1);
    case "this_week":
      return date >= clock.weekStart && date <= clock.weekEnd;
    case "next_week":
      return date >= addDaysISO(clock.weekStart, 7) && date <= addDaysISO(clock.weekEnd, 7);
  }
}

const anyOf = (want: string[] | undefined, have: string | null | undefined): boolean =>
  !want || want.length === 0 || (have != null && want.includes(have));

/** The one predicate. Every surface that filters tasks calls this. */
export function matchesQuery(
  task: QueryableTask,
  query: TaskQuery,
  facets: TaskFacets,
  clock: QueryClock,
): boolean {
  // Trashed is never a filter result — the trash is its own face, reached
  // deliberately. A query that surfaced deleted rows would make "clear filters"
  // a data-recovery tool by accident.
  if (task.status === "trashed") return false;

  const status = query.status ?? "open";
  if (status === "open" && task.status === "done") return false;
  if (status === "done" && task.status !== "done") return false;

  if (!anyOf(query.priorities, task.priority)) return false;
  if (!anyOf(query.energies, task.energy)) return false;
  if (!anyOf(query.projectIds, task.project_id)) return false;
  if (!anyOf(query.domainIds, facets.domainId)) return false;

  if (query.labelIds && query.labelIds.length > 0) {
    if (!query.labelIds.some((id) => facets.labelIds.includes(id))) return false;
  }

  if (query.when && query.when !== "any") {
    const field = query.dateField ?? "do_date";
    const date = field === "deadline" ? task.deadline : task.do_date;
    // "Overdue" is the APP's overdue — the union rule above — not a date
    // comparison, so a block that ran past its end today counts even though
    // its date hasn't passed. Two meanings of that word in one panel was the
    // bug (P11); this is the line that keeps there being one.
    const late = query.when === "overdue" && field === "do_date" && isOverdue(task, clock.nowMs, clock.today);
    if (!late && !matchesWindow(date, query.when, clock)) return false;
  }

  const text = query.text?.trim().toLowerCase();
  if (text) {
    const hay = (task.title + (query.deep ? " " + (task.notes ?? "") : "")).toLowerCase();
    for (const word of text.split(/\s+/)) if (!hay.includes(word)) return false;
  }

  return true;
}

/** True when the query asks nothing — every field empty or at its default. Used
 *  to decide whether a surface is "filtered" (and must say so). */
export function isEmptyQuery(q: TaskQuery | null | undefined): boolean {
  if (!q) return true;
  return (
    !q.text?.trim() &&
    !q.labelIds?.length &&
    !q.priorities?.length &&
    !q.projectIds?.length &&
    !q.domainIds?.length &&
    !q.energies?.length &&
    (!q.when || q.when === "any") &&
    (!q.status || q.status === "open")
  );
}

/** How many things a query asks — the count a surface shows on its filter
 *  control, so "why is my list short" is answerable without opening anything. */
export function queryFacetCount(q: TaskQuery | null | undefined): number {
  if (!q) return 0;
  let n = 0;
  if (q.text?.trim()) n++;
  if (q.labelIds?.length) n++;
  if (q.priorities?.length) n++;
  if (q.projectIds?.length) n++;
  if (q.domainIds?.length) n++;
  if (q.energies?.length) n++;
  if (q.when && q.when !== "any") n++;
  if (q.status && q.status !== "open") n++;
  return n;
}

// ── saved views ──────────────────────────────────────────────────────────────

/**
 * A named question, stored in `user_settings.saved_views`. Not a table and not
 * a pool — a saved view creates no object you can file work under, schedule, or
 * ship. It is a bookmark for a question you ask often.
 */
export interface SavedView {
  id: string;
  name: string;
  query: TaskQuery;
  /** Client-generated, so a view saved offline keeps its order on arrival. */
  createdAt: string;
}

/** The cap. Saved views are a shortcut, not a navigation tree — past a dozen,
 *  a list of views is the thing you now have to search. */
export const MAX_SAVED_VIEWS = 12;

/** A one-line English rendering of a query, for the view's subtitle and for
 *  the chat to read back. Names come from the caller (this kernel holds no
 *  label or project table); ids it can't name are simply counted. */
export function describeQuery(
  q: TaskQuery,
  names: { label?: (id: string) => string | undefined; project?: (id: string) => string | undefined; domain?: (id: string) => string | undefined } = {},
): string {
  const parts: string[] = [];
  const named = (ids: string[] | undefined, get: ((id: string) => string | undefined) | undefined, noun: string) => {
    if (!ids?.length) return;
    const words = ids.map((id) => get?.(id)).filter((n): n is string => !!n);
    parts.push(words.length === ids.length ? words.join(" or ") : `${ids.length} ${noun}${ids.length > 1 ? "s" : ""}`);
  };
  if (q.text?.trim()) parts.push(`“${q.text.trim()}”`);
  named(q.labelIds, names.label, "label");
  if (q.priorities?.length) parts.push(`${q.priorities.join(" or ")} priority`);
  if (q.energies?.length) parts.push(q.energies.join(" or "));
  named(q.projectIds, names.project, "project");
  named(q.domainIds, names.domain, "domain");
  if (q.when && q.when !== "any") {
    const field = q.dateField === "deadline" ? "due" : "";
    const w = q.when.replace(/_/g, " ");
    parts.push(q.when === "overdue" || q.when === "undated" ? w : `${field} ${w}`.trim());
  }
  if (q.status === "done") parts.push("completed");
  else if (q.status === "any") parts.push("open or completed");
  return parts.length ? parts.join(" · ") : "Everything open";
}
