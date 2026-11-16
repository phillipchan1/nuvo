// The Table's read model — what the outline shows, at either Build altitude.
//
// The Table is one outline: a group (when) ▸ an initiative ▸ a project ▸ its
// tasks. This file decides everything about *which* rows and in *what* order —
// the view, the grouping, the filters, the search — and nothing about how they
// look. `OutlineFloor` draws it on both shells; the tests read it directly.
//
// Three fixed views, no saved ones (N-05 — the Table is not a database):
//   upcoming    open work, grouped by when it next needs you — the grooming pass
//   completed   finished TASKS, by the week they were finished (whole shipped
//               projects are the Shipped face's; this is the work that landed)
//   everything  all of it, grouped by status
//
// Weeks come from the kernel (`planningWeekStart`): on a weekend "this week" is
// the one ahead, exactly as the Schedule and the agent read it.

import {
  dayMs,
  isoOf,
  mondayOf,
  planningWeekStart,
  quarterStartISO,
} from "../../supabase/functions/_shared/planningRules.ts";
import { byManualOrder } from "./taskOrder";
import type { Task, TaskPriority } from "./types";
import type { Initiative, Project, ProjectStatus, VerticalData } from "./vertical";

export type OutlineAltitude = "project" | "initiative";
export type OutlineView = "upcoming" | "completed" | "everything";
/** `when` is the view's own clock: weeks for projects, quarters for initiatives,
 *  the week finished in Completed, status in Everything. */
export type OutlineGrouping = "when" | "domain" | "status" | "none";

export type OutlineFieldKey = "domain" | "status" | "shape" | "taskDate" | "estimate" | "priority";
export interface OutlineFilter {
  field: OutlineFieldKey;
  values: string[];
}

export interface OutlineQuery {
  altitude: OutlineAltitude;
  view: OutlineView;
  grouping: OutlineGrouping;
  filters: OutlineFilter[];
  search: string;
  todayISO: string;
}

export interface ProjectItem {
  kind: "project";
  project: Project;
  /** The project's rows for this view, in the user's own order. */
  tasks: Task[];
  open: number;
  done: number;
  /** Estimated minutes of the open work (only what has an estimate). */
  minutes: number;
  /** The date that placed it in its group — next due, or finished. */
  when: string | null;
}
export interface InitiativeItem {
  kind: "initiative";
  initiative: Initiative;
  projects: ProjectItem[];
  when: string | null;
}
export type OutlineItem = ProjectItem | InitiativeItem;

export interface OutlineGroup {
  key: string;
  label: string;
  /** The dates the group covers, said once beside its name. */
  span?: string;
  /** The group the view is for — the coming week, this quarter. */
  lead?: boolean;
  /** Late — said in --signal. */
  late?: boolean;
  /** A domain group's colour. */
  domainId?: string;
  items: OutlineItem[];
  /** Open tasks dated in this group (Upcoming by week), else all open tasks. */
  openTasks: number;
  minutes: number;
  /** Tasks finished in this group (Completed). */
  doneTasks: number;
}

// ── fields ──────────────────────────────────────────────────────────────────

/** What a filter can say, and which level it reads. Project-level fields pick
 *  projects (and, at the initiative altitude, the initiatives holding them);
 *  task-level ones hide the other tasks — and a project left with none. */
export const OUTLINE_FIELDS: Record<
  OutlineFieldKey,
  { label: string; level: "project" | "task"; options: { value: string; label: string; hint?: string }[] }
> = {
  domain: { label: "Domain", level: "project", options: [] }, // filled from the account's domains
  status: {
    label: "Status",
    level: "project",
    options: [
      { value: "in_progress", label: "In progress" },
      { value: "backlog", label: "Not started" },
      { value: "waiting", label: "Parked" },
      { value: "complete", label: "Shipped" },
      { value: "cancelled", label: "Dropped" },
    ],
  },
  shape: {
    label: "Shape",
    level: "project",
    options: [
      { value: "thisWeek", label: "Has work this week" },
      { value: "loose", label: "Has undated tasks" },
      { value: "empty", label: "No tasks yet" },
      { value: "noEstimate", label: "Has tasks without a length" },
    ],
  },
  taskDate: {
    label: "Task date",
    level: "task",
    options: [
      { value: "overdue", label: "Overdue" },
      { value: "thisWeek", label: "This week" },
      { value: "nextWeek", label: "Next week" },
      { value: "later", label: "Later" },
      { value: "none", label: "No date" },
    ],
  },
  estimate: {
    label: "Length",
    level: "task",
    options: [
      { value: "has", label: "Has a length" },
      { value: "none", label: "No length" },
    ],
  },
  priority: {
    label: "Priority",
    level: "task",
    options: [
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
      { value: "none", label: "None" },
    ],
  },
};

