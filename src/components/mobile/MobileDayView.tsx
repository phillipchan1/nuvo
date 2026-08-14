// The Day lens — one day of the mobile Calendar drawn as a proportional time
// grid, so how long each commitment is (and how much room sits between them)
// reads instantly, the way it does on the desktop Schedule. The List lens
// answers "what's coming, and when am I free" across two weeks; this answers
// "what is this day's SHAPE". Same buildDayPlan(), same tap sheet, same open-
// window math (readDay) — a second projection of one truth, never a second
// computation.
//
// Traversal is the house grammar for planner surfaces on a phone (the
// horizontal axis becomes pages): swipe left/right walks a day at a time, the
// date strip jumps anywhere, and a pinned Today chip returns you. Vertical
// scroll position is deliberately KEPT across swipes so the same hours stay
// under your thumb while you compare days.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, format, startOfDay, startOfWeek } from "date-fns";
import { fmtMins } from "../../lib/now";
import type { CalendarTap } from "./MobileEventSheet";
import type { indexWeather } from "../../hooks/useWeather";
import WeatherIcon from "../WeatherIcon";
import TimeZoneChip from "../TimeZoneChip";
import { Icon } from "../Icon";
import {
  at,
  buildDayPlan,
  dayKey,
  dayReadout,
  scrollParent,
  type DayCtx,
  type TimedItem,
} from "./dayPlan";
import { startSwipe, trackSwipe, endSwipe, type SwipeTracker } from "./swipe";

/** The two drill-in lenses of the mobile Calendar. */
export type CalLens = "schedule" | "day";

const HOUR_PX = 88; // 30 min = 44px — a half-hour block IS a tap target
const MIN_ITEM_PX = 22; // a 15-min item stays readable without lying much
const GUTTER = 56; // hour-label column
// The strip is anchored to the selected day's week — the user's "Week starts
// on" setting, passed down so it matches the Day fetch window in
// MobileCalendar — so its chips hold still while you swipe within a week
// instead of re-centering on every day change.
const STRIP_BEHIND = 7;
const STRIP_AHEAD = 21;
const STICKY_OFFSET = 112; // back header + date strip — matches the List lens

/** The List | Day switch — the calendar view-pill idiom (rounded trough, the
 *  active face lifted onto the surface in the accent) at thumb size. Lives here
 *  so both lenses mount the same control without an import cycle. */
