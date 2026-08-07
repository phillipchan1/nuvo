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
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_PROJECT_DURATION_MINUTES,
  type BigRock,
  type ExternalEvent,
  type Sprint,
  type Task,
} from "./types";
import { parseDateISO, todayISO } from "./dates";
import { eventCountsAsActual, eventDomainId, eventMins, type ActualsFilter } from "./eventActuals";

export type Momentum = "up" | "flat" | "down";

/** Machine-facing routing context — the signal passive grooming reads to file a
 *  terse capture into the right domain. Built from the charter (source of truth),
 *  proposed by the `enrichDomain` edge path, persisted on accept. Distinct from
 *  `intention` (the human-facing vow). */
export interface DomainContext {
  scope: string;
  entities: string[];
  keywords: string[];
  boundary: string;
  exemplars: string[];
}

export interface Domain {
  id: string;
  name: string;
  color: string;
  icon: string; // a single glyph/emoji — domains are fixtures, give them a face
  intention: string; // the standing vow — what faithfulness to this domain means
  charter: string; // plain-line "what this domain IS" — the routing source of truth
  context: DomainContext | null; // AI-expanded routing metadata (entities, boundary…)
  weeklyTargetHours: number;
  investedThisWeek: number; // derived: hours invested this week (completed blocks + attended meetings)
  meetingHoursThisWeek: number; // derived: the meeting slice of investedThisWeek (so the UI can name it)
  quarterHours: number; // derived: the long arc (Gain), last 90 days
  /** derived: days since the last thing LANDED here — hours kept, a meeting
   *  attended, or a finish line crossed. `null` = nothing ever has. (Was 99, a
   *  sentinel that collided with a real 99-day count.) */
  lastTouchedDays: number | null;
  /** derived: the most recent finish line crossed here — what makes a quiet week
   *  a delivered one rather than a drifting one. Denormalized like
   *  `meetingHoursThisWeek` so `stateOf(d: Domain)` stays single-argument and both
   *  shells get it for free (D-086). */
  lastShip: { name: string; daysAgo: number } | null;
  weeks: number[]; // derived: invested hours per week, last 13 weeks (oldest → now) — the faithfulness pulse
  days: number[]; // derived: invested hours per day of THIS week (index 0 = weekStart) — the week's shape
  sort: number;
}

export interface KeyResult {
  id: string;
  name: string;
  baseline: number;
  current: number;
  target: number;
  unit: string;
  updatedAt: string | null; // last time the measurement was touched — staleness
}

/**
 * The grooming Brief — the "What" lens's document (docs/grooming-lenses.md §5).
 * Scope and acceptance as adjudicated lines, persisted as a `brief` jsonb on
 * projects and initiatives. The existing `outcome` (one-liner) and `targetDate`
 * stay where they are; the Brief lens edits them alongside these fields.
 * (Named ItemBrief — `Brief` is already the morning brief in lib/brief.ts.)
 */
export interface ItemBrief {
  scope: string[]; // in scope
  nonGoals: string[]; // explicitly out
  doneWhen: string[]; // acceptance criteria
  openQuestions: string[]; // the AI's interrogation, still open
  constraints: string[];
}

export const EMPTY_BRIEF: ItemBrief = {
  scope: [],
  nonGoals: [],
  doneWhen: [],
  openQuestions: [],
  constraints: [],
};

/**
 * Nuvo's soundness judgment of a project / initiative — the "are the pieces
 * *good*?" read that gates whether something is truly tended. Persisted as the
 * `verification` jsonb; `sig` is a structural signature so we know when the
 * verdict has gone stale (the item changed since it was judged). The verify
 * edge function returns everything but `sig`; the client stamps that on save.
 */
export interface SoundnessVerdict {
  sig: string;
  sound: boolean;
  confidence: number; // 0..1
  outcome: { ok: boolean; note: string; suggestion?: string };
  steps: { ok: boolean; note: string; verdict: "thin" | "sound" | "bloated"; missing?: string[] };
  time: { ok: boolean; note: string; read: "comfortable" | "tight" | "unrealistic"; estHours: number };
  dates: { ok: boolean; note: string };
}