/** The fixed presets — a filter set, not a saved view. */
export const OUTLINE_PRESETS: { label: string; hint: string; filters: OutlineFilter[] }[] = [
  {
    label: "Ready this week",
    hint: "In progress · overdue, this week or undated",
    filters: [
      { field: "status", values: ["in_progress"] },
      { field: "taskDate", values: ["overdue", "thisWeek", "none"] },
    ],
  },
  {
    label: "Needs shaping",
    hint: "No tasks yet, or undated ones",
    filters: [
      { field: "status", values: ["in_progress", "backlog"] },
      { field: "shape", values: ["empty", "loose"] },
    ],
  },
  {
    label: "Needs a length",
    hint: "This week's tasks with no estimate",
    filters: [
      { field: "taskDate", values: ["overdue", "thisWeek"] },
      { field: "estimate", values: ["none"] },
    ],
  },
];

// ── dates ───────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => isoOf(dayMs(iso) + n * DAY);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const day = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MON[m - 1]} ${d}`;
};
/** "Nov 16 – 22", or "Nov 30 – Dec 6" across a month. */
export function spanLabel(startISO: string, endISO: string): string {
  const [, m1] = startISO.split("-").map(Number);
  const [, m2, d2] = endISO.split("-").map(Number);
  return m1 === m2 ? `${day(startISO)} – ${d2}` : `${day(startISO)} – ${day(endISO)}`;
}

export type WeekBucket = "overdue" | "thisWeek" | "nextWeek" | "later" | "none";
/** Where a date falls against the week you are planning. */
export function weekBucket(dateISO: string | null, todayISO: string): WeekBucket {
  if (!dateISO) return "none";
  if (dateISO < todayISO) return "overdue";
  const start = planningWeekStart(todayISO);
  if (dateISO < addDays(start, 7)) return "thisWeek";
  if (dateISO < addDays(start, 14)) return "nextWeek";
  return "later";
}

function weekGroups(todayISO: string) {
  const start = planningWeekStart(todayISO);
  return [
    { key: "overdue", label: "Overdue", late: true },
    { key: "thisWeek", label: "This week", span: spanLabel(start, addDays(start, 6)), lead: true },
    { key: "nextWeek", label: "Next week", span: spanLabel(addDays(start, 7), addDays(start, 13)) },
    { key: "later", label: "Later" },
    { key: "none", label: "No date" },
  ];
}

type QuarterBucket = "past" | "thisQuarter" | "nextQuarter" | "later" | "none";
function quarterBucket(dateISO: string | null, todayISO: string): QuarterBucket {
  if (!dateISO) return "none";
  if (dateISO < todayISO) return "past";
  const q = quarterStartISO(todayISO);
  const next = quarterStartISO(addDays(q, 100));
  const after = quarterStartISO(addDays(next, 100));
  if (dateISO < next) return "thisQuarter";
  if (dateISO < after) return "nextQuarter";
  return "later";
}
const quarterName = (qISO: string) => {
  const [y, m] = qISO.split("-").map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
};
function quarterGroups(todayISO: string) {
  const q = quarterStartISO(todayISO);
  const next = quarterStartISO(addDays(q, 100));
  return [
    { key: "past", label: "Past its target", late: true },
    { key: "thisQuarter", label: "This quarter", span: quarterName(q), lead: true },
    { key: "nextQuarter", label: "Next quarter", span: quarterName(next) },
    { key: "later", label: "Later" },
    { key: "none", label: "No target" },
  ];
}

/** The week a task was finished in, as a group key — this week, last week,
 *  then by month. Finished is the day it was ticked, read in the app's day. */
