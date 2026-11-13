/**
 * Draft the projects (D-196) — the app's half. The shapes both runtimes trust
 * live in `_shared/projectDraft.ts`; this adds what only the app knows: which
 * weeks a quarter has from where you stand, where an initiative's own projects
 * sit on them, and when the door is offered at all.
 */

import { addDays, startOfISOWeek } from "date-fns";
import { toDateISO } from "./dates";
import { projectsOf, type Project, type VerticalData } from "./vertical";
import type { InitiativeLane } from "./initiativeDeck";
import { weekSpanFor } from "../../supabase/functions/_shared/planningRules.ts";
import type { ProjectSpan } from "../../supabase/functions/_shared/projectDraft.ts";

export {
  atOnce,
  clampSpan,
  fallbackSpans,
  packRows,
  shapeProjectProposals,
  MAX_DRAFTED_PROJECTS,
  type ProjectProposal,
  type ProjectSpan,
  type ProjectVersion,
} from "../../supabase/functions/_shared/projectDraft.ts";

/** The Mondays of a quarter that are still ahead of you (this week counts). A
 *  quarter's first Monday is the first on or after its first day; a week that
 *  began in the previous quarter belongs to that one. */
export function quarterWeeks(q: { start: Date; end: Date }, today: Date): string[] {
  let m = startOfISOWeek(q.start);
  if (m < q.start) m = addDays(m, 7);
  const thisWeek = startOfISOWeek(today);
  if (m < thisWeek) m = thisWeek;
  const out: string[] = [];
  while (m <= q.end && out.length < 16) {
    out.push(toDateISO(m));
    m = addDays(m, 7);
  }
  return out;
}

/** Which week of the grid a date falls in — the last Monday on or before it.
 *  -1 = before the grid, `weeks.length` = after it. */
export function weekIndexOf(weeks: string[], iso: string): number {
  if (!weeks.length || iso < weeks[0]) return -1;
  const last = weeks[weeks.length - 1];
  if (iso > toDateISO(addDays(new Date(last + "T12:00:00"), 6))) return weeks.length;
  let ix = 0;
  for (let i = 0; i < weeks.length; i++) if (weeks[i] <= iso) ix = i;
  return ix;
}

/** An initiative's own projects as bars on the quarter — clipped to it, and
 *  only the ones that touch it. Undated projects have no bar (they're still
 *  in the project deck's pool). */
export function ownBars(projects: Project[], weeks: string[]): ({ id: string; name: string; outcome: string; shipped: boolean } & ProjectSpan)[] {
  const out: ({ id: string; name: string; outcome: string; shipped: boolean } & ProjectSpan)[] = [];
  for (const p of projects) {
    if (!p.targetDate || p.status === "cancelled") continue;
    const a = weekIndexOf(weeks, p.startDate ?? p.targetDate);
    const b = weekIndexOf(weeks, p.targetDate);
    if (b < 0 || a >= weeks.length) continue;
    const start = Math.max(0, a);
    const end = Math.min(weeks.length - 1, b);
    out.push({ id: p.id, name: p.name, outcome: p.outcome, shipped: p.status === "complete", start, weeks: end - start + 1 });
  }
  return out;
}

/** The fields a held bar is written with — the deck's own span formula
 *  (`weekSpanFor`, the kernel's), so a held project reads on the project deck
 *  exactly where its bar stood here. */
export function heldProjectPatch(weeks: string[], span: ProjectSpan): { startDate: string; targetDate: string } {
  return weekSpanFor(weeks[span.start], span.weeks);
}

/**
 * Does this initiative's card offer ✦ Draft the projects? Only when it's about
 * to matter and there's nothing there: this quarter or next, an outcome to read
 * from, still open, and no open project under it. Just in time, like the thin
 * path (D-196) — never a door on every card.
 */
export function canDraftProjects(d: VerticalData, lane: Pick<InitiativeLane, "initiative" | "state" | "quarterIdx">): boolean {
  if (lane.quarterIdx == null || lane.quarterIdx > 1) return false;
  if (lane.state === "done" || lane.state === "parked") return false;
  if (!lane.initiative.outcome?.trim()) return false;
  return !projectsOf(d, lane.initiative.id).some((p) => p.status !== "complete" && p.status !== "cancelled");
}

/** "Jan 11 – Feb 7 · 4 weeks" — a span as the draft says it. */
export function spanLabel(weeks: string[], span: ProjectSpan): string {
  const a = new Date(weeks[span.start] + "T12:00:00");
  const b = addDays(new Date(weeks[span.start + span.weeks - 1] + "T12:00:00"), 4);
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(a)} – ${f(b)} · ${span.weeks} week${span.weeks === 1 ? "" : "s"}`;
}
