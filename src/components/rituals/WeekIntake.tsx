// The week's intake, drawn — two pieces that used to be one, because they were
// answering two different questions in one horizontal bar.
//
//   · `SourceSwitch` — WHERE you are. Three sources, one at a time, always
//     reachable. It lives in the planner rail, over the pool it switches.
//   · `CapacityMeter` — WHETHER IT FITS. It lives over the week grid, because
//     that's the thing it measures.
//
// Splitting them is the fix for a real misread: a capacity track mounted directly
// under four numbered steps reads as *step progress*, and its largest segment
// (time already on the calendar) reads as "unfilled" because it's neutral. So the
// one honest number in the flow looked like a broken progress bar. Now the steps
// are a switch (no track under them) and the meter sits where its subject is,
// labelled, with its own legend carrying the hours.
//
// One component set, both shells: the desktop rail and the phone's step rail are
// the same elements at two densities, so the act looks like one act
// (design-language: "planner surfaces share one grammar").

import { Fragment } from "react";
import { PLAN_STEPS, STEP_LABEL, type WeekIntakeRead, type WeekLane, type WeekPlanStep } from "../../lib/intake";
import { fmtHours as hrs } from "../../lib/dates";

/** The phone adds one more step — the day-by-day read of where it all landed. */
export type WeekStep = WeekPlanStep | "week";
export const WEEK_STEPS: WeekStep[] = [...PLAN_STEPS, "week"];

/**
 * The walk, drawn as a walk.
 *
 * This was a row of equal-weight boxes, and it read as **tabs** — parallel views
 * you pick between, not stations you pass through. That misread was the whole
 * problem with the screen: the thing that said where you are looked like a view
 * switcher, and the thing that moved you forward was in the opposite corner.
 *
 * A connected stepper says the true thing instead: there is an order, you are
 * *here*, there are N left. Every station is still one click away — a walk, not a
 * wizard — but jumping is now clearly the exception rather than the invitation.
 *
 * It carries **no counts.** It used to print the step's own tally underneath
 * ("step 2 of 4 · 16 · 8.9h") while the rail's foot printed the same hours again
 * and the step number a third time. Where you are is the stepper's whole job; the
 * measuring belongs to the meter, and most of it belongs under the hood.
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
    <div>
      <div className="flex items-start">
        {steps.map((s, i) => {
          const active = i === here;
          const done = i < here;
          const ink = active ? "var(--accent)" : done ? "var(--accent)" : "var(--muted)";
          return (
            <Fragment key={s}>
              {/* the rule between stations — this is what makes it a path */}
              {i > 0 && (
                <span
                  className="mt-[11px] h-px w-3 shrink-0"
                  style={{ background: done || active ? "var(--accent)" : "var(--line)" }}
                  aria-hidden
                />
              )}
              <button
                onClick={() => onStep(s)}
                aria-current={active ? "step" : undefined}
                title={`Step ${i + 1} of ${steps.length} — ${s === "week" ? "The week" : STEP_LABEL[s]}`}
                className={`tap fast flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 ${dense ? "min-h-[44px]" : ""}`}
              >
                <span
                  className="mono flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-meta"
                  style={{
                    background: active ? "var(--accent)" : "transparent",
                    border: active ? "none" : `1px solid ${done ? "var(--accent)" : "var(--line-strong)"}`,
                    color: active ? "#fff" : ink,
                  }}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={`w-full truncate text-center text-label ${active ? "font-medium" : ""}`}
                  style={{ color: active ? "var(--accent)" : "var(--muted)" }}
                >
                  {s === "week" ? "The week" : STEP_LABEL[s]}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export interface FitRead {
  /** Blocks the composer found a time for. */
  placed: number;
  /** Work you kept that the week had no room for — the number that matters. */
  unplaced: number;
}

