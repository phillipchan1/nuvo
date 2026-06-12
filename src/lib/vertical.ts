// The vertical layer — tasks -> projects -> initiatives -> domains — as view
// models + pure selectors over live Supabase rows. The hooks in
// useVertical.tsx fetch the rows and build a VerticalData snapshot with
// buildVertical(); everything here stays pure and synchronous so the floors
// never know where the data came from.
//
// Domain "gain" numbers (invested hours, quarter arc, last touched) are NOT
// stored anywhere — they derive from completed blocks, because a task IS a
// block and done tasks are the time ledger.

import { differenceInCalendarDays, startOfWeek, subDays } from "date-fns";
import type { Energy } from "./energy";
import type { Sprint, Task } from "./types";
import { parseDateISO, todayISO } from "./dates";

export type Momentum = "up" | "flat" | "down";

export interface Domain {
  id: string;
  name: string;
  color: string;
  icon: string; // a single glyph/emoji — domains are fixtures, give them a face
  intention: string; // the standing vow — what faithfulness to this domain means
  weeklyTargetHours: number;
  investedThisWeek: number; // derived: hours of blocks completed this week
  quarterHours: number; // derived: the long arc (Gain), last 90 days
  lastTouchedDays: number; // derived: days since last completed task → faithfulness
  sort: number;
}

export interface KeyResult {
  id: string;
  name: string;
  baseline: number;
  current: number;
  target: number;
  unit: string;
}

export interface Initiative {
  id: string;
  domainId: string;
  name: string;
  outcome: string; // the goal — what "done" looks like in one line
  description: string; // the fuller why / shape of the bet
  startDate: string | null; // anchors the timeline
  targetDate: string | null; // the finish line
  status: "active" | "paused" | "shipped" | "dropped";
  progress: number; // 0..100 — fallback when no projects yet
  momentum: Momentum;
  keyResults: KeyResult[];
}

export type ProjectStatus = "planned" | "active" | "blocked" | "done";

export interface Project {
  id: string;
  initiativeId: string | null; // nullable — a project can sit straight under a domain
  domainId: string;
  name: string;
  outcome: string; // the goal in one line
  description: string;
  startDate: string | null;
  targetDate: string | null;
  status: ProjectStatus;
  progress: number; // 0..100 — fallback when no tasks yet
}

/** A task as the floors see it — a thin view over a live `tasks` row. */
export interface VTask {
  id: string;
  projectId: string | null;
  initiativeId: string | null;
  domainId: string | null;
  title: string;
  energy: Energy | null;
  durationMins: number;
  deadlineDaysAway: number | null;
  status: "ready" | "scheduled" | "done";
  // is this a loose capture (no project) vs a project-backlog task
  loose?: boolean;
  // a raw, unprocessed capture (status = 'inbox') — the Sweep's queue
  inbox?: boolean;
  // committed to the current weekly sprint (the funnel)
  sprint?: boolean;
  // pass-throughs the rituals need
  doDate: string | null;
  completedAt: string | null;
  assignee: "me" | "agent";
}

export interface VerticalData {
  domains: Domain[];
  initiatives: Initiative[];
  projects: Project[];
  tasks: VTask[];
  /** The current week's sprint row (null until first commit/goal). */
  sprint: Sprint | null;
  // the current weekly sprint's one-line goal
  sprintGoal?: string;
  /** The week's lead initiatives (≤3), from the Sunday ritual. */
  focusInitiativeIds: string[];
}

// ── Row shapes (snake_case, as they come from Supabase) ─────────────────────
export interface DomainRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  intention: string;
  weekly_target_hours: number | null;
  sort_order: number;
}

export interface KeyResultRow {
  id: string;
  initiative_id: string;
  name: string;
  baseline_value: number;
  current_value: number;
  target_value: number;
  unit: string;
  sort_order: number;
}

export interface InitiativeRow {
  id: string;
  domain_id: string | null;
  name: string;
  outcome: string;
  description: string;
  start_date: string | null;
  target_date: string | null;
  status: string;
  momentum: string;
  progress: number;
  sort_order: number;
  key_results?: KeyResultRow[];
}

