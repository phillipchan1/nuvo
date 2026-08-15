// The desktop Year — the Schedule's furthest-out lens.
//
// A year of boxes is a browsing surface, and Principle 10 says a new place has
// to be paid for. So this one is not a grid of dates you can click; it is a
// grid of *load*. Every square is shaded by how much of that day is already
// promised, which makes the whole year answer one question no other surface in
// Nuvo answers at day altitude: **where is this heavy, and where is there
// nothing.** On Deck answers it for projects across weeks. Nothing answered it
// for days, which is why "when could this actually go?" always meant paging the
// week grid eleven times.
//
// Like the other non-FullCalendar lens before it, it computes nothing of its
// own. The shading comes from `dayLoad` in `_shared/dayShape.ts` — the same
// kernel rule the phone's Year and the chat read — over the same
// `toBusyBlocks` busy list every other calendar surface uses. A second idea of
// "heavy" here is how the desk would start disagreeing with the phone about
// March.

import { useMemo } from "react";
import { addDays, format, startOfDay, startOfMonth, startOfYear } from "date-fns";
import {
  YearLegend,
  YearMonth,
  loadLabel,
  monthDays,
  spanLoad,
  type DayLoad,
} from "./calendar/YearParts";
import { buildDayLoad, type DayCtx } from "./mobile/dayPlan";
import { longestClearRun } from "../../supabase/functions/_shared/dayShape.ts";

/** One year's worth of days, grouped by month, each weighed once. */
function useYearLoads(year: number, ctx: DayCtx) {
  return useMemo(() => {
    const months = Array.from({ length: 12 }, (_, m) => new Date(year, m, 1));
    const byMonth = months.map((m) => monthDays(m).map((d) => buildDayLoad(d, ctx)));
    const flatDays = months.flatMap((m) => monthDays(m));
    const flat = byMonth.flat();
    return { months, byMonth, flat, flatDays };
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
  const { months, byMonth, flat, flatDays } = useYearLoads(year, ctx);

  // The headline. Two halves, and the second one is the reason this view is
  // worth a place: a count of clear days tells you nothing about whether a
  // week of work fits anywhere, because forty scattered Tuesdays and one real
  // fortnight score the same. The run does.
  const read = useMemo(() => {
    const heaviest = months
      .map((m, i) => ({ month: m, span: spanLoad(byMonth[i]) }))
      .filter((x) => x.span.band !== "clear")
      .sort((a, b) => b.span.ratio - a.span.ratio)[0];

    // Room is a forward-looking question. A ten-day clear run last February is
    // a true fact about the shading and a useless answer to "where could this
    // go", so the run is measured from today — and says so.
    const fromIdx = flatDays.findIndex((d) => startOfDay(d).getTime() >= startOfDay(now).getTime());
    const ahead = fromIdx >= 0 ? flat.slice(fromIdx) : [];
    const aheadDays = fromIdx >= 0 ? flatDays.slice(fromIdx) : [];
    const run = longestClearRun(ahead);
    const total = spanLoad(flat);

    return {
      heaviest,
      total,
      run: run.length > 0 ? { length: run.length, start: aheadDays[run.startIndex] } : null,
      hasFuture: ahead.length > 0,
    };
  }, [months, byMonth, flat, flatDays, now]);

  const nothingYet = loading && read.total.claimedMins === 0 && read.total.clearDays === flat.length;

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
        {/* The year's own read — the sentence the grid is a picture of. */}
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="masthead text-lead leading-none text-ink">{year}</span>
            {nothingYet ? (
              <span className="text-caption text-muted">Reading your calendar…</span>
            ) : (
              <>
                <span className="mono text-label text-muted">
                  {read.total.clearDays} of {read.total.days} days clear
                </span>
                {read.heaviest && (
                  <span className="mono text-label text-muted">
                    heaviest {format(read.heaviest.month, "MMMM")} ({loadLabel(read.heaviest.span.band)})
                  </span>
                )}
                {read.hasFuture && (
                  <span
                    className="mono text-label"
                    style={{ color: read.run ? "var(--accent)" : "var(--muted)" }}
                  >
                    {read.run
                      ? `longest clear run ahead — ${read.run.length} day${read.run.length === 1 ? "" : "s"} from ${format(read.run.start, "MMM d")}`
                      : "no clear day left this year"}
                  </span>
                )}
              </>
            )}
          </div>
          <YearLegend />
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