/**
 * The week's one honest measure, drawn over the week itself: what you're asking
 * of the week, stacked by where it came from, against the pace you've actually
 * proven — and, in the same breath, how much of it the week could not hold.
 *
 * **One arithmetic.** The load is everything you agreed to carry (the Week is the
 * gate — Principle 2), not just the part that found a time slot; counting only the
 * placed minutes flattered the plan and disagreed with the commit bar's own
 * number, on the same screen. Answers W1 while you decide, not after.
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
  /** Sits under the grid as a reference rather than over it as a headline: the
   *  label and the numbers share one line, and the bar thins to a rule. */
  compact?: boolean;
  /**
   * Sources reached so far. Ones you haven't got to yet still occupy their real
   * width — ghosted, not hidden. The week reveals itself a source at a time, but
   * the *total* never lies: you can always see what's still coming, and the
   * hours read at the top stay honest from the first screen (Principle 6).
   */
  revealed?: WeekLane[];
}) {
  const { trackMins, budgetMins, overMins } = intake;
  const pct = (m: number) => `${Math.max(0, (m / trackMins) * 100)}%`;
  const segments: { key: WeekLane | "blocked"; mins: number; fill: string; label: string }[] = [
    {
      key: "blocked",
      mins: intake.blockedMins,
      // 20% ink read as *unfilled* against warm paper, which is how the biggest
      // segment of the week made the meter look like a broken progress bar.
      fill: "color-mix(in srgb, var(--ink) 34%, transparent)",
      label: "already set",
    },
    { key: "projects", mins: intake.projects.mins, fill: "var(--accent)", label: "projects" },
    {
      key: "loose",
      mins: intake.loose.mins,
      fill: "color-mix(in srgb, var(--accent) 52%, transparent)",
      label: "leftovers",
    },
    {
      key: "inbox",
      mins: intake.inbox.mins,
      fill: "color-mix(in srgb, var(--accent) 26%, transparent)",
      label: "inbox",
    },
  ];

  let offset = 0;
  const placed = segments.map((s) => {
    const left = offset;
    offset += s.mins;
    const ghost = !!revealed && s.key !== "blocked" && !revealed.includes(s.key);
    return { ...s, left, ghost };
  });
  const roomMins = Math.max(0, (budgetMins ?? trackMins) - intake.loadMins);

  return (
    <div>
      {/* Two numbers, one line, at a size you can actually read — the rest of
          this is meant to be SEEN, not read. The legend that used to spell out
          every segment in 9.5px ("already set 8.8h · projects 5.6h · leftovers
          6.9h · inbox 4.5h") was four facts nobody needs in words when the bar
          already shows their proportions; they survive as tooltips. */}
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="section-label">the week</span>
        <span
          className="shrink-0"
          title={
            budgetMins == null
              ? "No history yet — a usual week appears after a week or two."
              : `Your usual week: ~${hrs(budgetMins)}h. It's the average you've actually completed over the last four weeks — measured, never set. It's a read, not a limit: nothing is refused for exceeding it.`
          }
        >
          <span className="mono text-head text-ink">{hrs(intake.loadMins)}h</span>
          {/* The one calibration sentence, in words, because it's now the ONLY
              thing calibration does here — it used to also silently refuse work. */}
          {budgetMins == null ? (
            <span className="mono text-meta text-muted"> · no usual week yet</span>
          ) : overMins > 0 ? (
            <span className="mono text-meta" style={{ color: "var(--signal)" }}>
              {" · "}{hrs(overMins)}h past your usual {hrs(budgetMins)}h
            </span>
          ) : (
            <span className="mono text-meta text-muted"> · of your usual {hrs(budgetMins)}h</span>
          )}
          {/* the one count worth words — how much of it found no time. The desktop
              also spells this out below the grid; the phone has only this. */}
          {fit && fit.unplaced > 0 && (
            <span className="mono text-meta" style={{ color: "var(--signal)" }}>
              {" · "}{fit.unplaced} unplaced
            </span>
          )}
        </span>
      </div>

      <div
        className="relative w-full overflow-hidden rounded-full"
        style={{ height: dense ? 8 : compact ? 10 : 10, background: "var(--line)" }}
        role="img"
        aria-label={`${hrs(intake.loadMins)} hours of work against ${budgetMins != null ? `a ~${hrs(budgetMins)} hour proven pace` : "no proven pace yet"}`}
      >
        {/* the room left — open, unclaimed time reads as --slot, everywhere */}
        {roomMins > 0 && (
          <div
            className="absolute inset-y-0"
            style={{
              left: pct(intake.loadMins),
              width: pct(roomMins),
              background: "color-mix(in srgb, var(--slot) 16%, transparent)",
              transition: "left .32s var(--ease-out), width .32s var(--ease-out)",
            }}
          />
        )}
        {/* Animated, and that's the point: keeping or dropping a task slides the
            week's load in front of you. The consequence is *shown*, so no copy has
            to say "this is what it costs". Widths are always rendered (0% when a
            lane is empty) so the transition has something to move from. */}
        {placed.map((s) => (
          <div
            key={s.key}
            className="absolute inset-y-0"
            style={{
              left: pct(s.left),
              width: pct(s.mins),
              background: s.fill,
              opacity: s.ghost ? 0.26 : 1,
              transition: "left .32s var(--ease-out), width .32s var(--ease-out), opacity .32s var(--ease-out)",
            }}
            title={s.ghost ? `${s.label} · ${hrs(s.mins)}h — still to come` : `${s.label} · ${hrs(s.mins)}h`}
          />
        ))}
        {/* the pace mark — always drawn once there IS a pace, so the track has a
            reference and never reads as "progress toward full" */}
        {budgetMins != null && (
          <div
            className="absolute inset-y-0 w-px"
            style={{
              left: pct(budgetMins),
              background: overMins > 0 ? "var(--signal)" : "var(--line-strong)",
            }}
            title={`your proven pace — ${hrs(budgetMins)}h`}
          />
        )}
        {overMins > 0 && budgetMins != null && (
          <div
            className="absolute inset-y-0"
            style={{
              left: pct(budgetMins),
              width: pct(overMins),
              background: "color-mix(in srgb, var(--signal) 55%, transparent)",
            }}
            title={`${hrs(overMins)}h past your proven pace`}
          />
        )}
      </div>

    </div>
  );
}
