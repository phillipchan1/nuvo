// The desktop Year — the Schedule's furthest-out lens.
//
// Twelve month grids of day numerals. A tap opens the day; a month name opens
// the month. Today wears the signal ring. That is the whole surface (D-127,
// D-128). Load shading lived here and was cut: it competed with the dates and
// answered a question the chat's `read_calendar_load` already owns. The Year
// is how you stand back and pick a place to lean into — not a heatmap.

import { useMemo } from "react";
import { YearMonth } from "./calendar/YearParts";

export default function CalendarYear({
  year,
  now,
  weekStartsOn,
  onPickDay,
  onPickMonth,
}: {
  year: number;
  now: Date;
  weekStartsOn: 0 | 1;
  /** Drill all the way in — a square opens that day. */
  onPickDay: (d: Date) => void;
  /** Drill one step — a month name opens the month grid. */
  onPickMonth: (d: Date) => void;
}) {
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, m) => new Date(year, m, 1)),
    [year],
  );

  return (
    // Transparent — the one warm-paper gradient has to read continuously from
    // the spine through the rail to here. An opaque bg is the frost seam.
    //
    // `@container` and not a viewport breakpoint: this pane is not the window.
    // Opening the Nuvo chat takes ~380px out of it without the viewport moving
    // an inch, and a viewport-keyed `lg:grid-cols-3` answered for a 1280px
    // window while living in a 282px box — twelve months at 80px each, day
    // cells at 10.66px, and two-digit numerals running together into
    // "2223242526271234567891011". Sizing off the container is the whole fix:
    // fewer columns in a narrower pane means the months stay wide enough to
    // read, so the failure mode cannot recur at any pane width.
    <div className="@container min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-4 pb-8 pt-1">
        <div className="mb-3 border-b border-line pb-2">
          <span className="masthead text-lead leading-none text-ink">{year}</span>
        </div>

        {/* Column count is chosen so the narrowest month a breakpoint can
            produce still holds a two-digit numeral: the tightest case is 2
            columns at a 300px pane, which leaves ~124px per month and ~17px
            per cell against a 9.5px numeral. Every wider case is roomier. */}
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 @[300px]:grid-cols-2 @[660px]:grid-cols-3 @[980px]:grid-cols-4">
          {months.map((m, i) => (
            <YearMonth
              key={i}
              month={m}
              now={now}
              weekStartsOn={weekStartsOn}
              onPickDay={onPickDay}
              onPickMonth={onPickMonth}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
