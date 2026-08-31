// The marks a year is drawn with — one shade ramp, one month block, one
// legend, worn by the desktop Year view and the phone's. Shade is the read
// (D-106); the day numeral is the index of that read (D-127). Verify both
// shells at once at ?year.
//
// This file is to the Year what `domain/DomainParts.tsx` is to the Domain: the
// two shells are two layouts over one set of marks, so a month can never read
// heavier on the desk than it does in your hand. The *rule* underneath (what
// makes a day heavy) is not here either — it is `dayLoad` in the shared kernel,
// so the chat weighs the same Tuesday the same way.

import { memo, useMemo } from "react";
import { getDay, isSameDay, startOfMonth } from "date-fns";
import { monthDates } from "../mobile/dayPlan";
import {
  LOAD_BANDS,
  fmtMins,
  loadLabel,
  spanLoad,
  type DayLoad,
  type LoadBand,
  type SpanLoad,
} from "../../../supabase/functions/_shared/dayShape.ts";

export type { DayLoad, LoadBand, SpanLoad };
export { spanLoad, loadLabel };

/**
 * The ramp. Lightness is the only variable up to `full`, because load is one
 * quantity and a hue change would read as a different *kind* of day rather
 * than a heavier one.
 *
 * `over` is the exception and earns it: a day promised more time than it holds
 * is not "more full", it is wrong. It wears `--danger` rather than `--signal`,
 * because `--signal` is what the *today* ring in this very component means —
 * "now". A cell shaded "wrong" and a ring meaning "here" were the same hue,
 * which is precisely the ambiguity the token split fixed.
 *
 * `over` also breaks LUMINANCE, not just hue. At `--signal` 55% it measured a
 * 1.00 contrast ratio against `full` — the two were separated by hue alone, on
 * the red/green confusion axis, which made the one band that means "something
 * is wrong" invisible to a deuteranope and to anyone on a glare-washed screen.
 * At 85% it clears `full` by 1.5–2.2× in every theme, and `--on-danger` keeps
 * the numeral above AA on top of it (both directions gated in
 * tests/token-contrast.test.ts).
 *
 * `clear` is deliberately the bare paper — absence drawn as absence is the
 * strongest possible answer to "where is there nothing".
 */
export const LOAD_FILL: Record<LoadBand, string> = {
  clear: "transparent",
  light: "color-mix(in srgb, var(--accent) 13%, transparent)",
  busy: "color-mix(in srgb, var(--accent) 32%, transparent)",
  full: "color-mix(in srgb, var(--accent) 58%, transparent)",
  over: "color-mix(in srgb, var(--danger) 85%, transparent)",
};

/** Ink that survives its own fill. Clear and light used to wear `--muted`,
 *  and that was the whole miss: those are the days you hunt ("where is there
 *  nothing"), and they had the faintest coordinates. A mix of `--ink` keeps
 *  the numeral a coordinate — quieter than the busy/full step-up, present
 *  enough to index. The two middle-dark bands swallow that mix, so they
 *  step up to solid `--ink`; on `over` the fill is dark enough (light
 *  enough, in dark theme) that the ink has to flip, which is what
 *  `--on-danger` is for. */
export const LOAD_INK: Record<LoadBand, string> = {
  clear: "color-mix(in srgb, var(--ink) 62%, transparent)",
  light: "color-mix(in srgb, var(--ink) 78%, transparent)",
  busy: "var(--ink)",
  full: "var(--ink)",
  over: "var(--on-danger)",
};

/** The non-colour half of the `over` signal — a hairline inset ring in the
 *  band's own ink. Shading alone, however far apart in luminance, still asks
 *  the eye to judge "is this square darker than that one"; a ring is a mark
 *  that is either there or not. Only `over` carries one, so it never has to be
 *  compared against a neighbour to be read. */
const overRing = (spread: string) =>
  `inset 0 0 0 ${spread} color-mix(in srgb, var(--on-danger) 62%, transparent)`;

/** The cell's rings, composed. Today and `over` can both be true, and they
 *  stack rather than compete: the signal ring takes the outer 1.5px and the
 *  over ring the 1px just inside it. */
function cellRings(band: LoadBand, isToday: boolean): string | undefined {
  const today = isToday ? "inset 0 0 0 1.5px var(--signal)" : null;
  const over = band === "over" ? overRing(isToday ? "2.5px" : "1px") : null;
  return [today, over].filter(Boolean).join(", ") || undefined;
}

/** SUN…SAT initials for a mini grid's header, in the viewer's locale, built off
 *  a known Sunday read in UTC — the same trick `CalendarPane`'s DOW_LABELS uses,
 *  and for the same reason: a local read of a UTC marker can slide a day. */
const DOW_INITIALS = Array.from({ length: 7 }, (_, i) =>
  new Date(Date.UTC(2024, 0, 7 + i)).toLocaleDateString([], { weekday: "narrow", timeZone: "UTC" }),
);

/** A month's days, in date order — the unit both the grid and `spanLoad` read.
 *  Delegates to `monthDates` in dayPlan.ts, which is what `buildYearLoads`
 *  counts with: two ideas of "how long is February" would silently offset a
 *  leap year's shading by one day. */