export interface Initiative {
  id: string;
  domainId: string;
  name: string;
  outcome: string; // the goal — what "done" looks like in one line
  description: string; // the fuller why / shape of the bet
  startDate: string | null; // anchors the timeline
  targetDate: string | null; // the finish line
  /** Shares the project vocabulary now — see {@link ProjectStatus}. */
  status: ProjectStatus;
  progress: number; // 0..100 — fallback when no projects yet
  momentum: Momentum;
  keyResults: KeyResult[];
  createdAt: string | null; // when the bet was made — the "recently created" grooming prior
  tendedAt: string | null; // last groomed/rested in a Tending session — the snooze
  verification: SoundnessVerdict | null; // Nuvo's last soundness judgment (cached)
  verifiedAt: string | null; // when that judgment was made
  brief: ItemBrief | null; // the What lens's document (scope / non-goals / acceptance)
}

export type ProjectStatus = "backlog" | "in_progress" | "waiting" | "cancelled" | "complete";

export interface Project {
  id: string;
  initiativeId: string | null; // nullable — a project can sit straight under a domain
  keyResultId: string | null; // the KR this project moves, if any — the outcome link
  domainId: string;
  name: string;
  outcome: string; // the goal in one line
  description: string;
  startDate: string | null;
  targetDate: string | null;
  /** The EFFECTIVE status — every task done derives `complete` (buildVertical),
   *  so this is the one honest answer every surface reads. */
  status: ProjectStatus;
  /** The raw stored value, before the tasks got a vote — only the record needs
   *  it, to tell "you set this" apart from "the tasks said so". */
  storedStatus: ProjectStatus;
  progress: number; // 0..100 — fallback when no tasks yet
  shippedAt: string | null; // when you SHIPPED it — the day the judgment was made
  createdAt: string | null; // when created — the "recently created" grooming prior
  tendedAt: string | null; // last groomed/rested in a Tending session — the snooze
  verification: SoundnessVerdict | null; // Nuvo's last soundness judgment (cached)
  verifiedAt: string | null; // when that judgment was made
  brief: ItemBrief | null; // the What lens's document (scope / non-goals / acceptance)
}

/** A task as the floors see it — a thin view over a live `tasks` row. */
export interface VTask {
  id: string;
  projectId: string | null;
  initiativeId: string | null;
  domainId: string | null;
  /** the key result this task moves, if any — the outcome link. */
  keyResultId: string | null;
  /** the priority (big rock) this task serves, if any. */
  bigRockId: string | null;
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
  /** The actual block. `doDate` alone means "planned for that day"; this is the
   *  clock time, and the two are genuinely different commitments — a surface that
   *  showed only the day would report a task as blocked when it isn't. Dropped by
   *  `toVTask` until the record needed to say which work has a time. */
  startTime: string | null;
  /** Inside a time slot — the slot carries the day/time; the task's own start_time is null. */
  slotId: string | null;
  /** when it was captured — lets a week judge the plan it made, not what landed after. */
  createdAt: string | null;
  completedAt: string | null;
  assignee: "me" | "agent";
  rollCount: number;
  /** The assistant prepared this one — prework is waiting in the task. */
  preworkReady?: boolean;
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
  /** The week's big rocks — the plan above the schedule (a small, varying set). */
  bigRocks: BigRock[];
  /** Last completed-activity timestamp per project (ISO) — merged PRs and other
   *  actuals from activity sources. Feeds Motion so a project moves even with no
   *  completed tasks. Empty until an activity source is bound. */
  lastActivityByProject: Record<string, string>;
}

// ── Row shapes (snake_case, as they come from Supabase) ─────────────────────
export interface DomainRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  intention: string;
  charter?: string;
  context?: DomainContext | null;
  context_at?: string | null;
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
  updated_at?: string | null;
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
  created_at?: string;
  tended_at?: string | null;
  verification?: SoundnessVerdict | null;
  verified_at?: string | null;
  brief?: ItemBrief | null;
  key_results?: KeyResultRow[];
}

export interface ProjectRow {
  id: string;
  initiative_id: string | null;
  key_result_id: string | null;
  domain_id: string | null;
  name: string;
  outcome: string;
  description: string;
  start_date: string | null;
  target_date: string | null;
  status: string;
  progress: number;
  shipped_at?: string | null;
  sort_order: number;
  created_at?: string;
  tended_at?: string | null;
  verification?: SoundnessVerdict | null;
  verified_at?: string | null;
  brief?: ItemBrief | null;
}

// ── Row → view mapping ───────────────────────────────────────────────────────

const PROJECT_STATUSES = new Set(["backlog", "in_progress", "waiting", "cancelled", "complete"]);

const LEGACY_PROJECT_STATUS: Record<string, ProjectStatus> = {
  planned: "backlog",
  active: "in_progress",
  blocked: "waiting",
  done: "complete",
};

