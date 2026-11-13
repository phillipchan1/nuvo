// The week's track (D-206) — the crown header's ONE drawing.
//
// Each project row draws its project as a track of pieces; the header draws the
// WEEK the same way: one piece per task on the slate, in four states, ordered
//
//   done toward an initiative · done, other · placed · no time
//
// plus the pace tick for the week's own clock, and one number ("13/17 done").
// It replaces three facts that each looked different ("N of M done", "N with no
// time", the Significant bar) — the operator's "3–5 metrics all looking
// differently".
//
// Pure: `useWeekCrown` calls it over the rows it already composed, and both
// crowns draw the result. Which done task counts toward an initiative is the
// planning kernel's rule (`doneTaskSignificance`), never decided here.

import { doneTaskSignificance, isCompleteStatus } from "../../supabase/functions/_shared/planningRules.ts";
import { parseDateISO } from "./dates";
import type { WeekCrownRow } from "../hooks/useWeekCrown";

export type WeekPiece = "done-initiative" | "done-other" | "done" | "placed" | "no-time";

export interface WeekTrack {
  /** done pieces whose project ladders to an initiative */
  doneInitiative: number;
  /** every other done piece */
  doneOther: number;
  /** open pieces with a time this week */
  placed: number;
  /** open pieces with no time this week */
  noTime: number;
  done: number;
  total: number;
  /** False when the account has no initiatives (P7, P16): then the done pieces
   *  are ONE state, never scored against a ladder nobody built. */
  split: boolean;
  /** 0–1 through the planning week, or null when the week isn't the current one */
  elapsed: number | null;
  /** the whole drawing as words — the track's aria-label and title */
  label: string;
}

type TrackRow = Pick<WeekCrownRow, "work" | "placed" | "loose">;

/** How far through the planning week `now` stands — linear, Monday 00:00 to the
 *  next Monday, the same deliberately-linear clock `spanElapsed` keeps for a
 *  project. Null outside the week (a week you are planning has no "now"). */
export function weekElapsed(weekISO: string, now: Date): number | null {
  const start = parseDateISO(weekISO);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const t = now.getTime();
  if (t < start.getTime() || t >= end.getTime()) return null;
  return (t - start.getTime()) / (end.getTime() - start.getTime());
}

export function composeWeekTrack(
  rows: readonly TrackRow[],
  ladder: { projects: readonly { id: string; initiativeId: string | null }[]; initiativeIds: readonly string[] },
  elapsed: number | null,
): WeekTrack {
  // One piece per task, even when a task serves two rows.
  const seen = new Set<string>();
  const doneTasks: { projectId: string | null; status: string }[] = [];
  let placed = 0;
  let noTime = 0;
  for (const r of rows) {
    for (const t of r.work.tasks) {
      if (!isCompleteStatus(t.status) || seen.has(t.id)) continue;
      seen.add(t.id);
      doneTasks.push({ projectId: t.projectId ?? null, status: t.status });
    }
    for (const p of r.placed) {
      if (seen.has(p.task.id)) continue;
      seen.add(p.task.id);
      placed++;
    }
    for (const t of r.loose) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      noTime++;
    }
  }
  const sig = doneTaskSignificance({ tasks: doneTasks, projects: ladder.projects, initiativeIds: ladder.initiativeIds });
  const doneInitiative = sig?.initiativeTasks ?? 0;
  const doneOther = sig?.otherTasks ?? 0;
  const done = doneTasks.length;
  const total = done + placed + noTime;
  const parts: string[] = [];
  if (sig) {
    parts.push(`${doneInitiative} done toward an initiative`);
    if (doneOther > 0) parts.push(`${doneOther} other`);
  } else {
    parts.push(`${done} done`);
  }
  if (placed > 0) parts.push(`${placed} placed`);
  if (noTime > 0) parts.push(`${noTime} with no time`);
  const label = total === 0 ? "Nothing on this week yet" : `${done} of ${total} done: ${parts.join(", ")}`;
  return { doneInitiative, doneOther, placed, noTime, done, total, split: sig != null, elapsed, label };
}

/** The pieces in drawing order: done toward an initiative, done other, placed,
 *  no time. Without a split, every done piece is plain "done". */
export function weekTrackPieces(t: Pick<WeekTrack, "doneInitiative" | "doneOther" | "done" | "placed" | "noTime" | "split">): WeekPiece[] {
  const out: WeekPiece[] = [];
  if (t.split) {
    for (let i = 0; i < t.doneInitiative; i++) out.push("done-initiative");
    for (let i = 0; i < t.doneOther; i++) out.push("done-other");
  } else {
    for (let i = 0; i < t.done; i++) out.push("done");
  }
  for (let i = 0; i < t.placed; i++) out.push("placed");
  for (let i = 0; i < t.noTime; i++) out.push("no-time");
  return out;
}
