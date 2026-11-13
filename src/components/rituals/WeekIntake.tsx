// The week's intake, drawn — two pieces that used to be one, because they were
// answering two different questions in one horizontal bar.
//
//   · `SourceSwitch` — WHERE you are. The plan's stations, drawn as the Flow
//     layout's stepper (D-190): numbered circles joined by hairlines, done in
//     --ok with a ✓, the current one in ink. Every station is one click away.
//   · `CapacityMeter` — WHETHER IT FITS. It lives over the week grid, because
//     that's the thing it measures.
//
// Splitting them is the fix for a real misread: a capacity track mounted directly
// under four numbered steps reads as *step progress*, and its largest segment
// (time already on the calendar) reads as "unfilled" because it's neutral. So the
// steps are a switch (no track under them) and the meter sits where its subject
// is, with the hours as its one line.
//
// One component set, both shells: the desktop walk and the phone's step rail are
// the same elements at two densities, so the act looks like one act.

import { PLAN_STEPS, STEP_LABEL, type WeekIntakeRead, type WeekLane, type WeekPlanStep } from "../../lib/intake";
import { fmtHours as hrs } from "../../lib/dates";
import { FlowMeter, FlowStepper, type MeterSegment } from "./FlowShell";

/** The phone adds one more step — the day-by-day read of where it all landed. */
export type WeekStep = WeekPlanStep | "week";
export const WEEK_STEPS: WeekStep[] = [...PLAN_STEPS, "week"];

const labelOf = (s: WeekStep) => (s === "week" ? "The week" : STEP_LABEL[s]);

/**
 * The walk, drawn as a walk — a connected stepper says the true thing: there is
 * an order, you are *here*, there are N left. Every station is still one click
 * away — a walk, not a wizard. It carries **no counts**: where you are is the
 * stepper's whole job; the measuring belongs to the meter.
 */
export default function SourceSwitch({
  step,
  onStep,
  steps = PLAN_STEPS,
  dense,
}: {
  step: WeekStep;
  onStep: (s: WeekStep) => void;
  steps?: WeekStep[];
  dense?: boolean;
}) {
  const here = steps.indexOf(step);
  return (
    <FlowStepper
      label="Plan the week"
      dense={dense}
      current={here}
      onStep={(i) => onStep(steps[i])}
      steps={steps.map((s, i) => ({ id: s, label: labelOf(s), title: `Step ${i + 1} of ${steps.length} — ${labelOf(s)}` }))}
    />
  );
}

export interface FitRead {
  /** Blocks the composer found a time for. */
  placed: number;
  /** Work you kept that the week had no room for — the number that matters. */
  unplaced: number;
}

/** What the week carries, by where it came from. The calendar you arrived with is
 *  neutral ink; your own work is the accent, lighter the looser its source. */
const LANES: { key: WeekLane | "blocked"; fill: string; label: string }[] = [
  { key: "blocked", fill: "color-mix(in srgb, var(--ink) 30%, var(--sunk))", label: "already set" },
  { key: "projects", fill: "var(--accent)", label: "projects" },
  { key: "loose", fill: "color-mix(in srgb, var(--accent) 55%, var(--sunk))", label: "leftovers" },
  { key: "inbox", fill: "color-mix(in srgb, var(--accent) 28%, var(--sunk))", label: "inbox" },
];

/**
 * The week's one honest measure, drawn over the week itself: what you're asking
 * of the week, stacked by where it came from, against the pace you've actually
 * proven — and, in the same breath, how much of it the week could not hold.
 *
 * **One arithmetic.** The load is everything you agreed to carry (the Week is the
 * gate — Principle 2), not just the part that found a time slot; counting only the
 * placed minutes flattered the plan and disagreed with the commit bar's own
 * number, on the same screen. Answers W1 while you decide, not after.
 *
 * Past the proven pace reads in --warn, never --signal: the ember means *now*
 * and nothing else (D-187), and "over" is a read, not an alarm.
 */
export function CapacityMeter({
  intake,
  fit,
  dense,
  revealed,
  compact,
}: {
  intake: WeekIntakeRead;
  fit?: FitRead;
  dense?: boolean;
  /** Sits under the grid as a reference rather than over it as a headline. */
  compact?: boolean;
  /**
   * Sources reached so far. Ones you haven't got to yet still occupy their real
   * width — ghosted, not hidden. The week reveals itself a source at a time, but
   * the *total* never lies (Principle 6).
   */
  revealed?: WeekLane[];
}) {
  const { trackMins, budgetMins, overMins } = intake;
  const minsOf = (k: WeekLane | "blocked") => (k === "blocked" ? intake.blockedMins : intake[k].mins);
  const segments: MeterSegment[] = LANES.map((l) => {
    const ghost = !!revealed && l.key !== "blocked" && !revealed.includes(l.key);
    const mins = minsOf(l.key);
    return {
      key: l.key,
      value: mins,
      color: l.fill,
      ghost,
      title: ghost ? `${l.label} · ${hrs(mins)}h — still to come` : `${l.label} · ${hrs(mins)}h`,
    };
  });
  const roomMins = Math.max(0, (budgetMins ?? trackMins) - intake.loadMins);
  if (roomMins > 0) {
    segments.push({
      key: "room",
      value: roomMins,
      color: "color-mix(in srgb, var(--slot) 18%, var(--sunk))",
      title: `${hrs(roomMins)}h of room left`,
    });
  }
  const over = budgetMins != null && overMins > 0;

  return (
    <div className="grid gap-1.5" data-compact={compact || undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="f-kicker">The week</span>
        <span
          className="f-fact shrink-0"
          title={
            budgetMins == null
              ? "No history yet — a usual week appears after a week or two."
              : `Your usual week: ~${hrs(budgetMins)}h. It's the average you've actually completed over the last four weeks — measured, never set. It's a read, not a limit: nothing is refused for exceeding it.`
          }
        >
          <b>{hrs(intake.loadMins)}h</b>
          {/* No history yet is silence, not a clause — the tooltip says why. */}
          {budgetMins == null ? null : over ? (
            <span data-tone="warn">
              {" · "}
              {hrs(overMins)}h past your usual {hrs(budgetMins)}h
            </span>
          ) : (
            <span> of your usual {hrs(budgetMins)}h</span>
          )}
          {/* the one count worth words — how much of it found no time */}
          {fit && fit.unplaced > 0 && (
            <span data-tone="warn">
              {" · "}
              {fit.unplaced} unplaced
            </span>
          )}
        </span>
      </div>
      <FlowMeter
        size={dense ? "sm" : undefined}
        total={trackMins}
        segments={segments}
        ticks={
          budgetMins != null
            ? [{ key: "pace", at: budgetMins, tone: over ? "warn" : undefined, title: `your proven pace — ${hrs(budgetMins)}h` }]
            : []
        }
        label={`${hrs(intake.loadMins)} hours of work against ${budgetMins != null ? `a ~${hrs(budgetMins)} hour proven pace` : "no proven pace yet"}`}
      />
    </div>
  );
}
