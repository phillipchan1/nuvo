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
import { YearLegend, YearMonth, loadLabel, spanLoad } from "../calendar/YearParts";
import { buildYearLoads, type DayCtx } from "./dayPlan";
import TimePager from "./TimePager";

export default function MobileYearView({
  year,
  ctx,
  now,
  weekStartsOn,
  loading = false,
  onPickMonth,
  onPrev,
  onNext,
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
}) {
  // Cached per ctx outside React — see buildYearLoads. The phone pays this on a
  // slower CPU than the desk, so re-computing it on every zoom-out would be the
  // more visible stall of the two.
  const { months, byMonth, flat } = useMemo(() => {
    const ms = Array.from({ length: 12 }, (_, m) => new Date(year, m, 1));
    const byM = buildYearLoads(year, ctx);
    return { months: ms, byMonth: byM, flat: byM.flat() };
  }, [year, ctx]);

  // The only question still asked in prose — see the header block below.
  const anyLoad = useMemo(() => flat.some((l) => l.band !== "clear"), [flat]);
  const nothingYet = loading && !anyLoad;

  return (
    <div>
      {/* The legend, and nothing else. The year's own numeral is the chrome's
          hero now, and the back door is the horizon ladder — this body used to
          repeat both. The prose read was cut with the desk's: the grid says it,
          and screen space is scarcer here than anywhere. */}
      <div className="px-3 pb-2 pt-2">
        {nothingYet && <p className="pb-1 text-caption text-muted">Reading your calendar…</p>}
        <YearLegend />
      </div>

      {/* The wall. Two columns at 375px (a ~22px cell still reads as a shade),
          three once there's room. Each month is one tap target — well past
          44px — because a day cell here never can be. */}
      <TimePager pageKey={String(year)} onPrev={onPrev} onNext={onNext}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-3 pb-6 min-[560px]:grid-cols-3">
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
      </TimePager>
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
