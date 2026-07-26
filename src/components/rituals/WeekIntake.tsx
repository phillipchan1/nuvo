// The intake bar — the header both shells wear while planning a week.
//
// It does three jobs at once, which is why it replaced three separate things:
//
//   1 · **It names the steps in plain words.** Projects · Leftovers · Inbox →
//       The week. Not "Slate / Pull / Shape" — invented verbs that appeared
//       nowhere else in the product and told a first-time reader nothing.
//   2 · **It shows where you are** without gating anything. Every lane is always
//       reachable; a lane you've already been through keeps a check. The week is
//       pre-composed from the moment the flow opens — this is a map, not a wizard.
//   3 · **It draws the funnel.** One track = the week's proven pace. Three sources
//       pour into it, left to right, and the room left over reads as open time
//       (`--slot`). Overrun past the pace is `--signal`, the only red in the app.
//
// One component, both shells: the desktop rail and the phone's step rail are the
// same element at two densities, so the act looks like one act (design-language:
// "planner surfaces share one grammar").

import { LANES, LANE_LABEL, type WeekIntakeRead, type WeekLane } from "../../lib/intake";
import { fmtHours as hrs } from "../../lib/dates";

export type WeekStep = WeekLane | "week";
export const WEEK_STEPS: WeekStep[] = [...LANES, "week"];

/** The label under each lane — the honest count, or an honest silence. */
function laneRead(step: WeekStep, intake: WeekIntakeRead, waitingInbox: number, dense?: boolean): string {
  if (step === "week") {
    const load = hrs(intake.loadMins);
    // No history yet → say so rather than inventing a pace (Principle 6).
    if (intake.budgetMins == null) return dense ? `${load}h · no pace` : `${load}h · no pace yet`;
    if (intake.overMins > 0) {
      return dense ? `${load}h · +${hrs(intake.overMins)}h` : `${load}h · ${hrs(intake.overMins)}h over pace`;
    }
    // the phone can't hold "of ~12h" without clipping — same fact, fewer glyphs
    return dense ? `${load}/${hrs(intake.budgetMins)}h` : `${load}h of ~${hrs(intake.budgetMins)}h`;
  }
  const { count, mins } = intake[step];
  // An untouched inbox has taken nothing into the week yet — but it isn't "none",
  // and calling it that is how a full inbox stays invisible on planning day.
  if (count === 0 && step === "inbox") return waitingInbox > 0 ? `${waitingInbox} waiting` : "clear";
  if (count === 0) return "none";
  const suffix = step === "inbox" && waitingInbox > 0 ? ` · ${waitingInbox} left` : "";
  return `${count} · ${hrs(mins)}h${suffix}`;
}

export default function WeekIntakeBar({
  intake,
  step,
  onStep,
  visited,
  dense,
  waitingInbox = 0,
}: {
  intake: WeekIntakeRead;
  step: WeekStep;
  onStep: (s: WeekStep) => void;
  /** Steps already passed through — they carry a ✓ instead of their number. */
  visited?: Set<WeekStep>;
  /** Phone density: bigger tap targets, tighter type. */
  dense?: boolean;
  /** Captures still sitting unsorted in the inbox. */
  waitingInbox?: number;
}) {
  return (
    <div className={dense ? "mt-2.5" : ""}>
      <div className="flex items-stretch gap-0.5">
        {WEEK_STEPS.map((s, i) => (
          <Lane
            key={s}
            n={i + 1}
            label={s === "week" ? "The week" : LANE_LABEL[s]}
            read={laneRead(s, intake, waitingInbox, dense)}
            active={step === s}
            done={!!visited?.has(s) && step !== s}
            terminal={s === "week"}
            dense={dense}
            onPick={() => onStep(s)}
          />
        ))}
      </div>
      <CapacityTrack intake={intake} dense={dense} />
    </div>
  );
}

function Lane({
  n,
  label,
  read,
  active,
  done,
  terminal,
  dense,
  onPick,
}: {
  n: number;
  label: string;
  read: string;
  active: boolean;
  done: boolean;
  terminal: boolean;
  dense?: boolean;
  onPick: () => void;
}) {
  return (
    <>
      {/* the pour — the three sources feed the one week */}
      {terminal && (
        <span className="mono flex shrink-0 items-center px-1 text-meta" style={{ color: "var(--line-strong)" }} aria-hidden>
          →
        </span>
      )}
      {/* No numbered chip: a filled circle is a frame, and four of them ate the
          room the labels needed at 375px. The digit alone carries the order —
          dissolve, don't frame. */}
      <button
        onClick={onPick}
        aria-current={active ? "step" : undefined}
        className={`tap fast min-w-0 rounded-md px-1.5 text-left ${
          dense ? "min-h-[44px] flex-1 py-1.5" : "w-[150px] shrink-0 py-1"
        }`}
        style={{ background: active ? "var(--accent-soft)" : "transparent" }}
      >
        <span className="flex items-baseline gap-1">
          <span
            className="mono shrink-0 text-micro"
            style={{ color: active || done ? "var(--accent)" : "var(--muted)" }}
            aria-hidden
          >
            {done ? "✓" : n}
          </span>
          <span
            className={`min-w-0 flex-1 truncate text-label ${active ? "font-medium" : ""}`}
            style={{ color: active ? "var(--accent)" : "var(--ink)" }}
          >
            {label}
          </span>
        </span>
        <span className="mono ml-[13px] block truncate text-micro text-muted">{read}</span>
      </button>
    </>
  );
}

/**
 * The week's one honest measure, drawn: the immovable calendar, then each source
 * stacked on top of it, against the pace you've actually proven. Answers W1 ("can
 * I carry this week?") live, while you're still deciding — instead of only at the
 * commit bar, after the decisions are made.
 */
function CapacityTrack({ intake, dense }: { intake: WeekIntakeRead; dense?: boolean }) {
  const { trackMins, budgetMins, overMins } = intake;
  const pct = (m: number) => `${Math.max(0, (m / trackMins) * 100)}%`;
  const segments: { key: string; mins: number; fill: string; label: string }[] = [
    {
      key: "blocked",
      mins: intake.blockedMins,
      fill: "color-mix(in srgb, var(--ink) 20%, transparent)",
      label: "already on the calendar",
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
    <div className={dense ? "mt-2" : "mt-1.5"}>
      <div
        className="relative w-full overflow-hidden rounded-full"
        style={{ height: dense ? 6 : 5, background: "var(--line)" }}
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
            }}
          />
        )}
        {placed.map((s) =>
          s.mins <= 0 ? null : (
            <div
              key={s.key}
              className="absolute inset-y-0"
              style={{ left: pct(s.left), width: pct(s.mins), background: s.fill }}
              title={`${s.label} · ${hrs(s.mins)}h`}
            />
          ),
        )}
        {/* the pace line — where your proven week ends. Only drawn once you're past it. */}
        {budgetMins != null && overMins > 0 && (
          <div
            className="absolute inset-y-0 w-px"
            style={{ left: pct(budgetMins), background: "var(--signal)" }}
            title={`your proven pace — ${hrs(budgetMins)}h`}
          />
        )}
        {budgetMins != null && overMins > 0 && (
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
