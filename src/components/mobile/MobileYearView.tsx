// The Year lens — the phone's furthest-out view of the calendar.
//
// The desktop half (`CalendarYear.tsx`) explains what this view is *for*: not a
// year of dates you can browse, a year of **load**, so the question "where is
// this heavy, and where is there nothing" has an answer at day altitude. This
// is the same answer in a hand.
//
// Two layouts, one set of marks (`calendar/YearParts.tsx`) over one rule
// (`dayLoad`, in the shared kernel). The one real difference is the tap target,
// and it is a difference in the medium, not the model: a 375px screen puts a
// day cell at ~22px, which is half a thumb, so **the month is the target** and
// drilling in goes Year → month grid → the lens you were last using. Numerals
// come off for the same reason — at that size a numeral is a smudge sitting on
// top of the one thing the cell exists to show.

import { useMemo } from "react";
import { addMonths, format, startOfMonth } from "date-fns";
import { Icon } from "../Icon";
import TimeZoneChip from "../TimeZoneChip";
import { YearLegend, YearMonth, loadLabel, monthDays, spanLoad } from "../calendar/YearParts";
import { buildDayLoad, type DayCtx } from "./dayPlan";
import { longestClearRun } from "../../../supabase/functions/_shared/dayShape.ts";
import { startSwipe, trackSwipe, endSwipe, type SwipeTracker } from "./swipe";
import { useRef } from "react";
import { scrollParent } from "./dayPlan";

export default function MobileYearView({
  year,
  ctx,
  now,
  weekStartsOn,
  loading = false,
  onPickMonth,
  onPrev,
  onNext,
  onToday,
  onBack,
}: {
  year: number;
  ctx: DayCtx;
  now: Date;
  weekStartsOn: 0 | 1;
  loading?: boolean;
  /** Drill in — a month opens the month grid on it. */
  onPickMonth: (d: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Back to the month grid — the phone's home lens. */
  onBack: () => void;
}) {
  const { months, byMonth, flat, flatDays } = useMemo(() => {
    const ms = Array.from({ length: 12 }, (_, m) => new Date(year, m, 1));
    const byM = ms.map((m) => monthDays(m).map((d) => buildDayLoad(d, ctx)));
    return { months: ms, byMonth: byM, flat: byM.flat(), flatDays: ms.flatMap((m) => monthDays(m)) };
  }, [year, ctx]);

  // Same read as the desk, same reasons — see CalendarYear. Room is measured
  // forward from today, because a clear fortnight last February is a true fact
  // about the shading and a useless answer to "where could this go".
  const read = useMemo(() => {
    const total = spanLoad(flat);
    const heaviest = months
      .map((m, i) => ({ month: m, span: spanLoad(byMonth[i]) }))
      .filter((x) => x.span.band !== "clear")
      .sort((a, b) => b.span.ratio - a.span.ratio)[0];
    const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const from = flatDays.findIndex((d) => d.getTime() >= todayMs);
    const ahead = from >= 0 ? flat.slice(from) : [];
    const run = longestClearRun(ahead);
    return {
      total,
      heaviest,
      hasFuture: ahead.length > 0,
      run: run.length > 0 ? { length: run.length, start: flatDays[from + run.startIndex] } : null,
    };
  }, [flat, flatDays, months, byMonth, now]);

  const isCurrentYear = year === now.getFullYear();
  const nothingYet = loading && read.total.clearDays === flat.length;

  // Horizontal swipe pages a year — the same gesture (and the same classifier)
  // the month grid uses to page a month, so traversal means one thing on this
  // calendar however far out you're standing.
  const gridRef = useRef<HTMLDivElement>(null);
  const touch = useRef<SwipeTracker | null>(null);

  return (
    <div>
      {/* Back header — the phone's drill-out door, ≥44px, safe-area aware. */}
      <div className="mobile-topbar sticky top-0 z-20 flex items-center gap-1 px-2 pt-1">
        <button
          onClick={onBack}
          className="tap fast flex h-11 items-center gap-1 rounded-full pl-2 pr-3 text-label font-medium text-muted active:bg-surface-2"
          aria-label="Back to the month"
        >
          <Icon name="chevron-left" size={16} />
          Month
        </button>
        <div className="flex-1" />
        <TimeZoneChip now={now} />
        {!isCurrentYear && (
          <button
            onClick={onToday}
            className="tap fast rounded-full border border-line px-3 py-1 text-label font-medium text-muted active:bg-surface-2"
          >
            Today
          </button>
        )}
        <button
          onClick={onPrev}
          aria-label="Previous year"
          className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-head text-muted active:bg-surface-2"
        >
          ‹
        </button>
        <button
          onClick={onNext}
          aria-label="Next year"
          className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-head text-muted active:bg-surface-2"
        >
          ›
        </button>
      </div>

      {/* The year's own read — the sentence the grid is a picture of. */}
      <div className="px-4 pb-2 pt-1">
        <h2 className="text-lead masthead text-ink">{year}</h2>
        {nothingYet ? (
          <p className="mt-0.5 text-caption text-muted">Reading your calendar…</p>
        ) : (
          <div className="mt-0.5 flex flex-col gap-0.5">
            <span className="mono text-label text-muted">
              {read.total.clearDays} of {read.total.days} days clear
              {read.heaviest ? ` · heaviest ${format(read.heaviest.month, "MMMM")} (${loadLabel(read.heaviest.span.band)})` : ""}
            </span>
            {read.hasFuture && (
              <span className="mono text-label" style={{ color: read.run ? "var(--accent)" : "var(--muted)" }}>
                {read.run
                  ? `longest clear run ahead — ${read.run.length} day${read.run.length === 1 ? "" : "s"} from ${format(read.run.start, "MMM d")}`
                  : "no clear day left this year"}
              </span>
            )}
          </div>
        )}
        <YearLegend className="mt-1.5" />
      </div>

      {/* The wall. Two columns at 375px (a ~22px cell still reads as a shade),
          three once there's room. Each month is one tap target — well past
          44px — because a day cell here never can be. */}
      <div
        ref={gridRef}
        className="grid touch-pan-y grid-cols-2 gap-x-3 gap-y-4 px-3 pb-6 min-[560px]:grid-cols-3"
        onTouchStart={(e) => {
          touch.current = startSwipe(e, scrollParent(gridRef.current));
        }}
        onTouchMove={() => trackSwipe(touch.current)}
        onTouchEnd={(e) => {
          const dir = endSwipe(touch.current, e);
          touch.current = null;
          if (dir === "left") onNext();
          else if (dir === "right") onPrev();
        }}
      >
        {months.map((m, i) => (
          <button
            key={i}
            onClick={() => onPickMonth(startOfMonth(m))}
            aria-label={`${format(m, "MMMM yyyy")} — ${loadLabel(spanLoad(byMonth[i]).band)}, ${spanLoad(byMonth[i]).clearDays} days clear`}
            className="fast min-w-0 rounded-lg p-1 text-left active:bg-surface-2"
          >
            <YearMonth
              month={m}
              loads={byMonth[i]}
              now={now}
              weekStartsOn={weekStartsOn}
              showNumbers={false}
              showWeekdays={false}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The span the Year lens needs fetched. Kept beside the view so the fetch
 *  window and the render can't disagree about what a year is. */
export function mobileYearRange(year: number): { start: string; end: string } {
  return {
    start: new Date(year, 0, 1).toISOString(),
    end: addMonths(new Date(year, 0, 1), 12).toISOString(),
  };
}