export function normalizeProjectStatus(raw: string): ProjectStatus {
  if (PROJECT_STATUSES.has(raw)) return raw as ProjectStatus;
  return LEGACY_PROJECT_STATUS[raw] ?? "backlog";
}

// Initiatives share the project vocabulary now. Old rows (active | paused |
// shipped | dropped) map onto it; the DB migration backfills, this guards reads.
const LEGACY_INITIATIVE_STATUS: Record<string, ProjectStatus> = {
  active: "in_progress",
  paused: "waiting",
  shipped: "complete",
  dropped: "cancelled",
};

export function normalizeInitiativeStatus(raw: string): ProjectStatus {
  if (PROJECT_STATUSES.has(raw)) return raw as ProjectStatus;
  return LEGACY_INITIATIVE_STATUS[raw] ?? "in_progress";
}

export function isProjectComplete(status: string) {
  return status === "complete" || status === "done";
}

export function isProjectInFlight(status: string) {
  return status === "in_progress" || status === "active";
}

/** Still in play — anything that hasn't been completed or cancelled. Shared by
 *  projects and initiatives now that they speak one status vocabulary. */
export function isOpenStatus(status: string) {
  return !isProjectComplete(status) && status !== "cancelled" && status !== "dropped";
}

export function toVTask(t: Task, currentSprintId: string | null, today: string): VTask {
  return {
    id: t.id,
    projectId: t.project_id,
    initiativeId: t.initiative_id,
    domainId: t.domain_id,
    keyResultId: t.key_result_id ?? null,
    bigRockId: t.big_rock_id ?? null,
    title: t.title,
    energy: t.energy,
    durationMins:
      t.duration_minutes ??
      (t.project_id ? DEFAULT_PROJECT_DURATION_MINUTES : DEFAULT_DURATION_MINUTES),
    deadlineDaysAway: t.deadline
      ? differenceInCalendarDays(parseDateISO(t.deadline), parseDateISO(today))
      : null,
    // A slot is a calendar commitment — children ride the slot's block, so they
    // count as scheduled even though their own start_time is null.
    status: t.status === "done" ? "done" : t.start_time || t.slot_id ? "scheduled" : "ready",
    loose: !t.project_id,
    inbox: t.status === "inbox",
    sprint: Boolean(currentSprintId && t.sprint_id === currentSprintId),
    doDate: t.do_date,
    startTime: t.start_time,
    slotId: t.slot_id,
    createdAt: t.created_at ?? null,
    completedAt: t.completed_at,
    assignee: t.assignee ?? "me",
    rollCount: t.roll_count ?? 0,
    preworkReady: Boolean(t.prework_at && t.prework),
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
  events: ExternalEvent[] = [],
  calendarDomainMap: Record<string, string> = {},
  eventRouting: Record<string, string> = {},
  lastActivityByProject: Record<string, string> = {},
  actualsFilter: ActualsFilter = {},
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
      status: normalizeInitiativeStatus(i.status),
      progress: i.progress,
      momentum: (["up", "flat", "down"].includes(i.momentum) ? i.momentum : "flat") as Momentum,
      createdAt: i.created_at ?? null,
      tendedAt: i.tended_at ?? null,
      verification: i.verification ?? null,
      verifiedAt: i.verified_at ?? null,
      brief: i.brief ?? null,
      keyResults: [...(i.key_results ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((k) => ({
          id: k.id,
          name: k.name,
          baseline: k.baseline_value,
          current: k.current_value,
          target: k.target_value,
          unit: k.unit,
          updatedAt: k.updated_at ?? null,
        })),
    }));

  const initiativeDomain = new Map(initiatives.map((i) => [i.id, i.domainId]));

  // ── the tasks' verdict on their project — computed BEFORE projects are built,
  // straight off the raw rows, so a project's status can be derived once here and
  // every consumer downstream reads the same honest answer (see below).
  const roll = new Map<string, { open: number; total: number; lastDoneAt: string | null }>();
  for (const t of taskRows) {
    if (t.status === "trashed" || !t.project_id) continue;
    const e = roll.get(t.project_id) ?? { open: 0, total: 0, lastDoneAt: null };
    e.total++;
    if (t.status === "done") {
      if (t.completed_at && (!e.lastDoneAt || t.completed_at > e.lastDoneAt)) e.lastDoneAt = t.completed_at;
    } else e.open++;
    roll.set(t.project_id, e);
  }

  const projects: Project[] = [...projectRows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => {
      const stored = normalizeProjectStatus(p.status);
      const r = roll.get(p.id);
      // ── the tasks decide whether a project is complete ──────────────────────
      // Finish every task and the project IS complete — derived right here, so it
      // lands everywhere at once (table, deck, week panel, readiness) the instant
      // the last box is ticked. No cascade write to fire and no mutation path to
      // miss (tasks close from the rail, the record, the agent…).
      //
      // It runs BOTH ways, which is the point: untick a task and the project
      // un-completes itself, even one shipped by hand — a stored `complete` can't
      // outvote live work, or a reopened task would leave a "Shipped" project with
      // something still open (the false signal we just spent the day removing).
      //
      // Guards: it takes at least ONE task to be complete (an empty project is
      // unstarted, not finished — a hand-set status is the only way there), and
      // `waiting` / `cancelled` are yours and win outright. We never touch the
      // backlog↔in_progress line — that's a stored distinction ("not started yet"
      // is real even with tasks on it). The raw value survives as `storedStatus`
      // for the record's "you set this" affordance.
      const parked = stored === "waiting" || stored === "cancelled";
      const byTasks: ProjectStatus | null =
        parked || r == null || r.total === 0
          ? null
          : r.open === 0
            ? "complete"
            : stored === "complete"
              ? "in_progress" // reopened — live work outvotes the old seal
              : null;
      const status = byTasks ?? stored;
      const complete = status === "complete";
      return {
        id: p.id,
        initiativeId: p.initiative_id,
        keyResultId: p.key_result_id ?? null,
        domainId: p.domain_id ?? (p.initiative_id ? initiativeDomain.get(p.initiative_id) ?? "" : ""),
        name: p.name,
        outcome: p.outcome,
        description: p.description,
        startDate: p.start_date,
        targetDate: p.target_date,
        status,
        storedStatus: stored,
        progress: p.progress,
        // Derived-complete has no stamp of its own: it shipped when its last task
        // did, which is exactly what the week's scoreboard needs to date it. And
        // a reopened project has no ship date at all — clearing it keeps the old
        // stamp from counting it as a win on the week's scoreboard.
        shippedAt: complete ? p.shipped_at ?? r?.lastDoneAt ?? null : null,
        createdAt: p.created_at ?? null,
        tendedAt: p.tended_at ?? null,
        verification: p.verification ?? null,
        verifiedAt: p.verified_at ?? null,
        brief: p.brief ?? null,
      };
    });

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
  // Alongside the week/quarter/last totals, bucket each completed block into one
  // of the last 13 weeks — the faithfulness "pulse" the open domain renders as an arc.
  const WEEK_MS = 7 * 86_400_000;
  const seriesStart = weekStart.getTime() - 12 * WEEK_MS;
  const ledger = new Map<string, { week: number; quarter: number; last: number | null }>();
  const weekly = new Map<string, number[]>();
  // …and into one of THIS week's seven days, so the wall can show the *shape* of
  // the week (which days a domain actually got) and not just its share. Calendar
  // days, not fixed 24h steps — a DST week still has seven columns.
  const daily = new Map<string, number[]>();
  const addDay = (domainId: string, at: number, mins: number) => {
    if (at < weekStart.getTime()) return;
    const i = differenceInCalendarDays(new Date(at), weekStart);
    if (i < 0 || i > 6) return;
    const arr = daily.get(domainId) ?? new Array(7).fill(0);
    arr[i] += mins;
    daily.set(domainId, arr);
  };
  for (const t of tasks) {
    if (t.status !== "done" || !t.completedAt || !t.domainId) continue;
    const at = new Date(t.completedAt).getTime();
    const entry = ledger.get(t.domainId) ?? { week: 0, quarter: 0, last: null };
    if (at >= weekStart.getTime()) entry.week += t.durationMins;
    addDay(t.domainId, at, t.durationMins);
    if (at >= quarterStart.getTime()) entry.quarter += t.durationMins;
    if (entry.last == null || at > entry.last) entry.last = at;
    ledger.set(t.domainId, entry);

    if (at >= seriesStart) {
      const wk = Math.floor((at - seriesStart) / WEEK_MS);
      if (wk >= 0 && wk <= 12) {
        const arr = weekly.get(t.domainId) ?? new Array(13).fill(0);
        arr[wk] += t.durationMins;
        weekly.set(t.domainId, arr);
      }
    }
  }

  // ── fold attended calendar events into the same ledger (actuals) ───────────
  // A past, non-declined, busy meeting spent real time in its domain — count it
  // like a completed block. `meetingWeek` keeps the meeting slice separable so
  // the UI can show "of which N h in meetings" without re-deriving.
  const validDomain = new Set(domainRows.map((d) => d.id));
  const meetingWeek = new Map<string, number>();
  for (const e of events) {
    if (!eventCountsAsActual(e, now, actualsFilter)) continue;
    const domainId = eventDomainId(e, calendarDomainMap, eventRouting);
    if (!domainId || !validDomain.has(domainId)) continue;
    const mins = eventMins(e);
    const at = new Date(e.end_at).getTime();
    const entry = ledger.get(domainId) ?? { week: 0, quarter: 0, last: null };
    if (at >= weekStart.getTime()) {
      entry.week += mins;
      meetingWeek.set(domainId, (meetingWeek.get(domainId) ?? 0) + mins);
    }
    // day bucket anchors on the START — a meeting that runs past midnight
    // belongs to the day you sat down for it
    addDay(domainId, new Date(e.start_at).getTime(), mins);
    if (at >= quarterStart.getTime()) entry.quarter += mins;
    if (entry.last == null || at > entry.last) entry.last = at;
    ledger.set(domainId, entry);

    if (at >= seriesStart) {
      const wk = Math.floor((at - seriesStart) / WEEK_MS);
      if (wk >= 0 && wk <= 12) {
        const arr = weekly.get(domainId) ?? new Array(13).fill(0);
        arr[wk] += mins;
        weekly.set(domainId, arr);
      }
    }
  }

  // ── fold FINISH LINES into the same ledger ────────────────────────────────
  // Shipping is the loudest thing that can happen in a domain, and until now it
  // reached the ledger through one accident: a task that happened to be checked
  // off. Ship with no tasks, ship with the "drop" verdict (ShipAssess trashes the
  // leftovers and trashed rows never reach `tasks`), or ship one whose last task
  // closed last week — and the domain still read "quiet". D-085 again: the ledger
  // was honest about its inputs and its inputs were incomplete.
  //
  // A ship contributes a TOUCH, NOT HOURS. It never lands in `entry.week`,
  // `entry.quarter`, `weekly[]` or `daily[]` — the 13-week pulse and
  // `investedThisWeek` stay measured time only (P6: an hour is a thing you can
  // point at; a ship is not a duration).
  const shipped = new Map<string, { name: string; at: number }>();
  for (const p of projects) {
    if (!p.shippedAt || !p.domainId || !validDomain.has(p.domainId)) continue;
    const at = new Date(p.shippedAt).getTime();
    if (Number.isNaN(at) || at > now.getTime()) continue;
    const cur = shipped.get(p.domainId);
    if (!cur || at > cur.at) shipped.set(p.domainId, { name: p.name, at });
    const entry = ledger.get(p.domainId) ?? { week: 0, quarter: 0, last: null };
    if (entry.last == null || at > entry.last) entry.last = at;
    ledger.set(p.domainId, entry);
  }

  const daysSince = (at: number) => Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));

  const domains: Domain[] = [...domainRows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((d, idx) => {
      const led = ledger.get(d.id);
      const ship = shipped.get(d.id);
      return {
        id: d.id,
        name: d.name,
        color: d.color,
        icon: d.icon || "◇",
        intention: d.intention,
        charter: d.charter ?? "",
        context: d.context ?? null,
        weeklyTargetHours: d.weekly_target_hours ?? 0,
        investedThisWeek: led ? led.week / 60 : 0,
        meetingHoursThisWeek: (meetingWeek.get(d.id) ?? 0) / 60,
        quarterHours: led ? Math.round(led.quarter / 60) : 0,
        lastTouchedDays: led?.last != null ? daysSince(led.last) : null,
        lastShip: ship ? { name: ship.name, daysAgo: daysSince(ship.at) } : null,
        weeks: (weekly.get(d.id) ?? new Array(13).fill(0)).map((m: number) => m / 60),
        days: (daily.get(d.id) ?? new Array(7).fill(0)).map((m: number) => m / 60),
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
    bigRocks: sprint?.big_rocks ?? [],
    lastActivityByProject,
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

// ── OKR alignment — work pointed at an outcome (a key result) ────────────────
/** A key result's attainment, 0..100 — the Gain from baseline toward target. */
export function krPct(kr: KeyResult): number {
  if (kr.target === kr.baseline) return kr.current >= kr.target ? 100 : 0;
  const p = (kr.current - kr.baseline) / (kr.target - kr.baseline);
  return Math.max(0, Math.min(100, Math.round(p * 100)));
}

/** Projects pointed at a given key result. */
export const projectsOfKeyResult = (d: VerticalData, krId: string) =>
  d.projects.filter((p) => p.keyResultId === krId);

/** Tasks pointed at a given key result (directly, or via their project). */
export const tasksOfKeyResult = (d: VerticalData, krId: string) =>
  d.tasks.filter(
    (t) => t.keyResultId === krId || (t.projectId && projectById(d, t.projectId)?.keyResultId === krId),
  );

/** How much open work is aimed at a KR — the coverage read. A KR with zero
 *  supporting projects AND zero supporting tasks is uncovered: a number nothing
 *  is moving. */
export function krCoverage(
  d: VerticalData,
  krId: string,
): { projects: number; openTasks: number; covered: boolean } {
  const projects = projectsOfKeyResult(d, krId).filter((p) => isOpenStatus(p.status)).length;
  const openTasks = tasksOfKeyResult(d, krId).filter((t) => t.status !== "done").length;
  return { projects, openTasks, covered: projects > 0 || openTasks > 0 };
}

/** Key results on an initiative that nothing is working toward — the alignment
 *  gap the grooming surfaces ("this number has no supporting work"). */
export const uncoveredKeyResults = (d: VerticalData, i: Initiative) =>
  i.keyResults.filter((kr) => !krCoverage(d, kr.id).covered);

/** Every task that serves an initiative's outcome — parented to it (through the
 *  project chain) OR pointed straight at one of its key results. The set the
 *  invested-effort read sums over. */
export function tasksOfInitiative(d: VerticalData, i: Initiative): VTask[] {
  const krIds = new Set(i.keyResults.map((k) => k.id));
  const projectIds = new Set(projectsOf(d, i.id).map((p) => p.id));
  return d.tasks.filter(
    (t) =>
      t.initiativeId === i.id ||
      (t.projectId && projectIds.has(t.projectId)) ||
      (t.keyResultId && krIds.has(t.keyResultId)),
  );
}

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
  if (isProjectComplete(p.status)) return 100;
  if (ts.length === 0) return p.progress;
  const done = ts.filter((t) => t.status === "done").length;
  return Math.round((done / ts.length) * 100);
}

/** The project's still-open work — what wouldn't ship with it. */
export function openTasksOf(d: VerticalData, projectId: string): VTask[] {
  return tasksOf(d, projectId).filter((t) => t.status !== "done");
}

/** True when the stored status is one of the sticky human overrides the
 *  derivation honors verbatim — used by the record to offer "back to auto". */
export function isStatusOverride(status: string): boolean {
  return status === "waiting" || status === "cancelled" || status === "complete";
}

/** An initiative's OUTCOME attainment — the mean of its key results' Gain.
 *  Null when the bet carries no KRs (nothing measurable to attain yet), so
 *  callers can fall back to execution. This is the needle, not the activity. */
export function initiativeAttainment(d: VerticalData, i: Initiative): number | null {
  void d;
  if (i.keyResults.length === 0) return null;
  const sum = i.keyResults.reduce((acc, kr) => acc + krPct(kr), 0);
  return Math.round(sum / i.keyResults.length);
}

/** An initiative's EXECUTION — how much of the work under it is done (mean of
 *  its projects' progress, else its stored %). The "are we moving" read that
 *  pairs with attainment to expose the activity-vs-outcome gap. */
export function initiativeExecution(d: VerticalData, i: Initiative): number {
  const ps = projectsOf(d, i.id);
  if (ps.length === 0) return i.progress;
  const sum = ps.reduce((acc, p) => acc + projectProgress(d, p), 0);
  return Math.round(sum / ps.length);
}

/** An initiative's headline progress. Outcome-first: when it has key results,
 *  progress IS their attainment (the needle); otherwise it falls back to
 *  execution (task completion) so KR-less bets still read sensibly. */
export function initiativeProgress(d: VerticalData, i: Initiative): number {
  if (isProjectComplete(i.status)) return 100;
  const attain = initiativeAttainment(d, i);
  return attain ?? initiativeExecution(d, i);
}

/** A domain's rolled-up progress = mean of its active initiatives' progress. */
export function domainProgress(d: VerticalData, domainId: string): number {
  const is = initiativesOf(d, domainId).filter((i) => isOpenStatus(i.status));
  if (is.length === 0) return 0;
  const sum = is.reduce((acc, i) => acc + initiativeProgress(d, i), 0);
  return Math.round(sum / is.length);
}

/**
 * An initiative's progress as it stood at a past moment: tasks completed
 * before `cutoff` count as done, everything else as open. This is what lets
 * the Sunday ritual show real week-over-week deltas with no snapshot table.
 *
 * Must share `initiativeProgress`'s basis or the ritual deltas compare apples
 * to oranges. KR `current_value` carries no history, so an outcome-measured
 * bet can't show a back-dated number — we return its current attainment
 * (delta 0: "no *measured* movement"), which is the honest read until KR
 * snapshots exist. KR-less bets keep the task-based historical calc.
 */
export function initiativeProgressAt(d: VerticalData, i: Initiative, cutoff: Date): number {
  if (isProjectComplete(i.status)) return 100;
  const attain = initiativeAttainment(d, i);
  if (attain != null) return attain;
  const ps = projectsOf(d, i.id);
  if (ps.length === 0) return i.progress;
  const cut = cutoff.getTime();
  const per = ps.map((p) => {
    // a manually-done project counts 100 on BOTH sides, or it would show a
    // phantom "moved" delta every week forever
    if (isProjectComplete(p.status)) return 100;
    const ts = tasksOf(d, p.id);
    if (ts.length === 0) return p.progress;
    const done = ts.filter(
      (t) => t.status === "done" && t.completedAt && new Date(t.completedAt).getTime() < cut,
    ).length;
    return Math.round((done / ts.length) * 100);
  });
  return Math.round(per.reduce((a, b) => a + b, 0) / per.length);
}

// ── OKR intelligence — outcome vs effort, and risk ───────────────────────────
/** Hours of completed work that served an initiative — its whole task set
 *  (project chain + KR-linked + loose), summed over done blocks. The effort
 *  side of the activity-vs-outcome read. */
export function initiativeInvestedHours(d: VerticalData, i: Initiative): number {
  const mins = tasksOfInitiative(d, i)
    .filter((t) => t.status === "done")
    .reduce((sum, t) => sum + (t.durationMins || 0), 0);
  return Math.round((mins / 60) * 10) / 10;
}

/** The gap between doing and moving the needle: a lot of finished work while
 *  the key results sit near baseline is busywork. `busywork` fires only once
 *  there's real effort logged (≥ {@link BUSYWORK_HOURS}h) against an outcome
 *  that has barely moved (attainment < {@link BUSYWORK_ATTAINMENT}%). */
export const BUSYWORK_HOURS = 4;
export const BUSYWORK_ATTAINMENT = 15;
export function initiativeEffortGap(
  d: VerticalData,
  i: Initiative,
): { investedHours: number; attainment: number | null; busywork: boolean } {
  const investedHours = initiativeInvestedHours(d, i);
  const attainment = initiativeAttainment(d, i);
  const busywork =
    attainment != null && investedHours >= BUSYWORK_HOURS && attainment < BUSYWORK_ATTAINMENT;
  return { investedHours, attainment, busywork };
}

/** Days since any key result was last measured (null when none carry a stamp). */
export function krStaleDays(i: Initiative, now: Date = new Date()): number | null {
  const stamps = i.keyResults
    .map((kr) => (kr.updatedAt ? new Date(kr.updatedAt).getTime() : null))
    .filter((t): t is number => t != null);
  if (stamps.length === 0) return null;
  const newest = Math.max(...stamps);
  return Math.max(0, Math.floor((now.getTime() - newest) / 86_400_000));
}

/** How many days remain to the finish line — negative once overdue. */
export function daysToTarget(i: Initiative, now: Date = new Date()): number | null {
  if (!i.targetDate) return null;
  return differenceInCalendarDays(parseDateISO(i.targetDate), now);
}

/** Is this bet drifting? Off-track (the runway is shorter than the outcome
 *  remaining), measurements gone stale, or already overdue while open. Returns
 *  the reasons so the UI can name why, not just flash a dot. */
export const KR_STALE_DAYS = 14;
export function initiativeAtRisk(
  d: VerticalData,
  i: Initiative,
  now: Date = new Date(),
): { atRisk: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!isOpenStatus(i.status)) return { atRisk: false, reasons };

  const attain = initiativeAttainment(d, i);
  const days = daysToTarget(i, now);
  if (days != null && days < 0 && (attain ?? 0) < 100) reasons.push("overdue");
  // off-track: outcome still far from done but little runway left (≤ 21 days)
  if (attain != null && days != null && days >= 0 && days <= 21 && attain < 70)
    reasons.push("behind pace");

  const stale = krStaleDays(i, now);
  if (stale != null && stale >= KR_STALE_DAYS) reasons.push(`unmeasured ${stale}d`);

  // a measured bet whose numbers nobody is moving
  if (i.keyResults.length > 0 && uncoveredKeyResults(d, i).length === i.keyResults.length)
    reasons.push("no work on any KR");

  return { atRisk: reasons.length > 0, reasons };
}

/** Rank for "where should the needle-moving effort go" — the prioritization
 *  read. Higher = more urgent: a big remaining outcome gap, a near finish line,
 *  and staleness all push it up. Pure and stable so floors can sort by it. */
export function initiativePriorityScore(
  d: VerticalData,
  i: Initiative,
  now: Date = new Date(),
): number {
  if (!isOpenStatus(i.status)) return 0;
  const gap = 100 - initiativeProgress(d, i); // how much outcome remains
  const days = daysToTarget(i, now);
  // urgency: tightens as the finish line nears (and spikes when overdue)
  const urgency = days == null ? 1 : days <= 0 ? 2.5 : Math.max(0.5, Math.min(2, 30 / (days + 7)));
  const stale = krStaleDays(i, now);
  const staleBoost = stale != null && stale >= KR_STALE_DAYS ? 1.25 : 1;
  return Math.round(gap * urgency * staleBoost);
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

// ── Faithfulness rhythm — read from the 13-week pulse ────────────────────────
/** Trailing run of most-recent weeks with any invested hours — the streak. */
export function domainStreak(weeks: number[]): number {
  let n = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i] > 0) n++;
    else break;
  }
  return n;
}

