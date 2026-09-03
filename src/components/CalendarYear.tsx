// The desktop Year — the Schedule's furthest-out lens.
//
// Twelve month grids of day numerals that **fill the pane**. A tap opens the
// day; a month name opens the month. Today wears the signal ring. That is the
// whole surface (D-127, D-128, D-129). Load shading lived here and was cut: it
// competed with the dates and answered a question the chat's
// `read_calendar_load` already owns. The Year is how you stand back and pick a
// place to lean into — not a heatmap.
//
// The year numeral itself lives in the Schedule toolbar (same seat Month's
// title holds). Saying it again as an in-pane masthead is the date being
// spoken twice (D-123 / D-129). D-132 tried both seats and was reversed.

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
    //
    // The grid fills the pane (D-129). Row templates are explicit per column
    // count (`grid-rows-3` at four columns, `grid-rows-4` at three, …) so
    // `1fr` gets a definite block size — `grid-auto-rows: 1fr` alone was not
    // enough when the flex height chain was soft, and left a dead band under
    // December. `h-full` + `min-h-0` keeps the chain rigid; a short window
    // scrolls before numerals crush (`min-h` on the inner shell).
    <div className="@container h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex h-full min-h-[36rem] w-full max-w-[1400px] flex-col px-4 pb-3 pt-2 @[660px]:px-5 @[980px]:min-h-[40rem] @[980px]:px-6">
        {/* Column count is chosen so the narrowest month a breakpoint can
            produce still holds a two-digit numeral: the tightest case is 2
            columns at a 300px pane, which leaves ~124px per month and ~17px
            per cell against a 9.5px numeral. Every wider case is roomier.
            Row count tracks the column count so twelve months always tile
            the height: 1×12 · 2×6 · 3×4 · 4×3. */}
        {/* Gaps stay modest: Apple's year reads as twelve tight units. Row
            mins respect the dense six-week grid (`max-content`) so a short
            pane scrolls before it crushes numerals; extra height still
            distributes evenly across rows. */}
        <div className="grid h-full min-h-0 flex-1 grid-cols-1 gap-x-5 gap-y-4 [grid-template-rows:repeat(12,minmax(max-content,1fr))] @[300px]:grid-cols-2 @[300px]:[grid-template-rows:repeat(6,minmax(max-content,1fr))] @[660px]:grid-cols-3 @[660px]:gap-x-6 @[660px]:gap-y-5 @[660px]:[grid-template-rows:repeat(4,minmax(max-content,1fr))] @[980px]:grid-cols-4 @[980px]:gap-x-8 @[980px]:gap-y-6 @[980px]:[grid-template-rows:repeat(3,minmax(max-content,1fr))]">
          {months.map((m, i) => (
            <YearMonth
              key={i}
              month={m}
              now={now}
              weekStartsOn={weekStartsOn}
              onPickDay={onPickDay}
              onPickMonth={onPickMonth}
              fill
            />
          ))}
        </div>
      </div>
    </div>
  );
}
