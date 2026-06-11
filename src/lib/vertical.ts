// The vertical layer — tasks -> projects -> initiatives -> domains — as plain
// data, selectors, and pure CRUD reducers. The shape mirrors the Supabase
// tables (00000000000003_vertical.sql) so the localStorage-backed store in
// useVertical.tsx can be swapped for live hooks without touching the views.

import type { Energy } from "./energy";

export type Momentum = "up" | "flat" | "down";

export interface Domain {
  id: string;
  name: string;
  color: string;
  icon: string; // a single glyph/emoji — domains are fixtures, give them a face
  intention: string; // the standing vow — what faithfulness to this domain means
  weeklyTargetHours: number;
  investedThisWeek: number;
  quarterHours: number; // the long arc (Gain)
  lastTouchedDays: number; // days since last meaningful activity → faithfulness
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

export interface VTask {
  id: string;
  projectId: string | null;
  initiativeId: string | null;
  domainId: string | null;
  title: string;
  energy: Energy | null;
  durationMins: number;
  deadlineDaysAway: number | null;
  status: "ready" | "scheduled" | "done" | "blocked";
  // position on the project timeline, both 0..1 (start, span)
  tl?: { start: number; span: number };
  // is this a loose capture (no project) vs a project-backlog task
  loose?: boolean;
  // committed to the current weekly sprint (the funnel)
  sprint?: boolean;
}

export interface VerticalData {
  domains: Domain[];
  initiatives: Initiative[];
  projects: Project[];
  tasks: VTask[];
  // the current weekly sprint's one-line goal
  sprintGoal?: string;
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

/** Inbox = loose captures with no project — the raw end of the funnel. */
export const inboxTasks = (d: VerticalData) =>
  d.tasks.filter((t) => !t.projectId && t.status !== "done");

/** Ready, undone, not-yet-committed tasks that live under a project. */
export const backlogTasks = (d: VerticalData) =>
  d.tasks.filter((t) => t.projectId && t.status !== "done");

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

/** Faithfulness read: lit = tended recently, dim = going quiet. */
export function faithfulness(dom: Domain): { lit: boolean; note: string } {
  if (dom.lastTouchedDays <= 2) return { lit: true, note: "tended" };
  if (dom.investedThisWeek > dom.weeklyTargetHours)
    return { lit: true, note: `over ${Math.round(dom.investedThisWeek)}h` };
  return { lit: false, note: `quiet ${dom.lastTouchedDays}d` };
}

// ── ids + factories ──────────────────────────────────────────────────────────
let counter = 0;
export function newId(prefix: string): string {
  // crypto.randomUUID exists in the browser/Tauri webview; counter is a fallback.
  try {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    counter += 1;
    return `${prefix}_${counter}`;
  }
}

const PALETTE = ["#DB2777", "#7C3AED", "#2563EB", "#0D9488", "#059669", "#D97706", "#4F46E5", "#DC2626"];

export function emptyDomain(sort: number): Domain {
  return {
    id: newId("d"),
    name: "New domain",
    color: PALETTE[sort % PALETTE.length],
    icon: "◇",
    intention: "",
    weeklyTargetHours: 6,
    investedThisWeek: 0,
    quarterHours: 0,
    lastTouchedDays: 0,
    sort,
  };
}

export function emptyInitiative(domainId: string): Initiative {
  return {
    id: newId("i"),
    domainId,
    name: "New initiative",
    outcome: "",
    description: "",
    startDate: null,
    targetDate: null,
    status: "active",
    progress: 0,
    momentum: "flat",
    keyResults: [],
  };
}

export function emptyProject(domainId: string, initiativeId: string | null): Project {
  return {
    id: newId("p"),
    initiativeId,
    domainId,
    name: "New project",
    outcome: "",
    description: "",
    startDate: null,
    targetDate: null,
    status: "planned",
    progress: 0,
  };
}

export function emptyKeyResult(): KeyResult {
  return { id: newId("kr"), name: "New result", baseline: 0, current: 0, target: 100, unit: "%" };
}

export function emptyTask(parent: {
  projectId?: string | null;
  initiativeId?: string | null;
  domainId?: string | null;
}): VTask {
  return {
    id: newId("t"),
    projectId: parent.projectId ?? null,
    initiativeId: parent.initiativeId ?? null,
    domainId: parent.domainId ?? null,
    title: "",
    energy: "quick",
    durationMins: 20,
    deadlineDaysAway: null,
    status: "ready",
    loose: !parent.projectId,
  };
}

// ── Seed (Phil's real domains, from energy.ts) ───────────────────────────────
// Domains barely change — the anchor. Initiatives/projects/tasks are illustrative
// and meant to be replaced as you dogfood.
export const SEED: VerticalData = {
  sprintGoal: "Close the books and keep Sundays excellent — without going quiet on Family.",
  domains: [
    { id: "d_family", name: "Family", color: "#DB2777", icon: "❤", sort: 0,
      intention: "Be present. They get the best of me, not the leftovers.",
      weeklyTargetHours: 12, investedThisWeek: 4, quarterHours: 110, lastTouchedDays: 4 },
    { id: "d_frontier", name: "Frontier", color: "#7C3AED", icon: "✝", sort: 1,
      intention: "Steward Frontier faithfully — finances clean, Sundays excellent.",
      weeklyTargetHours: 8, investedThisWeek: 6, quarterHours: 84, lastTouchedDays: 1 },
    { id: "d_sce", name: "SCE", color: "#2563EB", icon: "◈", sort: 2,
      intention: "Do work that compounds; don't let it eat the rest.",
      weeklyTargetHours: 22, investedThisWeek: 24, quarterHours: 280, lastTouchedDays: 0 },
    { id: "d_trading", name: "Trading", color: "#0D9488", icon: "△", sort: 3,
      intention: "Edge through discipline, not screen time.",
      weeklyTargetHours: 5, investedThisWeek: 2, quarterHours: 40, lastTouchedDays: 12 },
    { id: "d_personal", name: "Personal", color: "#059669", icon: "✦", sort: 4,
      intention: "Body and soul maintained, not deferred.",
      weeklyTargetHours: 6, investedThisWeek: 3, quarterHours: 50, lastTouchedDays: 2 },
    { id: "d_melu", name: "Melu", color: "#D97706", icon: "◐", sort: 5,
      intention: "Build it real or shelve it.",
      weeklyTargetHours: 4, investedThisWeek: 1, quarterHours: 28, lastTouchedDays: 6 },
    { id: "d_aiops", name: "AIOps", color: "#4F46E5", icon: "⬡", sort: 6,
      intention: "Ship leverage, not demos.",
      weeklyTargetHours: 4, investedThisWeek: 5, quarterHours: 60, lastTouchedDays: 1 },
  ],
  initiatives: [
    { id: "i_fin", domainId: "d_family", name: "Get finances clean",
      outcome: "Books reconciled & audited, monthly close under 2 days.",
      description: "Untangle the family books end-to-end so we stop flying blind: clean categories, every account reconciled, and a repeatable monthly close I can run in an afternoon.",
      startDate: "2026-04-01", targetDate: "2026-08-01", status: "active", progress: 60, momentum: "up",
      keyResults: [
        { id: "kr1", name: "Months reconciled", baseline: 0, current: 4, target: 6, unit: "mo" },
        { id: "kr2", name: "Accountant sign-off", baseline: 0, current: 0, target: 1, unit: "" },
        { id: "kr3", name: "Monthly close time", baseline: 9, current: 5, target: 2, unit: "d" },
      ] },
    { id: "i_trip", domainId: "d_family", name: "Plan summer trip",
      outcome: "Booked & paid by July.",
      description: "A real family trip on the calendar — flights, stay, and the rough itinerary settled so nobody is scrambling in July.",
      startDate: "2026-05-01", targetDate: "2026-07-01",
      status: "active", progress: 25, momentum: "flat", keyResults: [] },
    { id: "i_date", domainId: "d_family", name: "Weekly date nights",
      outcome: "52 nights this year.",
      description: "Protect the marriage with a non-negotiable weekly rhythm.",
      startDate: "2026-01-01", targetDate: null,
      status: "active", progress: 80, momentum: "up", keyResults: [] },
    { id: "i_close", domainId: "d_frontier", name: "Clean monthly close",
      outcome: "Dext + Latitude close in 2 days, zero chase.",
      description: "Make Frontier's monthly close boringly reliable: receipts captured as they happen, Karbon checklist humming, David never waiting on me.",
      startDate: "2026-05-01", targetDate: "2026-06-30", status: "active", progress: 45, momentum: "up",
      keyResults: [
        { id: "kr4", name: "Receipts cleared", baseline: 40, current: 12, target: 0, unit: "" },
        { id: "kr5", name: "Karbon checklist", baseline: 0, current: 6, target: 9, unit: "" },
      ] },
    { id: "i_sunday", domainId: "d_frontier", name: "Sunday service excellence",
      outcome: "Teams confirmed by Thursday, zero gaps.",
      description: "Every Sunday lands well because the week before it was planned — rosters set, songs ready, setup/teardown owned.",
      startDate: "2026-01-01", targetDate: null,
      status: "active", progress: 70, momentum: "flat", keyResults: [] },
    { id: "i_board", domainId: "d_sce", name: "Q3 board deck",
      outcome: "Approved at the July board.",
      description: "A board deck that tells a clean story on growth, runway, and the hiring plan — circulated early, no surprises in the room.",
      startDate: "2026-06-01", targetDate: "2026-07-15", status: "active", progress: 40, momentum: "up", keyResults: [] },
    { id: "i_hire", domainId: "d_sce", name: "Close 2 hires",
      outcome: "Two senior roles signed.",
      description: "Two senior engineers signed and starting — pipeline full, loops tight, offers out fast.",
      startDate: "2026-05-15", targetDate: "2026-09-01",
      status: "active", progress: 20, momentum: "flat", keyResults: [] },
    { id: "i_backtest", domainId: "d_trading", name: "Backtest system v2",
      outcome: "Validated edge, live by Q4.",
      description: "Rebuild the backtester so an edge is provable before a dollar is risked — clean data, honest stats, paper-traded first.",
      startDate: "2026-06-01", targetDate: "2026-09-30", status: "active", progress: 15, momentum: "down", keyResults: [] },
    { id: "i_base", domainId: "d_personal", name: "Marathon base",
      outcome: "40mi/week base by September.",
      description: "Build an aerobic base that holds — consistent mileage, no injury, sleep protected.",
      startDate: "2026-05-01", targetDate: "2026-09-15",
      status: "active", progress: 35, momentum: "up", keyResults: [] },
  ],
  projects: [
    { id: "p_q3recon", initiativeId: "i_fin", domainId: "d_family", name: "Q3 reconciliation",
      outcome: "Q3 fully reconciled & tied to statements.", description: "", startDate: "2026-06-01", targetDate: "2026-06-30", status: "active", progress: 60 },
    { id: "p_ynab", initiativeId: "i_fin", domainId: "d_family", name: "Set up YNAB",
      outcome: "Budget live, accounts linked.", description: "", startDate: "2026-04-01", targetDate: "2026-04-20", status: "done", progress: 100 },
    { id: "p_tax", initiativeId: "i_fin", domainId: "d_family", name: "Tax prep",
      outcome: "Docs gathered, handed to CPA.", description: "", startDate: "2026-07-01", targetDate: "2026-07-31", status: "blocked", progress: 10 },
    { id: "p_q2recon", initiativeId: "i_close", domainId: "d_frontier", name: "Q2 reconciliation",
      outcome: "Q2 closed clean.", description: "", startDate: "2026-05-05", targetDate: "2026-06-15", status: "active", progress: 50 },
    { id: "p_receipts", initiativeId: "i_close", domainId: "d_frontier", name: "Clear receipt backlog to Dext",
      outcome: "Backlog to zero, flowing live.", description: "", startDate: "2026-05-01", targetDate: "2026-06-20", status: "active", progress: 70 },
    { id: "p_deck", initiativeId: "i_board", domainId: "d_sce", name: "Build deck v3",
      outcome: "Deck v3 circulated to board.", description: "", startDate: "2026-06-05", targetDate: "2026-07-10", status: "active", progress: 40 },
    { id: "p_ticks", initiativeId: "i_backtest", domainId: "d_trading", name: "Clean tick data",
      outcome: "Gap-free tick dataset.", description: "", startDate: "2026-06-01", targetDate: "2026-07-15", status: "blocked", progress: 15 },
  ],
  tasks: [
    // Q3 reconciliation — the focused project's timeline
    { id: "t1", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Pull bank statements", energy: "quick", durationMins: 20, deadlineDaysAway: null,
      status: "done", tl: { start: 0, span: 0.2 } },
    { id: "t2", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Categorize receipts", energy: "quick", durationMins: 15, deadlineDaysAway: 1,
      status: "ready", sprint: true, tl: { start: 0.18, span: 0.3 } },
    { id: "t3", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Reconcile checking", energy: "decide", durationMins: 45, deadlineDaysAway: 3,
      status: "ready", sprint: true, tl: { start: 0.45, span: 0.3 } },
    { id: "t4", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Call David about Q3 numbers", energy: "deep", durationMins: 30, deadlineDaysAway: 2,
      status: "ready", tl: { start: 0.7, span: 0.18 } },
    { id: "t5", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Accountant sign-off", energy: "delegate", durationMins: 15, deadlineDaysAway: 7,
      status: "blocked", tl: { start: 0.82, span: 0.16 } },
    // other ready candidates that feed the intelligent Now
    { id: "t6", projectId: "p_receipts", initiativeId: "i_close", domainId: "d_frontier",
      title: "Send receipts to Dext", energy: "quick", durationMins: 15, deadlineDaysAway: 1, status: "ready", sprint: true },
    { id: "t7", projectId: "p_deck", initiativeId: "i_board", domainId: "d_sce",
      title: "Review Q3 board deck", energy: "deep", durationMins: 45, deadlineDaysAway: 5, status: "ready" },
    { id: "t8", projectId: "p_ticks", initiativeId: "i_backtest", domainId: "d_trading",
      title: "Patch tick-data gaps", energy: "decide", durationMins: 20, deadlineDaysAway: null, status: "ready" },
    // a loose capture (no project) — lives in the capture inbox
    { id: "t9", projectId: null, initiativeId: null, domainId: "d_sce",
      title: "Reply to Sarah", energy: "quick", durationMins: 10, deadlineDaysAway: null, status: "ready", loose: true },
    // a loose family task that deserves no project — the "teach my kid to ride a bike" case
    { id: "t10", projectId: null, initiativeId: null, domainId: "d_family",
      title: "Teach Eli to ride his bike", energy: "deep", durationMins: 60, deadlineDaysAway: null, status: "ready", loose: true },
  ],
};