export function CalLensPill({ lens, onLens }: { lens: CalLens; onLens: (l: CalLens) => void }) {
  const faces: { id: CalLens; label: string }[] = [
    { id: "schedule", label: "List" },
    { id: "day", label: "Day" },
  ];
  return (
    <div data-tabs="day" className="flex shrink-0 rounded-full bg-surface-2 p-0.5">
      {faces.map((f) => {
        const on = lens === f.id;
        return (
          <button
            key={f.id}
            onClick={() => !on && onLens(f.id)}
            aria-pressed={on}
            data-on={on}
            className={`fast relative rounded-full px-3 py-1 text-label font-medium after:absolute after:-inset-2 after:content-[''] ${
              on ? "bg-surface text-accent" : "text-muted"
            }`}
            style={on ? { boxShadow: "var(--shadow-1)" } : undefined}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Laying the day out ─────────────────────────────────────────────────────

interface Laid {
  item: TimedItem;
  startMin: number; // wall-clock minutes into the selected day, clamped [0,1440]
  endMin: number;
  col: number;
  cols: number;
}

// Overlap packing — the classic day-grid algorithm: sort by start (longer
// first on ties), walk runs of transitively-overlapping items, give each the
// first free column, and let every member of a run share its column count.
function layoutDay(items: TimedItem[], date: Date): Laid[] {
  const dk = dayKey(date);
  const mins = (d: Date, edge: 0 | 1440) => (dayKey(d) === dk ? d.getHours() * 60 + d.getMinutes() : edge);
  const laid: Laid[] = items.map((item) => {
    const startMin = mins(item.start, 0);
    return { item, startMin, endMin: Math.max(mins(item.end, 1440), startMin + 1), col: 0, cols: 1 };
  });
  laid.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

  let cluster: Laid[] = [];
  let colEnds: number[] = [];
  let clusterMax = -1;
  const flush = () => {
    for (const l of cluster) l.cols = colEnds.length;
    cluster = [];
    colEnds = [];
    clusterMax = -1;
  };
  for (const l of laid) {
    if (cluster.length && l.startMin >= clusterMax) flush();
    let col = colEnds.findIndex((e) => e <= l.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(l.endMin);
    } else {
      colEnds[col] = Math.max(colEnds[col], l.endMin);
    }
    l.col = col;
    cluster.push(l);
    clusterMax = Math.max(clusterMax, l.endMin);
  }
  flush();
  return laid;
}

const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });

// ── The lens ───────────────────────────────────────────────────────────────

export default function MobileDayView({
  selected,
  weekStartsOn = 1,
  ctx,
  weatherIndex,
  loading = false,
  onSelect,
  onLens,
  onBack,
  onTapEvent,
  onNewEvent,
}: {
  selected: Date;
  /** First day of the week for the date strip — user_settings.week_start. */
  weekStartsOn?: 0 | 1;
  ctx: DayCtx;
  weatherIndex: ReturnType<typeof indexWeather> | null;
  loading?: boolean;
  onSelect: (d: Date) => void;
  onLens: (l: CalLens) => void;
  onBack: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onNewEvent?: () => void;
}) {
  const plan = useMemo(() => buildDayPlan(selected, ctx), [selected, ctx]);
  const readout = dayReadout(plan);
  const laid = useMemo(() => layoutDay(plan.timed, selected), [plan, selected]);
  const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();

  // The canvas window: the working hours, widened to hold anything scheduled
  // outside them, snapped to whole hours — every pixel earns its place, and an
  // empty day still draws the real working window (useful with zero data).
  const [winStart, winEnd] = useMemo(() => {
    let s = ctx.workStart;
    let e = ctx.workEnd;
    for (const l of laid) {
      s = Math.min(s, l.startMin);
      e = Math.max(e, l.endMin);
    }
    return [Math.max(0, Math.floor(s / 60) * 60), Math.min(1440, Math.ceil(e / 60) * 60)];
  }, [ctx.workStart, ctx.workEnd, laid]);
  const y = (min: number) => ((min - winStart) * HOUR_PX) / 60;
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = winStart / 60; h <= winEnd / 60; h++) out.push(h);
    return out;
  }, [winStart, winEnd]);

  // Day traversal — swipe is primary; the strip and the pinned Today chip are
  // the tap paths. The arriving day slides in from the direction you moved.
  const [slide, setSlide] = useState<"fwd" | "back" | null>(null);
  const go = (d: Date) => {
    const target = startOfDay(d);
    if (dayKey(target) === dayKey(selected)) return;
    setSlide(target > selected ? "fwd" : "back");
    onSelect(target);
  };
  const touch = useRef<SwipeTracker | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = startSwipe(e, scrollParent(rootRef.current));
  };
  const onTouchMove = () => trackSwipe(touch.current);
  const onTouchEnd = (e: React.TouchEvent) => {
    const dir = endSwipe(touch.current, e);
    touch.current = null;
    if (dir === "left") go(addDays(selected, 1));
    else if (dir === "right") go(addDays(selected, -1));
  };

  // The strip — the same chips as the List lens, but here they *select* the
  // visible day rather than jump-scrolling a list.
  const stripDays = useMemo(() => {
    const start = addDays(startOfWeek(startOfDay(selected), { weekStartsOn }), -STRIP_BEHIND);
    return Array.from({ length: STRIP_BEHIND + STRIP_AHEAD }, (_, i) => buildDayPlan(addDays(start, i), ctx));
  }, [selected, ctx, weekStartsOn]);
  const stripRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const stripSettled = useRef(false);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const chip = chipRefs.current[dayKey(selected)];
    if (!strip || !chip) return;
    const target = Math.max(0, chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2);
    strip.scrollTo({ left: target, behavior: stripSettled.current ? "smooth" : "auto" });
    stripSettled.current = true;
  }, [selected]);

  // Opening on today mid-day: park the now line in the upper third, once. Any
  // later traversal keeps whatever scroll you're at (time stays aligned).
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const didAutoScroll = useRef(false);
  useLayoutEffect(() => {
    if (didAutoScroll.current) return;
    didAutoScroll.current = true;
    if (!plan.isToday || nowMin < winStart + 90) return;
    const scroller = scrollParent(rootRef.current);
    const canvas = canvasRef.current;
    if (!scroller || !canvas) return;
    const canvasTop =
      canvas.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const target = canvasTop + y(Math.min(nowMin, winEnd)) - STICKY_OFFSET - 120;
    if (target > 8) scroller.scrollTo({ top: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itemArea = `calc(100% - ${GUTTER}px)`;

  return (
    <div ref={rootRef}>
      {/* Back header — pops to the month grid; the pill switches the lens. */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-surface/90 pr-3 backdrop-blur">
        <button
          onClick={onBack}
          className="tap fast flex items-center gap-0.5 px-3 py-2.5 text-body font-medium text-accent active:opacity-70"
        >
          <span className="text-head leading-none">‹</span>
          {format(selected, "MMMM yyyy")}
        </button>
        <div className="flex-1" />
        <CalLensPill lens="day" onLens={onLens} />
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

      {/* Date strip — tap a day to show it. Today is pinned back when you've
          wandered; the selected chip carries the accent. */}
      <div className="sticky top-[45px] z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="flex items-center">
          {!plan.isToday && (
            <button
              onClick={() => go(ctx.now)}
              className="tap fast ml-2 shrink-0 rounded-full border border-line px-2.5 py-1 text-label font-medium text-muted active:bg-surface-2"
            >
              Today
            </button>
          )}
          <div ref={stripRef} className="mobile-scroll flex gap-1.5 overflow-x-auto px-3 py-2.5">
            {stripDays.map((d) => {
              const key = dayKey(d.date);
              const isSel = key === dayKey(selected);
              const busyDay = d.timed.length > 0 || d.allDay.length > 0;
              const wx = weatherIndex?.get(d.date.toLocaleDateString("en-CA"));
              return (
                <button
                  key={key}
                  ref={(el) => {
                    chipRefs.current[key] = el;
                  }}
                  onClick={() => go(d.date)}
                  className={`tap fast flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border py-1.5 ${
                    isSel ? "border-accent bg-accent-soft" : d.isBygone ? "border-line opacity-60" : "border-line"
                  }`}
                >
                  <span
                    className={`text-micro font-medium uppercase ${isSel || d.isToday ? "text-accent" : "text-muted"}`}
                  >
                    {d.date.toLocaleDateString([], { weekday: "short" }).slice(0, 2)}
                  </span>
                  <span
                    className={`text-body font-semibold leading-none ${
                      isSel || d.isToday ? "text-accent" : d.isBygone ? "text-muted" : "text-ink"
                    }`}
                  >
                    {d.date.getDate()}
                  </span>
                  {wx ? (
                    <WeatherIcon wmo={wx.wmo} size={12} />
                  ) : (
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ background: busyDay ? "var(--line-strong)" : "transparent" }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* The day itself — swipe left/right to traverse. touch-pan-y keeps the
          vertical scroll native while we watch for the horizontal gesture;
          swipe.ts ignores edge starts (iOS back) and anything that scrolled. */}
      <div className="touch-pan-y" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {/* Don't claim a day is open before the calendar has answered. */}
        {loading && plan.timed.length === 0 && plan.allDay.length === 0 ? (
          <div className="px-4 py-10 text-center text-body text-muted">Reading your calendar…</div>
        ) : (
        <div
          key={dayKey(selected)}
          className={slide === "fwd" ? "day-in-fwd" : slide === "back" ? "day-in-back" : undefined}
        >
          {/* Day header — the same read as the List lens's day card. */}
          <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
            <div className="flex items-baseline gap-2">
              <span
                className={`text-head font-semibold ${
                  plan.isToday ? "text-accent" : plan.isBygone ? "text-muted" : "text-ink"
                }`}
              >
                {plan.label}
              </span>
              <span className="mono text-label text-muted">
                {selected.toLocaleDateString([], { month: "short", day: "numeric" })}
              </span>
            </div>
            {readout.text && (
              <span
                className="mono text-label"
                style={{ color: readout.accent ? "var(--accent)" : "var(--muted)" }}
              >
                {readout.text}
              </span>
            )}
          </div>

          {/* All-day banners */}
          {plan.allDay.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-1 pt-1">
              {plan.allDay.map((e) => (
                <button
                  key={e.id}
                  onClick={() =>
                    onTapEvent?.({
                      kind: "event",
                      id: e.id,
                      title: e.title || "Busy",
                      start: new Date(e.start_at),
                      end: new Date(e.end_at),
                      allDay: true,
                      location: e.location,
                      self_rsvp: e.self_rsvp ?? null,
                      accountId: e.account_id,
                      calendarId: e.calendar_id,
                    })
                  }
                  className="tap fast mono rounded-md border border-line bg-surface-2 px-2 py-0.5 text-label text-muted active:bg-surface"
                >
                  {e.title || "Busy"}
                </button>
              ))}
            </div>
          )}

          {plan.isBygone && plan.timed.length === 0 && plan.allDay.length === 0 && (
            <div className="px-4 pt-1 text-body text-muted">Nothing scheduled.</div>
          )}

          {/* The canvas — transparent on the paper; hairline hour rules carry
              the structure. A bygone day reads as history, quieter. */}
          <div
            ref={canvasRef}
            className={`relative mx-4 mb-8 mt-2 ${plan.isBygone ? "opacity-70" : ""}`}
            style={{ height: y(winEnd) + 14 }}
          >
            {hours.map((h) => (
              <div key={h} className="absolute inset-x-0" style={{ top: y(h * 60) }}>
                <span className="mono absolute -top-[0.55em] left-0 w-[46px] pr-1.5 text-right text-micro text-muted">
                  {hourLabel(h)}
                </span>
                <div className="absolute right-0 border-t border-line" style={{ left: GUTTER }} />
              </div>
            ))}

            {/* Open windows — the availability answer, drawn to scale: no fill
                (absence has none), one --slot bracket and its size. */}
            {!plan.isPast &&
              !plan.isBygone &&
              plan.gaps.map((g, i) => {
                const gs = g.start.getHours() * 60 + g.start.getMinutes();
                const h = (g.mins * HOUR_PX) / 60;
                return (
                  <div
                    key={i}
                    className="pointer-events-none absolute flex items-center gap-1.5"
                    style={{ top: y(gs), height: h, left: GUTTER + 2 }}
                  >
                    <span
                      className="h-full w-[3px] rounded-full"
                      style={{ background: "color-mix(in srgb, var(--slot) 55%, transparent)" }}
                    />
                    {h >= 22 && (
                      <span className="mono text-micro font-medium" style={{ color: "var(--slot)" }}>
                        {fmtMins(g.mins)}
                      </span>
                    )}
                  </div>
                );
              })}

            {/* Commitments — events neutral, your blocks in the accent, drawn
                at their true height. Overlaps share the width in columns. */}
            {laid.map((l, i) => {
              const b = l.item;
              const height = Math.max(y(l.endMin) - y(l.startMin), MIN_ITEM_PX);
              const compact = height < 34;
              const isBlock = b.kind === "block";
              const isSlot = b.kind === "slot";
              // Room to peek at what's inside, past the title/time/badge rows.
              const showChildren = isSlot && height > 58 && (b.children?.length ?? 0) > 0;
              const isProjectSlot = isSlot && b.projectBacked;
              const tap: CalendarTap =
                b.kind === "event"
                  ? {
                      kind: "event",
                      id: b.eventId!,
                      title: b.title || "Untitled",
                      start: b.start,
                      end: b.end,
                      location: b.location ?? null,
                      self_rsvp: b.self_rsvp,
                      accountId: b.accountId,
                      calendarId: b.calendarId,
                    }
                  : isSlot
                    ? { kind: "slot", slot: b.slot!, title: b.title || "Untitled", start: b.start, end: b.end, childCount: b.childCount ?? 0, doneCount: b.doneCount ?? 0 }
                    : { kind: "block", taskId: b.taskId!, title: b.title || "Untitled", start: b.start, end: b.end, done: !!b.done };
              return (
                <button
                  key={i}
                  onClick={() => onTapEvent?.(tap)}
                  className="fast absolute rounded-md border text-left after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] active:opacity-80"
                  style={{
                    top: y(l.startMin),
                    height,
                    left: `calc(${GUTTER + 2}px + (${itemArea} - 2px) * ${l.col / l.cols})`,
                    width: `calc((${itemArea} - 2px) * ${1 / l.cols} - ${l.cols > 1 ? 2 : 0}px)`,
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
                    borderWidth: isSlot ? 1.5 : 1,
                  }}
                >
                  {isBlock && !b.done && (
                    <span className="absolute bottom-[3px] left-[3px] top-[3px] w-[3px] rounded-full bg-accent" />
                  )}
                  {isSlot && (
                    // A slot is a container, not a single item — the bar reads
                    // wider than a plain task/event's, and doubles for a
                    // project-backed one (same "significant work" cue the
                    // desktop CalendarPane gives isProject blocks).
                    <span
                      className="absolute bottom-[3px] left-[3px] top-[3px] rounded-full"
                      style={{
                        width: isProjectSlot ? 4 : 3,
                        background: "var(--slot)",
                        boxShadow: isProjectSlot
                          ? "inset 2px 0 0 color-mix(in srgb, var(--slot) 45%, transparent)"
                          : undefined,
                      }}
                    />
                  )}
                  <div
                    className={`h-full min-w-0 overflow-hidden rounded-[5px] ${isBlock || isSlot ? "pl-2.5" : "pl-2"} pr-1.5 ${
                      compact ? "flex items-center gap-1.5" : "py-1"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      <div
                        className={`min-w-0 truncate ${compact ? "text-meta" : "text-label"} font-medium ${
                          b.done ? "text-muted line-through" : "text-ink"
                        }`}
                      >
                        {b.projectBacked ? `▸ ${b.title || "Untitled"}` : b.title || "Untitled"}
                      </div>
                      {isSlot && (b.childCount ?? 0) > 0 && (
                        <span
                          className="mono ml-auto shrink-0 rounded-full px-1 text-micro leading-snug text-muted"
                          style={{ background: "var(--bg)" }}
                        >
                          {b.doneCount}/{b.childCount}
                        </span>
                      )}
                    </div>
                    {!compact && (
                      <div className="mono truncate text-micro text-muted">
                        {at(b.start)}–{at(b.end)}
                        {b.location ? ` · ${b.location}` : ""}
                      </div>
                    )}
                    {showChildren && (
                      <div className="mt-1 flex min-h-0 flex-col gap-0.5 overflow-hidden">
                        {b.children!.slice(0, 3).map((c, ci) => (
                          <div key={ci} className="flex items-center gap-1.5 text-micro leading-tight">
                            <span
                              className="h-[3px] w-[3px] shrink-0 rounded-full"
                              style={{ background: c.done ? "var(--muted)" : "var(--slot)" }}
                            />
                            <span className={`truncate ${c.done ? "text-muted line-through opacity-60" : "text-muted"}`}>
                              {c.title}
                            </span>
                          </div>
                        ))}
                        {b.children!.length > 3 && (
                          <span className="pl-[9px] text-micro text-muted">+{b.children!.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

            {/* Now — the one thing --signal is for. */}
            {plan.isToday && nowMin >= winStart && nowMin <= winEnd && (
              <div
                className="pointer-events-none absolute z-10"
                style={{ top: y(nowMin) - 1, left: GUTTER - 5, right: 0 }}
              >
                <div className="relative h-[2px] rounded-full" style={{ background: "var(--signal)" }}>
                  <span
                    className="absolute -left-0.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                    style={{ background: "var(--signal)" }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
