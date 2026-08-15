// The Week lens — the phone's missing week grid.
//
// The audit's rank-10 finding, phone half: the desktop had a week grid and the
// phone did not, so "how full is this week" was a question you could only ask
// at a desk. This answers it, and — like every other lens on this calendar —
// it computes nothing: seven `buildDayPlan()` reads laid out by the same
// `layoutDay()` the Day lens uses, so the two grids pack an overlapping
// Tuesday identically instead of drifting.
//
// What a 375px week can honestly show is SHAPE, not detail: seven ~46px
// columns hold a title fragment at best. So the columns are the scan and the
// tap targets are the day headers (44px, drill into the Day lens) and the
// blocks themselves (which open the same sheet as everywhere else). Traversal
// is the house grammar — swipe left/right pages a week.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, format, startOfDay, startOfWeek } from "date-fns";
import type { CalendarTap } from "./MobileEventSheet";
import TimeZoneChip from "../TimeZoneChip";
import { Icon } from "../Icon";
import {
  buildDayPlan,
  dayKey,
  layoutDay,
  scrollParent,
  tapFor,
  type DayCtx,
  type DayPlan,
} from "./dayPlan";
import { CalLensPill, type CalLens } from "./MobileDayView";
import { startSwipe, trackSwipe, endSwipe, type SwipeTracker } from "./swipe";

const HOUR_PX = 52; // the week is a scan, not a canvas — half the Day lens
const MIN_ITEM_PX = 14;
const GUTTER = 34; // hour-label column, narrower than the Day lens's 56
const STICKY_OFFSET = 96; // back header + day header row

const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" }).replace(" ", "").toLowerCase();

