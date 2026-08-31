// The marks a year is drawn with — twelve month grids of day numerals, worn
// by the desktop Year and the phone's. The Year is a map of the year
// (D-127 · D-128 · D-129): dates you can read, today marked, a tap to drill
// in. Load shading lived here and was cut — it competed with the numerals and
// answered a question the chat's `read_calendar_load` already owns. Verify
// both shells at once at ?year.
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

/** Every month wears six weeks so a row of months shares one baseline. A short
 *  February that stopped at five left August's sixth week hanging alone and
 *  the year grid's floor looked broken (D-129). */
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
  /** Stretch into the parent row height and grow day cells with the pane
   *  (desktop Year). Off on the phone, where the body scrolls and months are
   *  content-sized (D-129). */
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
  // Blank cells before the 1st so the columns are real weekdays.
  const lead = (getDay(days[0]) - weekStartsOn + 7) % 7;
  const trail = Math.max(0, CELLS - lead - days.length);
  const dow = useMemo(
    () => Array.from({ length: 7 }, (_, i) => DOW_INITIALS[(i + weekStartsOn) % 7]),
    [weekStartsOn],
  );
  const label = month.toLocaleDateString([], { month: "long" });
  const inMonth = isSameDay(startOfMonth(now), startOfMonth(month));

  return (
    // `@container` sizes the numeral off the month, not the window — opening
    // Nuvo chat narrows the pane without a viewport change, and a month that
    // was roomy at full width has to quiet its type as it shrinks.
    <section className={`@container min-w-0 ${fill ? "flex h-full min-h-0 flex-col" : ""}`}>
      <div className={`flex items-baseline justify-between gap-2 ${fill ? "mb-1.5 shrink-0" : "mb-1"}`}>
        {onPickMonth ? (
          <button
            onClick={() => onPickMonth(startOfMonth(month))}
            className="fast masthead truncate text-body leading-none hover:text-accent"
            style={{ color: inMonth ? "var(--signal)" : "var(--ink)" }}
            title={`Open ${label}`}
          >
            {label}
          </button>
        ) : (
          <span
            className="masthead truncate text-body leading-none"
            style={{ color: inMonth ? "var(--signal)" : "var(--ink)" }}
          >
            {label}
          </span>
        )}
      </div>

      {showWeekdays && (
        <div aria-hidden className={`grid grid-cols-7 gap-px ${fill ? "shrink-0" : ""}`}>
          {dow.map((d, i) => (
            <div key={i} className="pb-0.5 text-center text-micro leading-none text-muted">
              {d}
            </div>
          ))}
        </div>
      )}

      <div
        className={
          fill
            ? "grid min-h-0 flex-1 grid-cols-7 gap-px [grid-auto-rows:minmax(0,1fr)]"
            : "grid grid-cols-7 gap-px"
        }
      >
        {Array.from({ length: lead }, (_, i) => (
          // Compact months size rows off `aspect-square` day cells; an empty
          // lead/trail without that footprint collapses the sixth week to
          // nothing and the year row's floor breaks again.
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

  const body = (
    <span
      // `overflow-hidden` is belt-and-braces against a future skin bumping the
      // numeral: a cell can clip its own content but never bleed into the day
      // beside it. `tabular-nums` keeps the columns of digits from shivering
      // as the month crosses from single to double digits.
      //
      // Fill mode drops `aspect-square` so the cell grows with the pane; the
      // numeral steps up once the month is wide enough to hold it (D-129).
      className={
        fill
          ? "mono flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-[3px] text-micro leading-none tabular-nums text-muted @[9.5rem]:text-caption"
          : "mono flex aspect-square w-full items-center justify-center overflow-hidden rounded-[3px] text-micro leading-none tabular-nums text-muted"
      }
      style={{
        // Today lifts with the signal ring the rest of the app uses for "now".
        // No fill — density was the disclarity (D-128).
        color: isToday ? "var(--signal)" : undefined,
        boxShadow: isToday ? "inset 0 0 0 1.5px var(--signal)" : undefined,
      }}
    >
      {showNumber ? date.getDate() : ""}
    </span>
  );

  if (!onPick) return <span title={name} aria-label={name} role="img" className={fill ? "min-h-0" : undefined}>{body}</span>;
  return (
    <button
      onClick={() => onPick(date)}
      title={name}
      aria-label={name}
      className={`fast w-full rounded-[3px] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${fill ? "min-h-0" : ""}`}
    >
      {body}
    </button>
  );
});