/** How many of the last 13 weeks any time was kept — "kept faith N of 13". */
export function domainKeptCount(weeks: number[]): number {
  return weeks.filter((h) => h > 0).length;
}

/** The longest unbroken run of quiet (zero-hour) weeks in the pulse. */
export function domainLongestQuiet(weeks: number[]): number {
  let best = 0;
  let run = 0;
  for (const h of weeks) {
    if (h > 0) run = 0;
    else best = Math.max(best, ++run);
  }
  return best;
}

/** Completed blocks parked in a domain over the last 90 days — the "built" count
 *  that pairs with `quarterHours` (the hours) in the open domain's Gain read. */
export function domainQuarterDone(
  d: VerticalData,
  domainId: string,
  now: Date = new Date(),
): number {
  const since = subDays(now, 90).getTime();
  return d.tasks.filter(
    (t) =>
      t.status === "done" &&
      t.domainId === domainId &&
      t.completedAt != null &&
      new Date(t.completedAt).getTime() >= since,
  ).length;
}

/** A finish line keeps a domain warm for a week — a ship is a bigger event than
 *  an hour, and the week is the ritual's own beat. */
export const SHIP_GLOW_DAYS = 7;
/** Below two weeks, a QUARTERLY instrument has nothing to report that the 13-week
 *  pulse doesn't already draw (overview.md — no domain dark for a quarter).
 *  Domain altitude is not day altitude. */
