// The Week body — the phone's week grid.
//
// Like every other lens on this calendar it computes nothing: seven
// `buildDayPlan()` reads laid out by the same `layoutDay()` the Day lens uses,
// so the two grids pack an overlapping Tuesday identically instead of drifting.
//
// What a 375px week can honestly show is SHAPE, not detail: seven ~47px columns
// hold a title fragment at best. So the columns are the scan, and the tap
// targets are the blocks themselves plus the day headers — which are no longer
// here. They are the week row in the chrome (`CalendarChrome`), sharing this
// canvas's hour gutter so each cell sits directly over its column; that row is
// also what the Day lens and the Agenda wear, so it stays put when you change
// rung. This body used to draw its own back header AND its own `‹ Aug 24–30 ›`
// mini-nav AND its own seven day headers: three bands saying what the hero and
// one row now say once.

import { useLayoutEffect, useMemo, useRef } from "react";
import { addDays } from "date-fns";
import type { CalendarTap } from "./MobileEventSheet";
import { buildDayPlan, dayKey, layoutDay, scrollParent, tapFor, type DayCtx, type DayPlan } from "./dayPlan";
import { CAL_EDGE, CAL_GUTTER, hourLabel } from "./CalendarChrome";
import TimePager from "./TimePager";

const HOUR_PX = 52; // the week is a scan, not a canvas — half the Day lens
const MIN_ITEM_PX = 14;