export interface ProjectRow {
  id: string;
  initiative_id: string | null;
  domain_id: string | null;
  name: string;
  outcome: string;
  description: string;
  start_date: string | null;
  target_date: string | null;
  status: string;
  progress: number;
  sort_order: number;
}

// ── Row → view mapping ───────────────────────────────────────────────────────

const INITIATIVE_STATUSES = new Set(["active", "paused", "shipped", "dropped"]);
const PROJECT_STATUSES = new Set(["planned", "active", "blocked", "done"]);

export function toVTask(t: Task, currentSprintId: string | null, today: string): VTask {
  return {
    id: t.id,
    projectId: t.project_id,
    initiativeId: t.initiative_id,
    domainId: t.domain_id,
    title: t.title,
    energy: t.energy,
    durationMins: t.duration_minutes ?? 30,
    deadlineDaysAway: t.deadline
      ? differenceInCalendarDays(parseDateISO(t.deadline), parseDateISO(today))
      : null,
    status: t.status === "done" ? "done" : t.start_time ? "scheduled" : "ready",
    loose: !t.project_id,
    inbox: t.status === "inbox",
    sprint: Boolean(currentSprintId && t.sprint_id === currentSprintId),
    doDate: t.do_date,
    completedAt: t.completed_at,
    assignee: t.assignee ?? "me",
  };
}

/**
 * Build the floors' snapshot from live rows. `tasks` should be every
 * non-trashed task (done included — completed blocks are the time ledger that
 * the faithfulness/gain numbers derive from).
 */
