// The vertical layer — tasks -> projects -> initiatives -> domains — as plain
// data + selectors. Seeded for now so the four-floor view runs immediately;
// swap SEED for react-query hooks against the new tables when we wire the DB.

import type { Energy } from "./energy";

export type Momentum = "up" | "flat" | "down";

export interface Domain {
  id: string;
  name: string;
  color: string;
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
  outcome: string;
  targetDate: string | null;
  status: "active" | "paused" | "shipped" | "dropped";
  progress: number; // 0..100
  momentum: Momentum;
  keyResults: KeyResult[];
}

export interface Project {
  id: string;
  initiativeId: string;
  domainId: string;
  name: string;
  status: "active" | "blocked" | "done";
  progress: number; // 0..100
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
}

export interface VerticalData {
  domains: Domain[];
  initiatives: Initiative[];
  projects: Project[];
  tasks: VTask[];
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

/** Faithfulness read: lit = tended recently, dim = going quiet. */
export function faithfulness(dom: Domain): { lit: boolean; note: string } {
  if (dom.lastTouchedDays <= 2) return { lit: true, note: "tended" };
  if (dom.investedThisWeek > dom.weeklyTargetHours)
    return { lit: true, note: `over ${Math.round(dom.investedThisWeek)}h` };
  return { lit: false, note: `quiet ${dom.lastTouchedDays}d` };
}

// ── Seed (Phil's real domains, from energy.ts) ───────────────────────────────
// Domains barely change — the anchor. Initiatives/projects/tasks are illustrative
// and meant to be replaced as you dogfood.
export const SEED: VerticalData = {
  domains: [
    { id: "d_family", name: "Family", color: "#DB2777", sort: 0,
      intention: "Be present. They get the best of me, not the leftovers.",
      weeklyTargetHours: 12, investedThisWeek: 4, quarterHours: 110, lastTouchedDays: 4 },
    { id: "d_frontier", name: "Frontier", color: "#7C3AED", sort: 1,
      intention: "Steward Frontier faithfully — finances clean, Sundays excellent.",
      weeklyTargetHours: 8, investedThisWeek: 6, quarterHours: 84, lastTouchedDays: 1 },
    { id: "d_sce", name: "SCE", color: "#2563EB", sort: 2,
      intention: "Do work that compounds; don't let it eat the rest.",
      weeklyTargetHours: 22, investedThisWeek: 24, quarterHours: 280, lastTouchedDays: 0 },
    { id: "d_trading", name: "Trading", color: "#0D9488", sort: 3,
      intention: "Edge through discipline, not screen time.",
      weeklyTargetHours: 5, investedThisWeek: 2, quarterHours: 40, lastTouchedDays: 12 },
    { id: "d_personal", name: "Personal", color: "#059669", sort: 4,
      intention: "Body and soul maintained, not deferred.",
      weeklyTargetHours: 6, investedThisWeek: 3, quarterHours: 50, lastTouchedDays: 2 },
    { id: "d_melu", name: "Melu", color: "#D97706", sort: 5,
      intention: "Build it real or shelve it.",
      weeklyTargetHours: 4, investedThisWeek: 1, quarterHours: 28, lastTouchedDays: 6 },
    { id: "d_aiops", name: "AIOps", color: "#4F46E5", sort: 6,
      intention: "Ship leverage, not demos.",
      weeklyTargetHours: 4, investedThisWeek: 5, quarterHours: 60, lastTouchedDays: 1 },
  ],
  initiatives: [
    { id: "i_fin", domainId: "d_family", name: "Get finances clean",
      outcome: "Books reconciled & audited, monthly close under 2 days.",
      targetDate: "2026-08-01", status: "active", progress: 60, momentum: "up",
      keyResults: [
        { id: "kr1", name: "Months reconciled", baseline: 0, current: 4, target: 6, unit: "mo" },
        { id: "kr2", name: "Accountant sign-off", baseline: 0, current: 0, target: 1, unit: "" },
        { id: "kr3", name: "Monthly close time", baseline: 9, current: 5, target: 2, unit: "d" },
      ] },
    { id: "i_trip", domainId: "d_family", name: "Plan summer trip",
      outcome: "Booked & paid by July.", targetDate: "2026-07-01",
      status: "active", progress: 25, momentum: "flat", keyResults: [] },
    { id: "i_date", domainId: "d_family", name: "Weekly date nights",
      outcome: "52 nights this year.", targetDate: null,
      status: "active", progress: 80, momentum: "up", keyResults: [] },
    { id: "i_close", domainId: "d_frontier", name: "Clean monthly close",
      outcome: "Dext + Latitude close in 2 days, zero chase.", targetDate: "2026-06-30",
      status: "active", progress: 45, momentum: "up",
      keyResults: [
        { id: "kr4", name: "Receipts cleared", baseline: 40, current: 12, target: 0, unit: "" },
        { id: "kr5", name: "Karbon checklist", baseline: 0, current: 6, target: 9, unit: "" },
      ] },
    { id: "i_sunday", domainId: "d_frontier", name: "Sunday service excellence",
      outcome: "Teams confirmed by Thursday, zero gaps.", targetDate: null,
      status: "active", progress: 70, momentum: "flat", keyResults: [] },
    { id: "i_board", domainId: "d_sce", name: "Q3 board deck",
      outcome: "Approved at the July board.", targetDate: "2026-07-15",
      status: "active", progress: 40, momentum: "up", keyResults: [] },
    { id: "i_hire", domainId: "d_sce", name: "Close 2 hires",
      outcome: "Two senior roles signed.", targetDate: null,
      status: "active", progress: 20, momentum: "flat", keyResults: [] },
    { id: "i_backtest", domainId: "d_trading", name: "Backtest system v2",
      outcome: "Validated edge, live by Q4.", targetDate: "2026-09-30",
      status: "active", progress: 15, momentum: "down", keyResults: [] },
    { id: "i_base", domainId: "d_personal", name: "Marathon base",
      outcome: "40mi/week base by September.", targetDate: null,
      status: "active", progress: 35, momentum: "up", keyResults: [] },
  ],
  projects: [
    { id: "p_q3recon", initiativeId: "i_fin", domainId: "d_family", name: "Q3 reconciliation", status: "active", progress: 60 },
    { id: "p_ynab", initiativeId: "i_fin", domainId: "d_family", name: "Set up YNAB", status: "done", progress: 100 },
    { id: "p_tax", initiativeId: "i_fin", domainId: "d_family", name: "Tax prep", status: "blocked", progress: 10 },
    { id: "p_q2recon", initiativeId: "i_close", domainId: "d_frontier", name: "Q2 reconciliation", status: "active", progress: 50 },
    { id: "p_receipts", initiativeId: "i_close", domainId: "d_frontier", name: "Clear receipt backlog to Dext", status: "active", progress: 70 },
    { id: "p_deck", initiativeId: "i_board", domainId: "d_sce", name: "Build deck v3", status: "active", progress: 40 },
    { id: "p_ticks", initiativeId: "i_backtest", domainId: "d_trading", name: "Clean tick data", status: "blocked", progress: 15 },
  ],
  tasks: [
    // Q3 reconciliation — the focused project's timeline
    { id: "t1", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Pull bank statements", energy: "quick", durationMins: 20, deadlineDaysAway: null,
      status: "done", tl: { start: 0, span: 0.2 } },
    { id: "t2", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Categorize receipts", energy: "quick", durationMins: 15, deadlineDaysAway: 1,
      status: "ready", tl: { start: 0.18, span: 0.3 } },
    { id: "t3", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Reconcile checking", energy: "decide", durationMins: 45, deadlineDaysAway: 3,
      status: "ready", tl: { start: 0.45, span: 0.3 } },
    { id: "t4", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Call David about Q3 numbers", energy: "deep", durationMins: 30, deadlineDaysAway: 2,
      status: "ready", tl: { start: 0.7, span: 0.18 } },
    { id: "t5", projectId: "p_q3recon", initiativeId: "i_fin", domainId: "d_family",
      title: "Accountant sign-off", energy: "delegate", durationMins: 15, deadlineDaysAway: 7,
      status: "blocked", tl: { start: 0.82, span: 0.16 } },
    // other ready candidates that feed the intelligent Now
    { id: "t6", projectId: "p_receipts", initiativeId: "i_close", domainId: "d_frontier",
      title: "Send receipts to Dext", energy: "quick", durationMins: 15, deadlineDaysAway: 1, status: "ready" },
    { id: "t7", projectId: "p_deck", initiativeId: "i_board", domainId: "d_sce",
      title: "Review Q3 board deck", energy: "deep", durationMins: 45, deadlineDaysAway: 5, status: "ready" },
    { id: "t8", projectId: "p_ticks", initiativeId: "i_backtest", domainId: "d_trading",
      title: "Patch tick-data gaps", energy: "decide", durationMins: 20, deadlineDaysAway: null, status: "ready" },
    // a loose capture (no project) — lives in the capture inbox
    { id: "t9", projectId: null, initiativeId: null, domainId: "d_sce",
      title: "Reply to Sarah", energy: "quick", durationMins: 10, deadlineDaysAway: null, status: "ready", loose: true },
  ],
};