export function monthDays(month: Date): Date[] {
  return monthDates(month.getFullYear(), month.getMonth());
}

// ── one month ──────────────────────────────────────────────────────────────

export interface YearMonthProps {
  month: Date;
  /** One load per day of the month, in date order. */
  loads: DayLoad[];
  now: Date;
  weekStartsOn: 0 | 1;
  /** Desktop only — a mouse can hit a 30px square; a thumb cannot, so the phone
   *  leaves this off and makes the whole month the target instead. */
  onPickDay?: (d: Date) => void;
  /** Tapping the month itself (its name on the desk, the whole block on a
   *  phone) — the drill-down every other calendar surface already uses. */
  onPickMonth?: (d: Date) => void;
  /** Render the day-of-month numerals. On by default — they are the *index*,
   *  not the read. Shade still answers "where is this heavy"; the numeral is
   *  how you name the square you just saw (D-127). Pass `false` only for a
   *  deliberately mute sketch; both shipped shells leave this on. */
  showNumbers?: boolean;
  /** Weekday initials above the grid. Travel with the numerals: a column of
   *  1–31 with no S M T W T F S is a texture, not a date. */
  showWeekdays?: boolean;
}

export const YearMonth = memo(function YearMonth({
  month,
  loads,
  now,
  weekStartsOn,
  onPickDay,
  onPickMonth,
  showNumbers = true,
  showWeekdays = true,
}: YearMonthProps) {
  const days = useMemo(() => monthDays(month), [month]);
  // Blank cells before the 1st so the columns are real weekdays.
  const lead = (getDay(days[0]) - weekStartsOn + 7) % 7;
  const dow = useMemo(
    () => Array.from({ length: 7 }, (_, i) => DOW_INITIALS[(i + weekStartsOn) % 7]),
    [weekStartsOn],
  );
  const label = month.toLocaleDateString([], { month: "long" });
  const inMonth = isSameDay(startOfMonth(now), startOfMonth(month));

  return (
    <section className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
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
        <div aria-hidden className="grid grid-cols-7 gap-px">
          {dow.map((d, i) => (
            <div key={i} className="pb-0.5 text-center text-micro leading-none text-muted">
              {d}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-7 gap-px">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} aria-hidden />
        ))}
        {days.map((d, i) => (
          <DayCell
            key={i}
            date={d}
            load={loads[i]}
            isToday={isSameDay(d, now)}
            showNumber={showNumbers}
            onPick={onPickDay}
          />
        ))}
      </div>
    </section>
  );
});

const DayCell = memo(function DayCell({
  date,
  load,
  isToday,
  showNumber,
  onPick,
}: {
  date: Date;
  load: DayLoad;
  isToday: boolean;
  showNumber: boolean;
  onPick?: (d: Date) => void;
}) {
  const band = load?.band ?? "clear";
  // Colour is never the whole answer — the accessible name (and the hover
  // title) says the day and its load in words, so a screen reader crossing the
  // grid hears the same year a sighted scan sees.
  const words =
    band === "clear"
      ? "nothing on"
      : `${loadLabel(band)}${load.claimedMins > 0 ? `, ${fmtMins(load.claimedMins)} claimed` : ""}`;
  const name = `${date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} — ${words}`;

  const body = (
    <span
      // `overflow-hidden` is belt-and-braces against the bug the container
      // query already fixes: even if a future skin bumps the numeral, a cell
      // can clip its own content but never bleed into the day beside it.
      // `tabular-nums` keeps the columns of digits from shivering as the month
      // crosses from single to double digits.
      className="mono flex aspect-square w-full items-center justify-center overflow-hidden rounded-[3px] text-micro leading-none tabular-nums"
      style={{
        background: LOAD_FILL[band],
        color: LOAD_INK[band],
        // Today lifts with the signal ring the rest of the app uses for "now";
        // `over` carries its own ring so the alarm band is readable without
        // colour.
        boxShadow: cellRings(band, isToday),
      }}
    >
      {showNumber ? date.getDate() : ""}
    </span>
  );

  if (!onPick) return <span title={name} aria-label={name} role="img">{body}</span>;
  return (
    <button
      onClick={() => onPick(date)}
      title={name}
      aria-label={name}
      className="fast w-full rounded-[3px] hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {body}
    </button>
  );
});

// ── the legend ─────────────────────────────────────────────────────────────

/** What the shading means, in words. A ramp of tints with no key is a picture
 *  of a year, not a reading of one — and this repo has already learned once
 *  that colour alone fails (the domain coverage strip names its states too). */
export function YearLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {LOAD_BANDS.map((b) => (
        <span key={b} className="flex items-center gap-1 text-micro text-muted">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{
              background: LOAD_FILL[b],
              // The key has to wear whatever the cells wear, ring included —
              // a legend that omits `over`'s mark is a legend for a different
              // grid.
              boxShadow:
                b === "clear" ? "inset 0 0 0 1px var(--line)" : cellRings(b, false),
            }}
          />
          {loadLabel(b)}
        </span>
      ))}
    </div>
  );
}
