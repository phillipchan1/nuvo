// The Year lens — the phone's furthest-out view of the calendar.
//
// The desktop half (`CalendarYear.tsx`) explains what this view is *for*:
// twelve month grids of day numerals, today marked, a tap to open a month
// (D-127, D-128). Load shading lived here and was cut — same marks as the
// desk, same reason. This is the same map in a hand.
//
// The one real difference is the tap target, and it is a difference in the
// medium, not the model: a 375px screen puts a day cell at ~22px, which is
// half a thumb, so **the month is the target** and drilling in goes
// Year → month grid → the lens you were last using.

import { useMemo } from "react";
import { format, startOfMonth } from "date-fns";
import { YearMonth } from "../calendar/YearParts";
import TimePager from "./TimePager";

export default function MobileYearView({
  year,
  now,
  weekStartsOn,
  onPickMonth,
  onPrev,
  onNext,
}: {
  year: number;
  now: Date;
  weekStartsOn: 0 | 1;
  /** Drill in — a month opens the month grid on it. */
  onPickMonth: (d: Date) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, m) => new Date(year, m, 1)),
    [year],
  );

  return (
    <div>
      {/* The year's own numeral is the chrome's hero now, and the back door is
          the horizon ladder — this body draws neither. No legend: density is
          gone (D-128). */}
      <TimePager pageKey={String(year)} onPrev={onPrev} onNext={onNext}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-3 pb-6 pt-2 min-[560px]:grid-cols-3">
          {months.map((m, i) => (
            <button
              key={i}
              onClick={() => onPickMonth(startOfMonth(m))}
              aria-label={format(m, "MMMM yyyy")}
              className="fast min-w-0 rounded-lg p-1 text-left active:bg-surface-2"
            >
              <YearMonth
                month={m}
                now={now}
                weekStartsOn={weekStartsOn}
              />
            </button>
          ))}
        </div>
      </TimePager>
    </div>
  );
}
