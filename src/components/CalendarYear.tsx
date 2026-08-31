// The desktop Year — the Schedule's furthest-out lens.
//
// A year of boxes is a browsing surface, and Principle 10 says a new place has
// to be paid for. So this one is a grid of *load*, not a date browser: every
// square is shaded by how much of that day is already promised, which makes
// the whole year answer one question no other surface in Nuvo answers at day
// altitude: **where is this heavy, and where is there nothing.** The numeral
// on the square is the index of that answer, not a second one (D-127). On
// Deck answers the same question for projects across weeks. Nothing answered
// it for days, which is why "when could this actually go?" always meant paging
// the week grid eleven times.
//
// Like the other non-FullCalendar lens before it, it computes nothing of its
// own. The shading comes from `dayLoad` in `_shared/dayShape.ts` — the same
// kernel rule the phone's Year and the chat read — over the same
// `toBusyBlocks` busy list every other calendar surface uses. A second idea of
// "heavy" here is how the desk would start disagreeing with the phone about
// March.

import { useMemo } from "react";
import { addDays, startOfMonth, startOfYear } from "date-fns";
import { YearLegend, YearMonth, type DayLoad } from "./calendar/YearParts";
import { buildYearLoads, type DayCtx } from "./mobile/dayPlan";

/** One year's worth of days, grouped by month, each weighed once.
 *
 *  The weighing itself lives in `buildYearLoads`, which caches per `ctx` —
 *  outside React, deliberately. This component unmounts every time you switch
 *  to Week, so a `useMemo` here would die with it and every return trip would
 *  re-pay ~84ms of day math on the click. */
function useYearLoads(year: number, ctx: DayCtx) {
  return useMemo(() => {
    const months = Array.from({ length: 12 }, (_, m) => new Date(year, m, 1));
    const byMonth = buildYearLoads(year, ctx);
    return { months, byMonth, flat: byMonth.flat() };
  }, [year, ctx]);
}

export default function CalendarYear({
  year,
  ctx,
  now,
  weekStartsOn,
  loading = false,
  onPickDay,
  onPickMonth,
}: {
  year: number;
  ctx: DayCtx;
  now: Date;
  weekStartsOn: 0 | 1;
  loading?: boolean;
  /** Drill all the way in — a square opens that day. */
  onPickDay: (d: Date) => void;
  /** Drill one step — a month name opens the month grid. */
  onPickMonth: (d: Date) => void;
}) {
  const { months, byMonth, flat } = useYearLoads(year, ctx);

  // Has anything actually arrived? The only question this component still asks
  // in prose — see the header below for why the rest of it went.
  const anyLoad = useMemo(() => flat.some((l) => l.band !== "clear"), [flat]);
  const nothingYet = loading && !anyLoad;

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
        {/* Year and legend. Nothing else.
              This header used to carry a prose read — "119 of 365 days clear ·
              heaviest August · longest clear run ahead, 19 days from Dec 13".
              Cut 2026-08-15, because the grid already SAYS all of it: a run of
              blank squares is more legible than a sentence describing one, and
              a dark August is visible without being announced. The original
              argument for the sentence was that a *count* can't tell forty
              scattered Tuesdays from one free fortnight — true, and the reason
              it never earned its place is that the shading tells them apart on
              sight.
              The legend stays: a colour ramp with no key is a picture of a year
              rather than a reading of one. The per-day accessible names stay
              too — they carry the same facts in words for anyone who can't see
              a shade. And the chat still speaks the run aloud, which is the
              medium prose actually belongs in (`read_calendar_load`). */}
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="masthead text-lead leading-none text-ink">{year}</span>
            {/* The one line that is not decoration: an unread year and an empty
                year are the same picture, and only one of them is true. */}
            {nothingYet && <span className="text-caption text-muted">Reading your calendar…</span>}
          </div>
          <YearLegend />
        </div>

        {/* Column count is chosen so the narrowest month a breakpoint can
            produce still holds a two-digit numeral (D-127 — the numeral is
            the index, so a cell that clips "28" has failed): the tightest
            case is 2 columns at a 300px pane, which leaves ~124px per month
            and ~17px per cell against a 9.5px numeral. Every wider case is
            roomier. */}
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 @[300px]:grid-cols-2 @[660px]:grid-cols-3 @[980px]:grid-cols-4">
          {months.map((m, i) => (
            <YearMonth
              key={i}
              month={m}
              loads={byMonth[i]}
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

/** The span a year view needs fetched — Jan 1 through the day after Dec 31, so
 *  the last day's events are inside a half-open range. Exported so the pane's
 *  range effect and this component can't disagree about what a year is. */
export function yearSpan(year: number): { startISO: string; endISO: string } {
  const start = startOfYear(new Date(year, 0, 1));
  return {
    startISO: start.toISOString(),
    endISO: addDays(startOfMonth(new Date(year, 11, 1)), 31).toISOString(),
  };
}

export type { DayLoad };
