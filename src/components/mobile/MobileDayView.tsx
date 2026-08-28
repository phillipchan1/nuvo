// The Day body — one day drawn as a proportional time grid, so how long each
// commitment is (and how much room sits between them) reads instantly, the way
// it does on the desktop Schedule. The Agenda answers "what's coming, and when
// am I free" across two weeks; this answers "what is this day's SHAPE". Same
// buildDayPlan(), same tap sheet, same open-window math (readDay) — a second
// projection of one truth, never a second computation.
//
// Body only. It used to carry three bands of its own — a `‹ Aug 2026` back
// header, a 28-chip horizontal scroller, and a day header repeating the label,
// the date and the day's read. All three are now the one chrome
// (`CalendarChrome`), where the day's name is the hero and the week row is
// seven fixed columns instead of a scroller you had to fling. Nothing about
// this surface unmounts when you change horizon, so the eye keeps its place.
//
// Traversal is the house grammar for planner surfaces on a phone (the
// horizontal axis becomes pages): swipe left/right walks a day at a time.
// Vertical scroll position is deliberately KEPT across swipes so the same hours
// stay under your thumb while you compare days.

import { useLayoutEffect, useMemo, useRef } from "react";
import { fmtMins } from "../../lib/now";
import type { CalendarTap } from "./MobileEventSheet";
import { buildDayPlan, dayKey, layoutDay, scrollParent, tapFor, type DayCtx } from "./dayPlan";
import { CAL_GUTTER, hourLabel } from "./CalendarChrome";
import TimePager from "./TimePager";
// One spelling for what a block IS — shared with the Schedule and the ritual.
import { blockDesignation } from "../../lib/slots";

const HOUR_PX = 88; // 30 min = 44px — a half-hour block IS a tap target
const MIN_ITEM_PX = 22; // a 15-min item stays readable without lying much

