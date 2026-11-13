// Significant — the fourth reading (D-203, docs/outcome-readings.md).
//
// "6.5h of 9h toward an initiative": of the week's finished hours, how many
// went to work whose project belongs to an initiative. One line and one
// two-segment bar, drawn ONCE for both crowns (the rail's and the phone's open
// one). It computes nothing — the split is `useWeekCrown().significance`, which
// is the planning kernel's `weekSignificance`.
//
// Hours, never a percentage: a percentage reads as a grade, hours read as where
// the time went (P4). The other segment is quiet structure (`--line-strong`),
// never `--warn` — other hours are not a fault. No target line, no history.
// Below two finished hours it says nothing (§6.1): a week that has barely
// touched the calendar would read as a verdict on what the calendar never saw.
//
// Motion: the initiative share ADVANCES when it grows (a task you ticked moved
// it); a shrink snaps. Nothing plays on mount.

import { useLayoutEffect, useRef } from "react";
import { advanceFill } from "../../lib/motion";
import { SIGNIFICANCE_FLOOR_MINS } from "../../hooks/useWeekCrown";
import type { WeekSignificance } from "../../../supabase/functions/_shared/planningRules.ts";

/** "6.5h" · "9h" — one decimal, never a trailing ".0". */
function hours(mins: number): string {
  const h = Math.round(mins / 6) / 10;
  return `${Number.isInteger(h) ? h.toFixed(0) : h.toFixed(1)}h`;
}

export function SignificanceLine({ value, className = "" }: { value: WeekSignificance | null; className?: string }) {
  const fill = useRef<HTMLSpanElement | null>(null);
  const total = value ? value.initiativeMins + value.otherMins : 0;
  const frac = total > 0 && value ? value.initiativeMins / total : 0;
  const prev = useRef<number | null>(null);

  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = frac;
    if (was === null || !(frac > was)) return;
    advanceFill(fill.current, was, frac);
  }, [frac]);

  if (!value || total < SIGNIFICANCE_FLOOR_MINS) return null;
  const sentence = `${hours(value.initiativeMins)} of ${hours(total)} toward an initiative`;
  return (
    <div className={`significance ${className}`} aria-label={`This week, ${sentence}`}>
      <span className="significance-text">
        <b>{hours(value.initiativeMins)}</b> of {hours(total)} toward an initiative
      </span>
      <span className="significance-bar" aria-hidden>
        <span
          ref={fill}
          className="significance-fill"
          style={{ width: `${frac * 100}%` }}
        />
      </span>
    </div>
  );
}