export default function MobileWeekView({
  selected,
  weekStartsOn = 1,
  ctx,
  loading = false,
  onSelect,
  onLens,
  onBack,
  onTapEvent,
  onNewEvent,
}: {
  /** Any day inside the week to show. */
  selected: Date;
  weekStartsOn?: 0 | 1;
  ctx: DayCtx;
  loading?: boolean;
  onSelect: (d: Date) => void;
  onLens: (l: CalLens, day?: Date) => void;
  onBack: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onNewEvent?: () => void;
}) {
  const weekStart = useMemo(
    () => startOfWeek(startOfDay(selected), { weekStartsOn }),
    [selected, weekStartsOn],
  );
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

  // Week traversal — swipe pages, the arriving week slides in from the
  // direction you moved. Same idiom as the Day lens, a week at a time.
  const [slide, setSlide] = useState<"fwd" | "back" | null>(null);
  const goWeek = (delta: -1 | 1) => {
    setSlide(delta > 0 ? "fwd" : "back");
    onSelect(addDays(weekStart, delta * 7));
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const touch = useRef<SwipeTracker | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = startSwipe(e, scrollParent(rootRef.current));
  };
  const onTouchMove = () => trackSwipe(touch.current);
  const onTouchEnd = (e: React.TouchEvent) => {
    const dir = endSwipe(touch.current, e);
    touch.current = null;
    if (dir === "left") goWeek(1);
    else if (dir === "right") goWeek(-1);
  };

  // Open on today's hours if today is in view — once. Later paging keeps the
  // scroll so the same hours stay under your thumb across weeks.
  const canvasRef = useRef<HTMLDivElement>(null);
  const didAutoScroll = useRef(false);
  useLayoutEffect(() => {
    if (didAutoScroll.current) return;
    didAutoScroll.current = true;
    if (!showsToday || nowMin < winStart + 90) return;
    const scroller = scrollParent(rootRef.current);
    const canvas = canvasRef.current;
    if (!scroller || !canvas) return;
    const canvasTop =
      canvas.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const target = canvasTop + y(Math.min(nowMin, winEnd)) - STICKY_OFFSET - 100;
    if (target > 8) scroller.scrollTo({ top: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weekLabel =
    format(weekStart, "MMM d") + " – " + format(addDays(weekStart, 6), format(weekStart, "MMM") === format(addDays(weekStart, 6), "MMM") ? "d" : "MMM d");
  const colPct = 100 / 7;

  return (
    <div ref={rootRef}>
      {/* Back header — pops to the month grid; the pill switches the lens. */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-surface/90 pr-3 backdrop-blur">
        <button
          onClick={onBack}
          className="tap fast flex items-center gap-0.5 px-3 py-2.5 text-body font-medium text-accent active:opacity-70"
        >
          <span className="text-head leading-none">‹</span>
          {format(weekStart, "MMMM yyyy")}
        </button>
        <div className="flex-1" />
        <CalLensPill lens="week" onLens={(l) => onLens(l, selected)} />
        <TimeZoneChip now={ctx.now} />
        {onNewEvent && (
          <button
            type="button"
            onClick={onNewEvent}
            aria-label="New event"
            className="tap fast flex h-11 w-11 items-center justify-center rounded-full text-head text-accent active:bg-surface-2"
          >
            <Icon name="plus" size={16} />
          </button>
        )}
      </div>

      {/* Day header row — the week's tap targets. Each is 44px and drills into
          that day's Day lens; the all-day count rides underneath as a dot so a
          holiday or a PTO day doesn't vanish from the week entirely. */}
      <div className="sticky top-[45px] z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="flex items-center justify-between px-2 pt-1.5">
          <button
            onClick={() => goWeek(-1)}
            aria-label="Previous week"
            className="tap fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2"
          >
            <Icon name="chevron-left" size={14} />
          </button>
          <span className="mono text-label text-muted">{weekLabel}</span>
          <button
            onClick={() => goWeek(1)}
            aria-label="Next week"
            className="tap fast flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-surface-2"
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
        <div className="flex pb-1" style={{ paddingLeft: GUTTER }}>
          {days.map((d) => {
            const isToday = dayKey(d.date) === todayKey;
            return (
              <button
                key={dayKey(d.date)}
                onClick={() => onLens("day", d.date)}
                aria-label={`Open ${format(d.date, "EEEE MMMM d")}`}
                className="tap fast flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1 active:bg-surface-2"
                style={{ width: `${colPct}%` }}
              >
                <span
                  className={`text-micro font-medium uppercase ${isToday ? "text-signal" : "text-muted"}`}
                >
                  {format(d.date, "EEEEE")}
                </span>
                <span
                  className={`text-label font-semibold leading-none ${
                    isToday ? "text-signal" : d.isBygone ? "text-muted" : "text-ink"
                  }`}
                >
                  {d.date.getDate()}
                </span>
                <span
                  className="h-1 w-1 rounded-full"
                  style={{ background: d.allDay.length ? "var(--line-strong)" : "transparent" }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {loading && days.every((d) => d.timed.length === 0 && d.allDay.length === 0) ? (
        <div className="px-4 py-10 text-center text-body text-muted">Reading your calendar…</div>
      ) : (
        <div className="touch-pan-y" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div
            key={dayKey(weekStart)}
            className={slide === "fwd" ? "day-in-fwd" : slide === "back" ? "day-in-back" : undefined}
          >
            <div ref={canvasRef} className="relative mx-1.5 mb-8 mt-2" style={{ height: y(winEnd) + 12 }}>
              {/* Hour rules + labels — the shared time axis. */}
              {hours.map((h) => (
                <div key={h} className="absolute inset-x-0" style={{ top: y(h * 60) }}>
                  <span className="mono absolute -top-[0.55em] left-0 w-[30px] pr-1 text-right text-micro text-muted">
                    {hourLabel(h)}
                  </span>
                  <div className="absolute right-0 border-t border-line" style={{ left: GUTTER }} />
                </div>
              ))}

              {/* Column hairlines — the only thing separating days. */}
              {days.map((_, i) =>
                i === 0 ? null : (
                  <div
                    key={`sep-${i}`}
                    className="absolute top-0 border-l border-line"
                    style={{ left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${i / 7})`, height: y(winEnd) }}
                  />
                ),
              )}

              {/* Now — the one --signal mark on the surface. */}
              {showsToday && nowMin >= winStart && nowMin <= winEnd && (
                <div
                  className="pointer-events-none absolute right-0 z-10 border-t"
                  style={{ top: y(nowMin), left: GUTTER, borderColor: "var(--signal)" }}
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
                  const colLeft = `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${(di + l.col / l.cols) / 7} + 1px)`;
                  const colWidth = `calc((100% - ${GUTTER}px) * ${1 / (7 * l.cols)} - 2px)`;
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
          </div>
        </div>
      )}
    </div>
  );
}