export default function MobileDayView({
  selected,
  ctx,
  loading = false,
  stickyPx,
  onPrev,
  onNext,
  onTapEvent,
  onTapTask,
}: {
  selected: Date;
  ctx: DayCtx;
  loading?: boolean;
  /** Height of the sticky chrome above, so "park the now line" clears it. */
  stickyPx: number;
  onPrev: () => void;
  onNext: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
}) {
  const plan = useMemo(() => buildDayPlan(selected, ctx), [selected, ctx]);
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

  // Opening on today mid-day: park the now line in the upper third, once. Any
  // later traversal keeps whatever scroll you're at (time stays aligned).
  //
  // Deferred a frame on purpose: `CalendarSurface` resets the scroller to the
  // top on a horizon change, and a parent layout effect runs AFTER a child's —
  // so parking "now" has to happen after that reset or it gets undone.
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const didAutoScroll = useRef(false);
  useLayoutEffect(() => {
    if (didAutoScroll.current) return;
    didAutoScroll.current = true;
    if (!plan.isToday || nowMin < winStart + 90) return;
    const raf = requestAnimationFrame(() => {
      const scroller = scrollParent(rootRef.current);
      const canvas = canvasRef.current;
      if (!scroller || !canvas) return;
      const canvasTop =
        canvas.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const target = canvasTop + y(Math.min(nowMin, winEnd)) - stickyPx - 100;
      if (target > 8) scroller.scrollTo({ top: target });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itemArea = `calc(100% - ${CAL_GUTTER}px)`;

  return (
    <div ref={rootRef}>
      {/* The day itself — TimePager walks a day at a time. Vertical scroll
          stays native (touch-pan-y); iOS back still owns the left-edge strip. */}
      <TimePager pageKey={dayKey(selected)} onPrev={onPrev} onNext={onNext}>
        {/* Don't claim a day is open before the calendar has answered. */}
        {loading && plan.timed.length === 0 && plan.allDay.length === 0 && plan.anytime.length === 0 ? (
          <div className="px-4 py-10 text-center text-body text-muted">Reading your calendar…</div>
        ) : (
          <div>
            {/* On this day, at no particular time — somebody else's all-day
                event (neutral) and your own anytime work (accent) in ONE row.
                They were two stacked bands for a distinction the chip's colour
                already carries. */}
            {(plan.allDay.length > 0 || plan.anytime.length > 0) && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-1 pt-2">
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
                    className="tap-h fast mono rounded-md border border-line bg-surface-2 px-2 py-1 text-label text-muted active:bg-surface"
                  >
                    {e.title || "Busy"}
                  </button>
                ))}
                {plan.anytime.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onTapTask?.(t.id)}
                    className="tap-h fast rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-label font-medium text-accent active:bg-accent/15"
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            )}

            {plan.isBygone &&
              plan.timed.length === 0 &&
              plan.allDay.length === 0 &&
              plan.anytime.length === 0 && (
                <div className="px-4 pt-3 text-body text-muted">Nothing scheduled.</div>
              )}

            {/* The canvas — transparent on the paper; hairline hour rules carry
                the structure. A bygone day reads as history, quieter. */}
            <div
              ref={canvasRef}
              className={`relative mx-2 mb-8 mt-2 ${plan.isBygone ? "opacity-70" : ""}`}
              style={{ height: y(winEnd) + 14 }}
            >
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
                      style={{ top: y(gs), height: h, left: CAL_GUTTER + 2 }}
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
                const tap = tapFor(b) as CalendarTap;
                return (
                  <button
                    key={i}
                    onClick={() => onTapEvent?.(tap)}
                    className="fast absolute rounded-md border text-left after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] active:opacity-80"
                    style={{
                      top: y(l.startMin),
                      height,
                      left: `calc(${CAL_GUTTER + 2}px + (${itemArea} - 2px) * ${l.col / l.cols})`,
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
                      className={`h-full min-w-0 overflow-hidden rounded-[5px] ${
                        isBlock || isSlot ? "pl-2.5" : "pl-2"
                      } pr-1.5 ${compact ? "flex items-center gap-1.5" : "py-1"}`}
                    >
                      {/* The block says what it IS, in words — the same
                          designation the desktop grid and Plan the week print
                          over a sitting (`blockDesignation`). The phone had the
                          desk's `▸`, which is a glyph you have to be taught; a
                          tall enough sitting gets the eyebrow, a short one keeps
                          the mark. */}
                      {isProjectSlot && !compact && (
                        <div
                          className="truncate text-micro font-semibold uppercase leading-none"
                          style={{ color: "var(--slot)", letterSpacing: "0.06em" }}
                        >
                          {blockDesignation({ kind: "project" })}
                        </div>
                      )}
                      <div
                        className={`flex min-w-0 items-center gap-1 ${
                          isProjectSlot && !compact ? "mt-[3px]" : ""
                        }`}
                      >
                        <div
                          className={`min-w-0 truncate ${compact ? "text-meta" : "text-label"} font-medium ${
                            b.done ? "text-muted line-through" : "text-ink"
                          }`}
                        >
                          {b.projectBacked && !(isProjectSlot && !compact)
                            ? `▸ ${b.title || "Untitled"}`
                            : b.title || "Untitled"}
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
                      {/* Where — and ONLY where. This line used to lead with
                          `9:00 AM–9:30 AM`, on a canvas whose entire premise is
                          that a commitment's top edge is its start and its
                          height is its length, one hour rule away from a gutter
                          already labelled `9am`. So it restated the two facts
                          the geometry states best, in a second spelling, on
                          every block. The place a meeting happens is the one
                          thing the canvas cannot draw; exact minutes are a tap
                          away in the sheet. */}
                      {!compact && b.location && (
                        <div className="truncate text-micro text-muted">{b.location}</div>
                      )}
                      {showChildren && (
                        <div className="mt-1 flex min-h-0 flex-col gap-0.5 overflow-hidden">
                          {b.children!.slice(0, 3).map((c, ci) => (
                            <div key={ci} className="flex items-center gap-1.5 text-micro leading-tight">
                              <span
                                className="h-[3px] w-[3px] shrink-0 rounded-full"
                                style={{ background: c.done ? "var(--muted)" : "var(--slot)" }}
                              />
                              <span
                                className={`truncate ${c.done ? "text-muted line-through opacity-60" : "text-muted"}`}
                              >
                                {c.title}
                              </span>
                            </div>
                          ))}
                          {b.children!.length > 3 && (
                            <span className="pl-[9px] text-micro text-muted">
                              +{b.children!.length - 3} more
                            </span>
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
                  style={{ top: y(nowMin) - 1, left: CAL_GUTTER - 5, right: 0 }}
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
      </TimePager>
    </div>
  );
}