export function buildVertical(
  domainRows: DomainRow[],
  initiativeRows: InitiativeRow[],
  projectRows: ProjectRow[],
  taskRows: Task[],
  sprint: Sprint | null,
  now: Date = new Date(),
): VerticalData {
  const today = todayISO(now);
  // calendar-week boundary in the app timezone, not the machine clock
  const weekStart = startOfWeek(parseDateISO(today), { weekStartsOn: 1 });
  const quarterStart = subDays(now, 90);

  const initiatives: Initiative[] = [...initiativeRows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({
      id: i.id,
      domainId: i.domain_id ?? "",
      name: i.name,
      outcome: i.outcome,
      description: i.description,
      startDate: i.start_date,
      targetDate: i.target_date,
      status: (INITIATIVE_STATUSES.has(i.status) ? i.status : "active") as Initiative["status"],
      progress: i.progress,
      momentum: (["up", "flat", "down"].includes(i.momentum) ? i.momentum : "flat") as Momentum,
      keyResults: [...(i.key_results ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((k) => ({
          id: k.id,
          name: k.name,
          baseline: k.baseline_value,
          current: k.current_value,
          target: k.target_value,
          unit: k.unit,
        })),
    }));

  const initiativeDomain = new Map(initiatives.map((i) => [i.id, i.domainId]));

  const projects: Project[] = [...projectRows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => ({
      id: p.id,
      initiativeId: p.initiative_id,
      domainId: p.domain_id ?? (p.initiative_id ? initiativeDomain.get(p.initiative_id) ?? "" : ""),
      name: p.name,
      outcome: p.outcome,
      description: p.description,
      startDate: p.start_date,
      targetDate: p.target_date,
      status: (PROJECT_STATUSES.has(p.status) ? p.status : "active") as ProjectStatus,
      progress: p.progress,
    }));

  const projectById = new Map(projects.map((p) => [p.id, p]));

  // trashed rows can linger in the cache between an optimistic patch and the
  // refetch — never let them surface
  const tasks = taskRows.filter((t) => t.status !== "trashed").map((t) => {
    const v = toVTask(t, sprint?.id ?? null, today);
    // resolve the effective domain through the parent chain so the gain
    // ledger and balance strips never lose hours to a missing denormalized id
    if (!v.domainId) {
      if (v.projectId) v.domainId = projectById.get(v.projectId)?.domainId ?? null;
      if (!v.domainId && v.initiativeId) v.domainId = initiativeDomain.get(v.initiativeId) ?? null;
    }
    return v;
  });

  // ── derive the domain gain ledger from completed blocks ────────────────────
  const ledger = new Map<string, { week: number; quarter: number; last: number | null }>();
  for (const t of tasks) {
    if (t.status !== "done" || !t.completedAt || !t.domainId) continue;
    const at = new Date(t.completedAt).getTime();
    const entry = ledger.get(t.domainId) ?? { week: 0, quarter: 0, last: null };
    if (at >= weekStart.getTime()) entry.week += t.durationMins;
    if (at >= quarterStart.getTime()) entry.quarter += t.durationMins;
    if (entry.last == null || at > entry.last) entry.last = at;
    ledger.set(t.domainId, entry);
  }

  const domains: Domain[] = [...domainRows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((d, idx) => {
      const led = ledger.get(d.id);
      return {
        id: d.id,
        name: d.name,
        color: d.color,
        icon: d.icon || "◇",
        intention: d.intention,
        weeklyTargetHours: d.weekly_target_hours ?? 0,
        investedThisWeek: led ? led.week / 60 : 0,
        quarterHours: led ? Math.round(led.quarter / 60) : 0,
        lastTouchedDays: led?.last != null
          ? Math.max(0, Math.floor((now.getTime() - led.last) / 86_400_000))
          : 99,
        sort: d.sort_order ?? idx,
      };
    });

  return {
    domains,
    initiatives,
    projects,
    tasks,
    sprint,
    sprintGoal: sprint?.goal ?? "",
    focusInitiativeIds: sprint?.focus_initiative_ids ?? [],
  };
}

// ── Selectors ──────────────────────────────────────────────────────────────
export const domainById = (d: VerticalData, id: string | null) =>
  d.domains.find((x) => x.id === id) ?? null;
export const initiativeById = (d: VerticalData, id: string | null) =>
  d.initiatives.find((x) => x.id === id) ?? null;
export const projectById = (d: VerticalData, id: string | null) =>
  d.projects.find((x) => x.id === id) ?? null;

export const initiativesOf = (d: VerticalData, domainId: string) =>
  d.initiatives.filter((i) => i.domainId === domainId);
export const projectsOf = (d: VerticalData, initiativeId: string) =>
  d.projects.filter((p) => p.initiativeId === initiativeId);
export const tasksOf = (d: VerticalData, projectId: string) =>
  d.tasks.filter((t) => t.projectId === projectId);

/** Projects that hang directly off a domain with no initiative parent. */
export const looseProjectsOf = (d: VerticalData, domainId: string) =>
  d.projects.filter((p) => p.domainId === domainId && !p.initiativeId);

/** Tasks parented to an initiative but to no project — first-class loose work. */
export const looseTasksOfInitiative = (d: VerticalData, initiativeId: string) =>
  d.tasks.filter((t) => t.initiativeId === initiativeId && !t.projectId);

/** Loose captures parented only to a domain (e.g. "teach my kid to ride a bike"). */
export const looseTasksOfDomain = (d: VerticalData, domainId: string) =>
  d.tasks.filter((t) => t.domainId === domainId && !t.projectId && !t.initiativeId);

// ── Sprint funnel — what's committed for the week ────────────────────────────
/** Every task pulled into the current weekly sprint. */
export const sprintTasks = (d: VerticalData) => d.tasks.filter((t) => t.sprint);

/** Inbox = raw, unprocessed captures — the GTD end of the funnel. */
export const inboxTasks = (d: VerticalData) =>
  d.tasks.filter((t) => t.inbox && t.status !== "done");

/** Processed, undone work anywhere in the vertical — under a project, loose
 *  on an initiative, or parked on a domain ("someday"). The funnel's Backlogs
 *  source; nothing routed in the Sweep may fall out of it. */
export const backlogTasks = (d: VerticalData) =>
  d.tasks.filter(
    (t) => !t.inbox && t.status !== "done" && (t.projectId || t.initiativeId || t.domainId),
  );

/** How many of a project's tasks are committed to the sprint. */
export const projectSprintCount = (d: VerticalData, projectId: string) =>
  d.tasks.filter((t) => t.projectId === projectId && t.sprint).length;

/** Total committed minutes (undone sprint tasks) — the load. */
export function sprintLoadMins(d: VerticalData): number {
  return sprintTasks(d)
    .filter((t) => t.status !== "done")
    .reduce((sum, t) => sum + (t.durationMins || 0), 0);
}

/** Weekly capacity (hours) = the sum of your domains' intended weekly hours. */
export function weeklyCapacityHours(d: VerticalData): number {
  return d.domains.reduce((sum, dom) => sum + (dom.weeklyTargetHours || 0), 0);
}

/** Sprint minutes split by domain — surfaces balance (am I starving a domain?). */
export function sprintMinsByDomain(d: VerticalData): { domain: Domain; mins: number }[] {
  return d.domains
    .map((domain) => ({
      domain,
      mins: sprintTasks(d)
        .filter((t) => t.status !== "done" && t.domainId === domain.id)
        .reduce((sum, t) => sum + (t.durationMins || 0), 0),
    }))
    .filter((x) => x.mins > 0);
}

/** A project's first not-done task by list order — the right next pull. */
export function nextUpTask(d: VerticalData, projectId: string): VTask | null {
  return tasksOf(d, projectId).find((t) => t.status !== "done") ?? null;
}

// ── Derived progress — the Gain rippling UP the spine ────────────────────────
/** A project's progress = share of its tasks done, falling back to its stored % */
export function projectProgress(d: VerticalData, p: Project): number {
  const ts = tasksOf(d, p.id);
  if (p.status === "done") return 100;
  if (ts.length === 0) return p.progress;
  const done = ts.filter((t) => t.status === "done").length;
  return Math.round((done / ts.length) * 100);
}

/** An initiative's progress = mean of its projects' progress, else its stored %. */
export function initiativeProgress(d: VerticalData, i: Initiative): number {
  if (i.status === "shipped") return 100;
  const ps = projectsOf(d, i.id);
  if (ps.length === 0) return i.progress;
  const sum = ps.reduce((acc, p) => acc + projectProgress(d, p), 0);
  return Math.round(sum / ps.length);
}

/** A domain's rolled-up progress = mean of its active initiatives' progress. */
export function domainProgress(d: VerticalData, domainId: string): number {
  const is = initiativesOf(d, domainId).filter((i) => i.status === "active" || i.status === "paused");
  if (is.length === 0) return 0;
  const sum = is.reduce((acc, i) => acc + initiativeProgress(d, i), 0);
  return Math.round(sum / is.length);
}

/**
 * An initiative's progress as it stood at a past moment: tasks completed
 * before `cutoff` count as done, everything else as open. This is what lets
 * the Sunday ritual show real week-over-week deltas with no snapshot table.
 */
export function initiativeProgressAt(d: VerticalData, i: Initiative, cutoff: Date): number {
  if (i.status === "shipped") return 100;
  const ps = projectsOf(d, i.id);
  if (ps.length === 0) return i.progress;
  const cut = cutoff.getTime();
  const per = ps.map((p) => {
    // a manually-done project counts 100 on BOTH sides, or it would show a
    // phantom "moved" delta every week forever
    if (p.status === "done") return 100;
    const ts = tasksOf(d, p.id);
    if (ts.length === 0) return p.progress;
    const done = ts.filter(
      (t) => t.status === "done" && t.completedAt && new Date(t.completedAt).getTime() < cut,
    ).length;
    return Math.round((done / ts.length) * 100);
  });
  return Math.round(per.reduce((a, b) => a + b, 0) / per.length);
}

/** Resolve a task ROW's domain color through the parent chain — the one
 *  accent rule, shared by the rail, the calendar, and the rituals. */
export function taskDomainColor(
  d: VerticalData,
  t: { domain_id: string | null; project_id: string | null; initiative_id: string | null },
): string | null {
  const domainId =
    t.domain_id ??
    projectById(d, t.project_id)?.domainId ??
    initiativeById(d, t.initiative_id)?.domainId ??
    null;
  return domainById(d, domainId)?.color ?? null;
}

/** Faithfulness read: lit = tended recently, dim = going quiet. */
export function faithfulness(dom: Domain): { lit: boolean; note: string } {
  if (dom.lastTouchedDays <= 2) return { lit: true, note: "tended" };
  if (dom.investedThisWeek > dom.weeklyTargetHours)
    return { lit: true, note: `over ${Math.round(dom.investedThisWeek)}h` };
  if (dom.lastTouchedDays >= 99) return { lit: false, note: "untouched" };
  return { lit: false, note: `quiet ${dom.lastTouchedDays}d` };
}
