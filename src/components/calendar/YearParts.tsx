// The marks a year is drawn with — twelve month grids of day numerals, worn
// by the desktop Year and the phone's. The Year is a map of the year
// (D-127 · D-128 · D-129): dates you can read, today marked, a tap to drill
// in. Load shading lived here and was cut — it competed with the numerals and
// answered a question the chat's `read_calendar_load` already owns. Verify
// both shells at once at ?year.
//
// Hierarchy (read top → bottom, loud → quiet), in the frame's voice (D-190):
//   1. month name  — 13/650 ink; it opens the month
//   2. day numerals — ink-2, tabular; the map itself (not muted texture)
//   3. today        — the ember mark the grid's header and Month wear: the
//                     numeral on --signal. The one ember on the map — the
//                     month you're in needs no second colour to be found.
//   4. weekday row  — 11px faint initials, never competing with dates
// The marks are drawn by index.css (`.yr-*`, beside the Schedule's grid).
//
// The year numeral itself is chrome, not a map mark — Schedule toolbar on the
// desk, top-bar hero on the phone (D-129). Writing it on the map too said the
// date twice (D-132 tried; reversed).
//
// Spacing: Apple's year keeps the number grid DENSE — week rows stay near
// square off the month's width, and leftover pane height sits under the grid,
// not between the numerals. Stretching weeks with bare `1fr` was how 31 floated
// in a tall empty cell. Every month pads to six weeks so a row of months shares
// one footprint; empty trailing cells are the same compact size as a day.
//
// This file is to the Year what `domain/DomainParts.tsx` is to the Domain: the
// two shells are two layouts over one set of marks, so a month can never read
// differently on the desk than it does in your hand.

import { memo, useMemo } from "react";
import { getDay, isSameDay, startOfMonth } from "date-fns";
import { monthDates } from "../mobile/dayPlan";

/** SUN…SAT initials for a mini grid's header, in the viewer's locale, built off
 *  a known Sunday read in UTC — the same trick `CalendarPane`'s DOW_LABELS uses,
 *  and for the same reason: a local read of a UTC marker can slide a day. */
const DOW_INITIALS = Array.from({ length: 7 }, (_, i) =>
  new Date(Date.UTC(2024, 0, 7 + i)).toLocaleDateString([], { weekday: "narrow", timeZone: "UTC" }),
);

/** Six weeks × seven days. Lead + days + trail always fill this, so every
 *  month in a Year row shares one baseline. */
const WEEKS = 6;
const CELLS = WEEKS * 7;

/** A month's days, in date order. Delegates to `monthDates` in dayPlan.ts so
 *  the Year and every other surface that counts a month agree on February. */
export function monthDays(month: Date): Date[] {
  return monthDates(month.getFullYear(), month.getMonth());
}

// ── one month ──────────────────────────────────────────────────────────────

export interface YearMonthProps {
  month: Date;
  now: Date;
  weekStartsOn: 0 | 1;
  /** Desktop only — a mouse can hit a 30px square; a thumb cannot, so the phone
   *  leaves this off and makes the whole month the target instead. */
  onPickDay?: (d: Date) => void;
  /** Tapping the month itself (its name on the desk, the whole block on a
   *  phone) — the drill-down every other calendar surface already uses. */
  onPickMonth?: (d: Date) => void;
  /** Render the day-of-month numerals. On by default — they are the map
   *  (D-127). Pass `false` only for a deliberately mute sketch. */
  showNumbers?: boolean;
  /** Weekday initials above the grid. Travel with the numerals: a column of
   *  1–31 with no S M T W T F S is a texture, not a date. */
  showWeekdays?: boolean;
  /** Stretch into the parent row height (desktop Year). The *month box*
   *  claims the row; the number grid stays dense — six square weeks off the
   *  month's width — so leftover height falls under the grid, not between
   *  the dates (D-129). */
  fill?: boolean;
}

export const YearMonth = memo(function YearMonth({
  month,
  now,
  weekStartsOn,
  onPickDay,
  onPickMonth,
  showNumbers = true,
  showWeekdays = true,
  fill = false,
}: YearMonthProps) {
  const days = useMemo(() => monthDays(month), [month]);
  const lead = (getDay(days[0]) - weekStartsOn + 7) % 7;
  const trail = Math.max(0, CELLS - lead - days.length);
  const dow = useMemo(
    () => Array.from({ length: 7 }, (_, i) => DOW_INITIALS[(i + weekStartsOn) % 7]),
    [weekStartsOn],
  );
  const label = month.toLocaleDateString([], { month: "long" });

  return (
    // `@container` sizes type off the month, not the window — opening Nuvo
    // chat narrows the pane without a viewport change.
    <section className={`yr-month @container min-w-0 ${fill ? "flex h-full min-h-0 flex-col" : ""}`}>
      <div className={`flex items-baseline justify-between gap-2 ${fill ? "mb-1 shrink-0" : "mb-1"}`}>
        {onPickMonth ? (
          <button type="button" onClick={() => onPickMonth(startOfMonth(month))} className="yr-month-name" title={`Open ${label}`}>
            {label}
          </button>
        ) : (
          <span className="yr-month-name">{label}</span>
        )}
      </div>

      {showWeekdays && (
        <div aria-hidden className={`grid grid-cols-7 ${fill ? "shrink-0" : ""}`}>
          {dow.map((d, i) => (
            <div key={i} className="yr-dow">
              {d}
            </div>
          ))}
        </div>
      )}

      {/* Dense number grid — height from width (`aspect-ratio: 7/6`), not from
          the pane. Six square weeks. Leftover pane height is the spacer below,
          so numerals stay packed the way Apple's year packs them. */}
      <div
        className={
          fill
            ? "grid w-full shrink-0 grid-cols-7 grid-rows-6"
            : "grid w-full grid-cols-7"
        }
        style={fill ? { aspectRatio: `${7} / ${WEEKS}` } : undefined}
      >
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} aria-hidden className={fill ? undefined : "aspect-square"} />
        ))}
        {days.map((d, i) => (
          <DayCell
            key={i}
            date={d}
            isToday={isSameDay(d, now)}
            showNumber={showNumbers}
            fill={fill}
            onPick={onPickDay}
          />
        ))}
        {Array.from({ length: trail }, (_, i) => (
          <div key={`trail-${i}`} aria-hidden className={fill ? undefined : "aspect-square"} />
        ))}
      </div>

      {fill && <div className="min-h-0 flex-1" aria-hidden />}
    </section>
  );
});

const DayCell = memo(function DayCell({
  date,
  isToday,
  showNumber,
  fill,
  onPick,
}: {
  date: Date;
  isToday: boolean;
  showNumber: boolean;
  fill: boolean;
  onPick?: (d: Date) => void;
}) {
  const name = date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  // A dense field of dates, not beads in tall cells: the numeral is the cell's
  // only content, and today alone wears the ember (`.yr-num[data-today]`).
  const body = (
    <span className="flex h-full w-full items-center justify-center">
      <span className="yr-num" data-today={isToday || undefined} data-fill={fill || undefined}>
        {showNumber ? date.getDate() : ""}
      </span>
    </span>
  );

  if (!onPick) {
    return (
      <span title={name} aria-label={name} role="img" className={fill ? undefined : "aspect-square"}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onPick(date)}
      title={name}
      aria-label={name}
      className={`yr-day w-full ${fill ? "h-full" : "aspect-square"}`}
    >
      {body}
    </button>
  );
});