export const QUIET_SPEAKS_DAYS = 14;
/** Past a quarter, "resting after a ship" stops being true — that's drift. */
export const QUARTER_DAYS = 91;

/** Domain altitude speaks in WEEKS. The pulse is 13 of them and the health horizon
 *  is a quarter; a day count invites a daily reading of a quarterly instrument,
 *  which is how "quiet for 7 days" became an accusation. */
export const weeksLabel = (days: number) => `${Math.max(1, Math.floor(days / 7))}w`;

/** Faithfulness read: lit = tended recently, dim = going quiet. */
export function faithfulness(dom: Domain): { lit: boolean; note: string } {
  // a finish line crossed this week keeps the sigil warm even with no hours on it
  if (dom.lastShip && dom.lastShip.daysAgo <= SHIP_GLOW_DAYS) return { lit: true, note: "shipped" };
  if (dom.lastTouchedDays != null && dom.lastTouchedDays <= 2) return { lit: true, note: "kept" };
  if (dom.investedThisWeek > dom.weeklyTargetHours)
    return { lit: true, note: `over ${Math.round(dom.investedThisWeek)}h` };
  if (dom.lastTouchedDays == null) return { lit: false, note: "unstarted" };
  return { lit: false, note: `quiet ${weeksLabel(dom.lastTouchedDays)}` };
}
