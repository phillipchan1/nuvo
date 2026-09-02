// The Year lens — the phone's furthest-out view of the calendar.
//
// The desktop half (`CalendarYear.tsx`) explains what this view is *for*:
// twelve month grids of day numerals, today marked, a tap to open a month
// (D-127, D-128, D-129). Load shading lived here and was cut — same marks as
// the desk, same reason. This is the same map in a hand.
//
// Two medium differences, not model differences: (1) a 375px screen puts a
// day cell at ~22px, which is half a thumb, so **the month is the target** and
// drilling in goes Year → month grid → the lens you were last using; (2) the
// body scrolls, so months stay content-sized — the desktop's fill-the-pane
// stretch (D-129) would fight a thumb swipe.

import { useMemo } from "react";
import { format, startOfMonth } from "date-fns";
import { YearMark, YearMonth } from "../calendar/YearParts";
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
      {/* The year numeral rides THIS page (D-132) so a swipe carries the
          span with the months — January 2026 and January 2027 are not
          self-identifying. The chrome hero still names it too (the top bar
          is the title); the back door is the horizon ladder. No legend:
          density is gone (D-128). */}
      <TimePager pageKey={String(year)} onPrev={onPrev} onNext={onNext}>
        {/* `@container`, not a viewport breakpoint: the ?year harness mounts
            this at 375px inside a wide window, and a viewport-keyed
            `min-[560px]:grid-cols-3` answered for the browser while the phone
            frame was still two thumbs wide. */}
        <div className="@container">
          <div className="px-3 pb-6 pt-2">
            <YearMark year={year} />
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4 @[560px]:grid-cols-3">
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
          </div>
        </div>
      </TimePager>
    </div>
  );
}
