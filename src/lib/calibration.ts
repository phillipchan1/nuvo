// Calibration — the "knows me" layer, measured. Every completed task is a
// timestamped block, so history can correct the plan: how many hours actually
// get done in a week (the proven pace), whether deep work really lands in the
// morning, and which energies chronically roll before they're finished.
// Honest by design: with no history it says so instead of guessing.

import { startOfWeek, subDays } from "date-fns";
import { parseDateISO, todayISO } from "./dates";
import type { Energy } from "./energy";
import type { VTask } from "./vertical";

const WEEK_MS = 7 * 86_400_000;
const LOOKBACK_WEEKS = 4;

export interface Calibration {
  /** How many of the last 4 weeks have any completions. */
  weeksSampled: number;
  /** Mean completed minutes across sampled weeks — the proven pace. */
  avgWeeklyDoneMins: number;
  /** Share of deep-work minutes completed before 1pm (last 60 days), 0..1. */
  deepMorningShare: number | null;
  /** Energies whose done tasks rolled noticeably before completion. */
  rollRates: { energy: Energy; avgRolls: number }[];
}

export function calibrate(tasks: VTask[], now: Date = new Date()): Calibration | null {
  const thisMonday = startOfWeek(parseDateISO(todayISO(now)), { weekStartsOn: 1 }).getTime();
  const done = tasks.filter((t) => t.status === "done" && t.completedAt);

  // proven pace: bucket completed minutes into the last 4 full weeks
  const weekly = new Array(LOOKBACK_WEEKS).fill(0) as number[];
  for (const t of done) {
    const at = new Date(t.completedAt!).getTime();
    if (at >= thisMonday) continue; // the running week doesn't count yet
    const idx = Math.floor((thisMonday - at - 1) / WEEK_MS);
    if (idx >= 0 && idx < LOOKBACK_WEEKS) weekly[idx] += t.durationMins;
  }
  const sampled = weekly.filter((m) => m > 0);
  if (sampled.length === 0) return null; // no history — say so, don't guess

  // morning share: deep minutes completed before 1pm, last 60 days
  const cutoff = subDays(now, 60).getTime();
  let deepAM = 0;
  let deepAll = 0;
  for (const t of done) {
    if (t.energy !== "deep") continue;
    const at = new Date(t.completedAt!);
    if (at.getTime() < cutoff) continue;
    deepAll += t.durationMins;
    if (at.getHours() < 13) deepAM += t.durationMins;
  }

  // roll friction per energy (≥3 samples to mean anything)
  const rollRates: Calibration["rollRates"] = [];
  for (const energy of ["deep", "decide", "delegate", "quick"] as Energy[]) {
    const sample = done.filter(
      (t) => t.energy === energy && new Date(t.completedAt!).getTime() >= cutoff,
    );
    if (sample.length < 3) continue;
    const avg = sample.reduce((s, t) => s + t.rollCount, 0) / sample.length;
    if (avg >= 1.5) rollRates.push({ energy, avgRolls: Math.round(avg * 10) / 10 });
  }

  return {
    weeksSampled: sampled.length,
    avgWeeklyDoneMins: Math.round(sampled.reduce((a, b) => a + b, 0) / sampled.length),
    deepMorningShare: deepAll >= 120 ? deepAM / deepAll : null,
    rollRates,
  };
}

/** The compose budget: proven pace + 15% room to grow. Needs ≥2 weeks. */
export function weeklyBudgetMins(cal: Calibration | null): number | null {
  if (!cal || cal.weeksSampled < 2) return null;
  return Math.round(cal.avgWeeklyDoneMins * 1.15);
}

export interface Confidence {
  pct: number; // 0..99 — chance the plan fits the proven pace
  label: "high" | "fair" | "stretch";
  deltaMins: number; // planned minus proven pace (positive = over)
}

export function confidence(plannedMins: number, cal: Calibration): Confidence | null {
  if (plannedMins <= 0) return null;
  const ratio = cal.avgWeeklyDoneMins / plannedMins;
  const pct = Math.min(99, Math.max(5, Math.round(ratio * 100)));
  return {
    pct,
    label: ratio >= 1 ? "high" : ratio >= 0.75 ? "fair" : "stretch",
    deltaMins: plannedMins - cal.avgWeeklyDoneMins,
  };
}