function doneBucket(doneISO: string | null, todayISO: string): string {
  if (!doneISO) return "earlier";
  const thisMonday = mondayOf(todayISO);
  if (doneISO >= thisMonday) return "thisWeek";
  if (doneISO >= addDays(thisMonday, -7)) return "lastWeek";
  return `m:${doneISO.slice(0, 7)}`;
}
function doneGroupMeta(key: string, todayISO: string) {
  const thisMonday = mondayOf(todayISO);
  if (key === "thisWeek") return { label: "This week", span: spanLabel(thisMonday, addDays(thisMonday, 6)) };
  if (key === "lastWeek") return { label: "Last week", span: spanLabel(addDays(thisMonday, -7), addDays(thisMonday, -1)) };
  if (key === "earlier") return { label: "Earlier" };
  const [y, m] = key.slice(2).split("-").map(Number);
  return { label: y === Number(todayISO.slice(0, 4)) ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}` };
}

const STATUS_ORDER: ProjectStatus[] = ["in_progress", "backlog", "waiting", "complete", "cancelled"];
const STATUS_LABEL: Record<ProjectStatus, string> = {
  in_progress: "In progress",
  backlog: "Not started",
  waiting: "Parked",
  complete: "Shipped",
  cancelled: "Dropped",
};

/** The day a task was finished, as a date. */
export const doneOn = (t: Pick<Task, "completed_at">): string | null => (t.completed_at ? t.completed_at.slice(0, 10) : null);

// ── the read ────────────────────────────────────────────────────────────────

const lc = (s: string) => s.toLowerCase();

export function readOutline(data: VerticalData, tasks: Task[], q: OutlineQuery): OutlineGroup[] {
  const { view, todayISO } = q;
  const needle = lc(q.search.trim());
  const active = q.filters.filter((f) => f.values.length);
  const projectFilters = active.filter((f) => OUTLINE_FIELDS[f.field].level === "project");
  const taskFilters = active.filter((f) => OUTLINE_FIELDS[f.field].level === "task");

  const byProject = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.project_id || t.parent_task_id || t.trashed_at || t.status === "inbox") continue;
    const list = byProject.get(t.project_id);
    if (list) list.push(t);
    else byProject.set(t.project_id, [t]);
  }
  const all = (pid: string) => byProject.get(pid) ?? [];
  const isDone = (t: Task) => t.status === "done";

  const taskTest = (t: Task, f: OutlineFilter) => {
    switch (f.field) {
      case "taskDate":
        return f.values.includes(weekBucket(t.do_date, todayISO));
      case "estimate":
        return f.values.includes(t.duration_minutes ? "has" : "none");
      case "priority":
        return f.values.includes((t.priority as TaskPriority | null) ?? "none");
      default:
        return true;
    }
  };
  const projectTest = (p: Project, f: OutlineFilter) => {
    const open = all(p.id).filter((t) => !isDone(t));
    switch (f.field) {
      case "domain":
        return f.values.includes(p.domainId);
      case "status":
        return f.values.includes(p.status);
      case "shape":
        return (
          (f.values.includes("thisWeek") && open.some((t) => weekBucket(t.do_date, todayISO) === "thisWeek")) ||
          (f.values.includes("loose") && open.some((t) => !t.do_date)) ||
          (f.values.includes("empty") && all(p.id).length === 0) ||
          (f.values.includes("noEstimate") && open.some((t) => !t.duration_minutes))
        );
      default:
        return true;
    }
  };

  function projectItem(p: Project): ProjectItem | null {
    if (view === "upcoming" && (p.status === "complete" || p.status === "cancelled")) return null;
    if (!projectFilters.every((f) => projectTest(p, f))) return null;
    const rows = all(p.id);
    let shown = rows.filter((t) => (view === "completed" ? isDone(t) : view === "upcoming" ? !isDone(t) : true));
    shown = shown.filter((t) => taskFilters.every((f) => taskTest(t, f)));
    const nameHit = needle !== "" && lc(p.name).includes(needle);
    if (needle && !nameHit) shown = shown.filter((t) => lc(t.title).includes(needle));
    if (view === "completed" && shown.length === 0) return null;
    if (taskFilters.length && shown.length === 0) return null;
    if (needle && !nameHit && shown.length === 0) return null;

    const open = rows.filter((t) => !isDone(t));
    const when =
      view === "completed"
        ? shown.map(doneOn).filter((d): d is string => Boolean(d)).sort().pop() ?? null
        : open.map((t) => t.do_date).filter((d): d is string => Boolean(d)).sort()[0] ?? p.targetDate;
    return {
      kind: "project",
      project: p,
      tasks:
        view === "completed"
          ? [...shown].sort((a, b) => (doneOn(b) ?? "").localeCompare(doneOn(a) ?? ""))
          : byManualOrder(shown),
      open: open.length,
      done: rows.length - open.length,
      minutes: open.reduce((a, t) => a + (t.duration_minutes ?? 0), 0),
      when,
    };
  }

  let items: OutlineItem[];
  if (q.altitude === "project") {
    items = data.projects.map(projectItem).filter((x): x is ProjectItem => Boolean(x));
  } else {
    const narrowing = active.length > 0 || needle !== "" || view === "completed";
    items = data.initiatives
      .filter((i) => !(view === "upcoming" && (i.status === "complete" || i.status === "cancelled")))
      .filter((i) => {
        const d = active.find((f) => f.field === "domain");
        return !d || d.values.includes(i.domainId);
      })
      .map((i): InitiativeItem | null => {
        const projects = data.projects
          .filter((p) => p.initiativeId === i.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(projectItem)
          .filter((x): x is ProjectItem => Boolean(x));
        if (narrowing && projects.length === 0 && !(needle && lc(i.name).includes(needle))) return null;
        const when =
          view === "completed"
            ? projects.map((p) => p.when).filter((d): d is string => Boolean(d)).sort().pop() ?? null
            : i.targetDate;
        return { kind: "initiative", initiative: i, projects, when };
      })
      .filter((x): x is InitiativeItem => Boolean(x));
  }

  const domainOf = (it: OutlineItem) => (it.kind === "project" ? it.project.domainId : it.initiative.domainId);
  const statusOf = (it: OutlineItem) => (it.kind === "project" ? it.project.status : it.initiative.status);
  const projectsIn = (it: OutlineItem): ProjectItem[] => (it.kind === "project" ? [it] : it.projects);

  // Grouping: the view's own clock unless the user picked another.
  type Shell = Omit<OutlineGroup, "items" | "openTasks" | "minutes" | "doneTasks">;
  let shells: Shell[];
  let keyOf: (it: OutlineItem) => string;
  const grouping = q.grouping === "when" && view === "everything" ? "status" : q.grouping;
  if (grouping === "when") {
    if (view === "completed") {
      keyOf = (it) => doneBucket(it.when, todayISO);
      const keys = [...new Set(items.map(keyOf))].sort((a, b) => rankDone(a) - rankDone(b) || b.localeCompare(a));
      shells = keys.map((key) => ({ key, ...doneGroupMeta(key, todayISO) }));
    } else if (q.altitude === "initiative") {
      keyOf = (it) => quarterBucket(it.when, todayISO);
      shells = quarterGroups(todayISO);
    } else {
      keyOf = (it) => weekBucket(it.when, todayISO);
      shells = weekGroups(todayISO);
    }
  } else if (grouping === "domain") {
    keyOf = (it) => `d:${domainOf(it)}`;
    shells = data.domains.map((d) => ({ key: `d:${d.id}`, label: d.name, domainId: d.id }));
  } else if (grouping === "status") {
    keyOf = (it) => `s:${statusOf(it)}`;
    shells = STATUS_ORDER.map((s) => ({ key: `s:${s}`, label: STATUS_LABEL[s] }));
  } else {
    keyOf = () => "all";
    shells = [{ key: "all", label: q.altitude === "project" ? "All projects" : "All initiatives" }];
  }

  const sortKey = (it: OutlineItem) => it.when ?? "9999-12-31";
  const groups: OutlineGroup[] = [];
  for (const s of shells) {
    const its = items.filter((it) => keyOf(it) === s.key);
    if (!its.length) continue;
    if (view === "completed") its.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    else if (grouping === "when" || grouping === "domain" || grouping === "none") its.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const ps = its.flatMap(projectsIn);
    const openRows = ps
      .flatMap((p) => all(p.project.id))
      .filter((t) => !isDone(t))
      .filter((t) => !(grouping === "when" && q.altitude === "project" && view === "upcoming") || weekBucket(t.do_date, todayISO) === s.key);
    groups.push({
      ...s,
      items: its,
      openTasks: view === "completed" ? 0 : openRows.length,
      minutes: view === "completed" ? 0 : openRows.reduce((a, t) => a + (t.duration_minutes ?? 0), 0),
      doneTasks: view === "completed" ? ps.reduce((a, p) => a + p.tasks.length, 0) : 0,
    });
  }
  return groups;
}

const rankDone = (k: string) => (k === "thisWeek" ? 0 : k === "lastWeek" ? 1 : k === "earlier" ? 3 : 2);
