import { toast } from "sonner";
import { tasksOf, type Project, type VerticalData } from "./vertical";

// Friction, not refusal — what happens when a project with no steps takes a week.
//
// The funnel is the product's whole claim: work earns the floor below it by being
// groomed. A project with no tasks can't be sized, so the week can't tell you
// whether it fits, and it quietly becomes a name on a board instead of hours in
// your calendar.
//
// We say that, and then we let it through.
//
// **Why not simply refuse.** Principle 4 — the app reports, you decide — and
// `readiness-model.md` §1 says it outright: it never commands, never shames,
// never auto-acts. A hard gate is also the version that only works on clean data
// (Principle 7): an account mid-import, or someone who genuinely holds a project
// in their head, would be blocked from recording something true. So the incentive
// goes to the user, with the cost named: this is what it will cost you if you
// skip it, and here's the one tap that fixes it.
//
// The kernel stays ungated on purpose. `bringIntoWeekPatch` is the shared *act*
// (browser and agent both apply it), so putting a refusal in there would make the
// two runtimes disagree about what a week can hold. This is a UI-layer nudge over
// an unchanged act.

/** A project is unready for a week when it has no open steps to size. */
export function hasNoSteps(d: VerticalData, p: Project): boolean {
  return tasksOf(d, p.id).filter((t) => t.status !== "done").length === 0;
}

/**
 * Call right after a project is placed on a week. No-ops when the project has
 * steps, so callers can fire it unconditionally.
 */
export function noticeIfUnready(
  d: VerticalData,
  p: Project,
  onAddSteps: () => void,
): void {
  if (!hasNoSteps(d, p)) return;
  toast(`${p.name} has no steps yet`, {
    description:
      "The week can only size work it can see — without steps this won't get real time on your calendar.",
    action: { label: "Add steps", onClick: onAddSteps },
  });
}