export default function MobileWeekView({
  weekStart,
  ctx,
  loading = false,
  stickyPx,
  onPrev,
  onNext,
  onTapEvent,
  recenter = 0,
}: {
  /** The first day of the week to draw — resolved by `CalendarSurface` from the
   *  selected day and the user's "Week starts on" setting. */
  weekStart: Date;
  ctx: DayCtx;
  loading?: boolean;
  stickyPx: number;
  onPrev: () => void;
  onNext: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  /** See `MobileDayView` — the chrome's Today asking for now, again. */
  recenter?: number;
}) {
  const days = useMemo<DayPlan[]>(
    () => Array.from({ length: 7 }, (_, i) => buildDayPlan(addDays(weekStart, i), ctx)),
    [weekStart, ctx],
  );
  const laidByDay = useMemo(() => days.map((d) => layoutDay(d.timed, d.date)), [days]);

  // One canvas window for the whole week — the working hours widened to hold
  // anything scheduled outside them on ANY day, so the seven columns share a
  // single time axis. Per-column windows would put 9am at seven heights.
  const [winStart, winEnd] = useMemo(() => {
    let s = ctx.workStart;
    let e = ctx.workEnd;
    for (const laid of laidByDay) {
      for (const l of laid) {
        s = Math.min(s, l.startMin);
        e = Math.max(e, l.endMin);
      }
    }
    return [Math.max(0, Math.floor(s / 60) * 60), Math.min(1440, Math.ceil(e / 60) * 60)];
  }, [ctx.workStart, ctx.workEnd, laidByDay]);
  const y = (min: number) => ((min - winStart) * HOUR_PX) / 60;
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = winStart / 60; h <= winEnd / 60; h++) out.push(h);
    return out;
  }, [winStart, winEnd]);

  const todayKey = dayKey(ctx.now);
  const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  const showsToday = days.some((d) => dayKey(d.date) === todayKey);

  // Open on today's hours if today is in view — once. Later paging keeps the
  // scroll so the same hours stay under your thumb across weeks. Deferred a
  // frame so it lands after `CalendarSurface`'s scroll-to-top on a rung change.
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const didAutoScroll = useRef(false);
  useLayoutEffect(() => {
    if (recenter === 0 && didAutoScroll.current) return;
    didAutoScroll.current = true;
    if (!showsToday || nowMin < winStart + 90) return;
    const raf = requestAnimationFrame(() => {
      const scroller = scrollParent(rootRef.current);
      const canvas = canvasRef.current;
      if (!scroller || !canvas) return;
      const canvasTop =
        canvas.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const target = canvasTop + y(Math.min(nowMin, winEnd)) - stickyPx - 80;
      if (target > 8) scroller.scrollTo({ top: target, behavior: recenter ? "smooth" : "auto" });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenter]);

  if (loading && days.every((d) => d.timed.length === 0 && d.allDay.length === 0 && d.anytime.length === 0)) {
    return <div className="px-4 py-10 text-center text-body text-muted">Reading your calendar…</div>;
  }

  return (
    <div ref={rootRef}>
      <TimePager pageKey={dayKey(weekStart)} onPrev={onPrev} onNext={onNext}>
        {/* The canvas wears the surface's one edge, so its seven columns begin
            exactly where the week row's seven cells do — see `CAL_EDGE`. */}
        <div
          className="relative mb-8 mt-2"
          style={{ height: y(winEnd) + 12, marginLeft: CAL_EDGE, marginRight: CAL_EDGE }}
        >
          {/* Hour rules + labels — the shared time axis, in the same gutter and
              the same words as the Day lens. */}
          {hours.map((h) => (
            <div key={h} className="absolute inset-x-0" style={{ top: y(h * 60) }}>
              <span
                className="mono absolute -top-[0.55em] left-0 pr-1.5 text-right text-micro text-muted"
                style={{ width: CAL_GUTTER - 4 }}
              >
                {hourLabel(h)}
              </span>
              <div className="absolute right-0 border-t border-line" style={{ left: CAL_GUTTER }} />
            </div>
          ))}

          {/* Column hairlines — the only thing separating days. */}
          {days.map((_, i) =>
            i === 0 ? null : (
              <div
                key={`sep-${i}`}
                className="absolute top-0 border-l border-line"
                style={{
                  left: `calc(${CAL_GUTTER}px + (100% - ${CAL_GUTTER}px) * ${i / 7})`,
                  height: y(winEnd),
                }}
              />
            ),
          )}

          {/* Now — the one --signal mark on the surface. */}
          {showsToday && nowMin >= winStart && nowMin <= winEnd && (
            <div
              className="pointer-events-none absolute right-0 z-10 border-t"
              style={{ top: y(nowMin), left: CAL_GUTTER, borderColor: "var(--signal)" }}
            />
          )}

          {/* The commitments. Same fills as the Day lens so a block doesn't
              change identity when you zoom out a level. */}
          {days.map((d, di) =>
            laidByDay[di].map((l, i) => {
              const b = l.item;
              const isSlot = b.kind === "slot";
              const isBlock = b.kind === "block";
              const height = Math.max(y(l.endMin) - y(l.startMin), MIN_ITEM_PX);
              const colLeft = `calc(${CAL_GUTTER}px + (100% - ${CAL_GUTTER}px) * ${
                (di + l.col / l.cols) / 7
              } + 1px)`;
              const colWidth = `calc((100% - ${CAL_GUTTER}px) * ${1 / (7 * l.cols)} - 2px)`;
              return (
                <button
                  key={`${di}-${i}`}
                  onClick={() => onTapEvent?.(tapFor(b) as CalendarTap)}
                  className="fast absolute overflow-hidden rounded-[3px] border px-0.5 text-left active:opacity-80"
                  style={{
                    top: y(l.startMin),
                    height,
                    left: colLeft,
                    width: colWidth,
                    opacity: d.isBygone ? 0.6 : 1,
                    background: isSlot
                      ? "color-mix(in srgb, var(--slot) 28%, var(--surface))"
                      : isBlock
                        ? b.done
                          ? "color-mix(in srgb, var(--accent) 5%, transparent)"
                          : "var(--accent-soft)"
                        : "color-mix(in srgb, var(--ink) 7%, transparent)",
                    borderColor: isSlot
                      ? "color-mix(in srgb, var(--slot) 65%, var(--line))"
                      : isBlock
                        ? "color-mix(in srgb, var(--accent) 30%, transparent)"
                        : "var(--line)",
                    borderStyle: isSlot ? "dashed" : "solid",
                  }}
                >
                  <span
                    className={`block truncate text-micro leading-[1.15] ${
                      b.done ? "text-muted line-through" : "text-ink"
                    }`}
                  >
                    {b.title || "Untitled"}
                  </span>
                </button>
              );
            }),
          )}
        </div>
      </TimePager>
    </div>
  );
}
