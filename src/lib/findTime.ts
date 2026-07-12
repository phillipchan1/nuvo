// Find time for ONE task — the Sunday composer, pointed at a single capture.
//
// The whole point: midweek work shouldn't need its own scheduling brain. The
// week composer already knows your calendar, your working hours, your day
// contexts, your energy windows and your proven pace — so "fit this one thing
// in" is just composeWeek() with a one-element pool. Same intelligence, same
// honesty (a real slot with a reason, or an honest "no room" and why), applied
// to the thing that just landed in your inbox on a Tuesday.
//
// This is a thin, pure wrapper. All the slotting math lives in compose.ts and
// is not duplicated here.

import { composeWeek, type ComposeInput, type Placement } from "./compose";
import type { Task } from "./types";

/** Everything composeWeek needs except the task pool and the clock — the live
 *  week boundaries, assembled once by the caller (see useFindTime). */
export type FindTimeContext = Omit<ComposeInput, "tasks" | "now">;

export type FindTimeResult =
  | { ok: true; placement: Placement }
  | { ok: false; reason: string };

/** Run the week composer over a single task and hand back its one placement,
 *  or an honest reason the week couldn't hold it. */
export function findTimeFor(
  task: Task,
  ctx: FindTimeContext,
  now: Date = new Date(),
): FindTimeResult {
  const res = composeWeek({ ...ctx, now, tasks: [task] });
  const placement = res.placements[0];
  if (placement) return { ok: true, placement };
  return { ok: false, reason: res.unplaced[0]?.reason ?? "no open time left this week" };
}
