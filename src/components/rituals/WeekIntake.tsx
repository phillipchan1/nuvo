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

import { LANES, LANE_LABEL, type WeekIntakeRead, type WeekLane } from "../../lib/intake";
import { fmtHours as hrs } from "../../lib/dates";

export type WeekStep = WeekLane | "week";
export const WEEK_STEPS: WeekStep[] = [...LANES, "week"];

/** The count under each source — the honest read, or an honest silence. */
function laneRead(step: WeekStep, intake: WeekIntakeRead, waitingInbox: number): string {
  if (step === "week") return `${hrs(intake.loadMins)}h`;
  const { count, mins } = intake[step];
  // An untouched inbox has taken nothing into the week yet — but it isn't "none",
  // and calling it that is how a full inbox stays invisible on planning day.
  if (count === 0 && step === "inbox") return waitingInbox > 0 ? `${waitingInbox} waiting` : "clear";
  if (count === 0) return "none";
  const suffix = step === "inbox" && waitingInbox > 0 ? ` · ${waitingInbox} left` : "";
  return `${count} · ${hrs(mins)}h${suffix}`;
}

/**
 * The three sources, as a switch. **Not a wizard** — every source is one click
 * away at any time, and the week is fully composed from the moment the flow
 * opens. The number is the order you'd naturally take them in (what you committed
 * to, then what you already owed, then what's new), never a gate.
 */
export default function SourceSwitch({
  intake,
  step,
  onStep,
  steps = LANES,
  dense,
  waitingInbox = 0,
}: {
  intake: WeekIntakeRead;
  step: WeekStep;
  onStep: (s: WeekStep) => void;
  /** Which steps to show. The phone appends its own "The week" step. */
  steps?: WeekStep[];
  /** Phone density: bigger tap targets, tighter type. */
  dense?: boolean;
  /** Captures still sitting unsorted in the inbox. */
  waitingInbox?: number;
}) {
  return (
    <div className="flex items-stretch gap-0.5" role="tablist">
      {steps.map((s, i) => {
        const active = step === s;
        return (
          <button
            key={s}
            role="tab"
            aria-selected={active}
            onClick={() => onStep(s)}
            className={`tap fast min-w-0 flex-1 rounded-md px-1.5 text-left ${dense ? "min-h-[44px] py-1.5" : "py-1"}`}
            style={{ background: active ? "var(--accent-soft)" : "transparent" }}
          >
            <span className="flex items-baseline gap-1">
              {/* No numbered chip: a filled circle is a frame, and four of them ate
                  the room the labels needed at 375px. Dissolve, don't frame. */}
              <span
                className="mono shrink-0 text-micro"
                style={{ color: active ? "var(--accent)" : "var(--muted)" }}
                aria-hidden
              >
                {i + 1}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-label ${active ? "font-medium" : ""}`}
                style={{ color: active ? "var(--accent)" : "var(--ink)" }}
              >
                {s === "week" ? "The week" : LANE_LABEL[s]}
              </span>
            </span>
            <span className="mono ml-[13px] block truncate text-micro text-muted">
              {laneRead(s, intake, waitingInbox)}
            </span>
          </button>
        );
      })}
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
}: {
  intake: WeekIntakeRead;
  fit?: FitRead;
  dense?: boolean;
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
    return { ...s, left };
  });
  const roomMins = Math.max(0, (budgetMins ?? trackMins) - intake.loadMins);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="section-label">This week asks</span>
        <span className="mono shrink-0 text-meta">
          <span className="text-ink">{hrs(intake.loadMins)}h</span>
          <span className="text-muted">
            {budgetMins == null
              ? " · no proven pace yet"
              : overMins > 0
                ? ` · ${hrs(overMins)}h past your ~${hrs(budgetMins)}h pace`
                : ` of your ~${hrs(budgetMins)}h pace`}
          </span>
        </span>
      </div>

      <div
        className="relative w-full overflow-hidden rounded-full"
        style={{ height: dense ? 6 : 7, background: "var(--line)" }}
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
              transition: "left .32s var(--ease-out), width .32s var(--ease-out)",
            }}
            title={`${s.label} · ${hrs(s.mins)}h`}
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

      {/* The legend carries the hours, so it's data rather than a restated key —
          and it's the only place the three sources are weighed against each other. */}
      <div className="mono mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted">
        {placed
          .filter((s) => s.mins > 0)
          .map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: s.fill }} aria-hidden />
              {s.label} {hrs(s.mins)}h
            </span>
          ))}
        {roomMins > 0 && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: "color-mix(in srgb, var(--slot) 40%, transparent)" }}
              aria-hidden
            />
            {hrs(roomMins)}h room
          </span>
        )}
        {/* The line that used to arrive only at the end, after every decision was
            made: how much of what you kept the week actually had room for. On a
            phone it takes its own line — four legend chips plus this one clipped
            at 375px, and this is the half you can least afford to lose. */}
        {fit && (fit.placed > 0 || fit.unplaced > 0) && (
          <span className={dense ? "w-full" : "ml-auto shrink-0"}>
            {fit.placed} scheduled
            {fit.unplaced > 0 && (
              <span style={{ color: "var(--signal)" }}> · {fit.unplaced} couldn't fit</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
