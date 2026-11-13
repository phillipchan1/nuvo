/**
 * A thin path (D-196) — a project with time held for it and too little work in
 * it. "Launch site has a 3h block and 20m of work."
 *
 * The one rule behind the just-in-time mark. It speaks ONLY from two facts the
 * account already has, never from a score:
 *
 *   held  — the minutes of the project's slots (sittings, standing or one-off)
 *           inside a window that is about to arrive (the week being planned, or
 *           the next two weeks);
 *   work  — the minutes of its open steps, as the week composer counts them
 *           (`VTask.durationMins`, the app's own default for an unsized step —
 *           the same arithmetic that sized the block, so the two agree).
 *
 * It fires when the work is under half the held time AND at least 45 minutes
 * short, on a held total of an hour or more. That is deliberately strict: a
 * block that is merely roomy is not a problem, and a mark that fires on most
 * projects is the "groom everything" wall this replaces (P9). A brand-new
 * account has no slots, so it sees nothing — which is the correct answer (P7).
 *
 * Pure; no React, no clock. Surfaces pass the window's slots and the vertical.
 */

import { fmtMins } from "../../supabase/functions/_shared/dayShape.ts";
import type { Slot } from "./types";
import type { VerticalData } from "./vertical";

export const THIN = {
  /** a held total under this is a quick sitting, not a block to fill */
  minHeldMins: 60,
  /** work under this share of the held time reads as thin */
  ratio: 0.5,
  /** …and the room left must be at least this much */
  minGapMins: 45,
} as const;

export interface ThinPath {
  projectId: string;
  name: string;
  domainId: string;
  heldMins: number;
  workMins: number;
  openSteps: number;
  /** the earliest held slot — where the mark points ("Tue 1–4pm") */
  first: { dateISO: string; startISO: string; durationMins: number };
}

/** A slot as the rule needs it — `Slot` satisfies it; fixtures can too. */
export type HeldSlot = Pick<Slot, "project_id" | "do_date" | "start_time" | "duration_minutes">;

const OPEN = (s: string) => s !== "complete" && s !== "cancelled" && s !== "dropped" && s !== "waiting";

export function thinPaths(data: Pick<VerticalData, "projects" | "tasks">, slots: HeldSlot[]): ThinPath[] {
  const held = new Map<string, { mins: number; first: HeldSlot }>();
  for (const s of slots) {
    if (!s.project_id || !(s.duration_minutes > 0)) continue;
    const cur = held.get(s.project_id);
    if (!cur) held.set(s.project_id, { mins: s.duration_minutes, first: s });
    else {
      cur.mins += s.duration_minutes;
      if (s.start_time < cur.first.start_time) cur.first = s;
    }
  }
  const out: ThinPath[] = [];
  for (const [projectId, h] of held) {
    const p = data.projects.find((x) => x.id === projectId);
    // a shipped, dropped or parked project's block is not a gap in its path
    if (!p || !OPEN(p.status)) continue;
    const open = data.tasks.filter((t) => t.projectId === projectId && t.status !== "done");
    const workMins = open.reduce((sum, t) => sum + (t.durationMins || 0), 0);
    if (!isThin(h.mins, workMins)) continue;
    out.push({
      projectId,
      name: p.name,
      domainId: p.domainId,
      heldMins: h.mins,
      workMins,
      openSteps: open.length,
      first: { dateISO: h.first.do_date, startISO: h.first.start_time, durationMins: h.first.duration_minutes },
    });
  }
  return out.sort((a, b) => a.first.startISO.localeCompare(b.first.startISO));
}

export function isThin(heldMins: number, workMins: number): boolean {
  return heldMins >= THIN.minHeldMins && workMins < heldMins * THIN.ratio && heldMins - workMins >= THIN.minGapMins;
}

/** How many marks a surface may show at once. One cue, never a list
 *  (readiness-model §4) — two, because a week can honestly have two. */
export const THIN_MARKS_MAX = 2;

/** The mark's chip — the two facts, nothing else: `3h held · 20m of work`. */
export function thinChip(t: Pick<ThinPath, "heldMins" | "workMins">): string {
  return t.workMins === 0 ? `${fmtMins(t.heldMins)} held · no steps` : `${fmtMins(t.heldMins)} held · ${fmtMins(t.workMins)} of work`;
}
