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
//
// An empty-space tap claims that time (D-130) — Apple / Google / Akiflow all
// do this. The snap lives in `canvasTap.ts`. The ＋ is not a second door:
// the tap opens the one capture sheet, seeded. A wander past AXIS_SLOP_PX
// is a scroll or a page-swipe, never a create.

import { useLayoutEffect, useMemo, useRef } from "react";
import { isSameDay } from "date-fns";
import { fmtMins } from "../../lib/now";
import { DEFAULT_DURATION_MINUTES } from "../../lib/types";
import type { CalendarTap } from "./MobileEventSheet";
import { buildDayPlan, dayKey, layoutDay, scrollParent, span, tapFor, type DayCtx } from "./dayPlan";
import { CAL_EDGE, CAL_GUTTER, hourLabel } from "./CalendarChrome";
import TimePager from "./TimePager";
import { PlanRow, allDayTap, type ToggleTask } from "./planRows";
// One spelling for what a block IS — shared with the Schedule and the ritual.
import { blockDesignation } from "../../lib/slots";
import { DAY_HOUR_PX, dateAtMinutes, minutesFromCanvasY, TAP_SNAP_MINS } from "./canvasTap";
import { useCanvasPress } from "./useCanvasPress";

const HOUR_PX = DAY_HOUR_PX;
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
  onToggleTask,
  onTapEmpty,
  draft = null,
  defaultDurationMins = DEFAULT_DURATION_MINUTES,
  recenter = 0,
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
  /** Complete an anytime task from its row (D-111). */
  onToggleTask?: ToggleTask;
  /** Empty-space tap — claim this time. Opens the one capture door, seeded. */
  onTapEmpty?: (start: Date) => void;
  /** The slot capture is currently claiming, drawn as a ghost on this day. */
  draft?: { start: Date; durationMinutes: number } | null;
  defaultDurationMins?: number;
  /** Bumped when the user asks to come back to now (the chrome's Today).
   *  Re-parks the now line even though the automatic park already happened. */
  recenter?: number;
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
    // The once-only guard belongs to the *automatic* park on open. A bump of
    // `recenter` is a person tapping Today, which has to land every time.
    if (recenter === 0 && didAutoScroll.current) return;
    didAutoScroll.current = true;
    if (!plan.isToday || nowMin < winStart + 90) return;
    const raf = requestAnimationFrame(() => {
      const scroller = scrollParent(rootRef.current);
      const canvas = canvasRef.current;
      if (!scroller || !canvas) return;
      const canvasTop =
        canvas.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const target = canvasTop + y(Math.min(nowMin, winEnd)) - stickyPx - 100;
      if (target > 8) scroller.scrollTo({ top: target, behavior: recenter ? "smooth" : "auto" });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenter]);

  const itemArea = `calc(100% - ${CAL_GUTTER}px)`;

  // Press preview — the slot under the finger, dismissed the moment the
  // gesture becomes a scroll or a page-swipe. The parent `draft` is the
  // same ghost once capture is open (the press itself is already over).
  const { press, handlers: pressHandlers } = useCanvasPress({
    enabled: !!onTapEmpty,
    resolve: (clientX, clientY) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (clientX - rect.left < CAL_GUTTER) return null;
      return { col: 0, startMin: minutesFromCanvasY(clientY, rect.top, winStart, HOUR_PX, TAP_SNAP_MINS, winEnd) };
    },
    onTap: (p) => onTapEmpty?.(dateAtMinutes(selected, p.startMin)),
  });
  const draftMin =
    draft && isSameDay(draft.start, selected)
      ? draft.start.getHours() * 60 + draft.start.getMinutes()
      : null;
  const ghostMin = press?.startMin ?? draftMin;
  const ghostDur = draft?.durationMinutes ?? defaultDurationMins;

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
            {plan.allDay.map((e) => (
              <PlanRow
                key={e.id}
                time="all day"
                mark={{ kind: "bar", color: "var(--event-default)" }}
                title={e.title || "Busy"}
                onOpen={() => onTapEvent?.(allDayTap(e))}
              />
            ))}
            {plan.anytime.map((t) => (
              <PlanRow
                key={t.id}
                time="anytime"
                mark={{
                  kind: "check",
                  checked: false,
                  label: `Complete ${t.title}`,
                  onToggle: onToggleTask ? (next) => onToggleTask(t.id, next) : undefined,
                }}
                title={t.title}
                onOpen={() => onTapTask?.(t.id)}
              />
            ))}

            {plan.isBygone &&
              plan.timed.length === 0 &&
              plan.allDay.length === 0 &&
              plan.anytime.length === 0 && (
                <div className="ph-dayempty">Nothing scheduled</div>
              )}

            {/* The canvas — transparent on the paper; hairline hour rules carry
                the structure. A bygone day reads as history, quieter. */}
            <div
              ref={canvasRef}
              data-day-canvas
              className={`relative mb-8 mt-3 ${plan.isBygone ? "opacity-70" : ""}`}
              // The surface's one edge — see `CAL_EDGE`. The column this canvas
              // draws has to begin where the week row's lit cell does.
              style={{ height: y(winEnd) + 14, marginLeft: CAL_EDGE, marginRight: CAL_EDGE }}
              {...pressHandlers}
            >
              {hours.map((h) => (
                <div key={h} className="absolute inset-x-0" style={{ top: y(h * 60) }}>
                  <span className="ph-hour" style={{ width: CAL_GUTTER - 6 }}>
                    {hourLabel(h)}
                  </span>
                  <div className="ph-hour-rule" style={{ left: CAL_GUTTER }} />
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
                      <span className="ph-gap-bar" />
                      {h >= 22 && <span className="ph-gap-len">{fmtMins(g.mins)}</span>}
                    </div>
                  );
                })}

              {/* Commitments — events neutral, your blocks in the accent, drawn
                  at their true height. Overlaps share the width in columns. */}
              {laid.map((l, i) => {
                const b = l.item;
                const height = Math.max(y(l.endMin) - y(l.startMin), MIN_ITEM_PX);
                const compact = height < 34;
                const isSlot = b.kind === "slot";
                // Room to peek at what's inside, past the title/time/badge rows.
                const showChildren = isSlot && height > 58 && (b.children?.length ?? 0) > 0;
                const isProjectSlot = isSlot && b.projectBacked;
                const tap = tapFor(b) as CalendarTap;
                return (
                  <button
                    key={i}
                    data-cal-item
                    data-kind={b.kind}
                    data-done={b.done || undefined}
                    data-compact={compact || undefined}
                    onClick={() => onTapEvent?.(tap)}
                    className="ph-blk"
                    style={{
                      top: y(l.startMin),
                      height,
                      left: `calc(${CAL_GUTTER + 2}px + (${itemArea} - 2px) * ${l.col / l.cols})`,
                      width: `calc((${itemArea} - 2px) * ${1 / l.cols} - ${l.cols > 1 ? 2 : 0}px)`,
                    }}
                  >
                    <div className="ph-blk-body">
                      {/* The block says what it IS, in words — the same
                          designation the desktop grid and Plan the week print
                          over a sitting (`blockDesignation`). A tall enough
                          sitting gets it as a quiet first line. */}
                      {isProjectSlot && !compact && (
                        <div className="ph-blk-kind">{blockDesignation({ kind: "project" })}</div>
                      )}
                      <div className="flex min-w-0 items-center gap-1">
                        <div className="ph-blk-title">{b.title || "Untitled"}</div>
                        {isSlot && (b.childCount ?? 0) > 0 && (
                          <span className="ph-blk-count">
                            {b.doneCount}/{b.childCount}
                          </span>
                        )}
                      </div>
                      {/* Where — and ONLY where. The block's top edge is its
                          start and its height is its length, one hour rule
                          away from a gutter already labelled `9am`; the place a
                          meeting happens is the one thing the canvas cannot
                          draw. Exact minutes are a tap away in the sheet. */}
                      {!compact && b.location && <div className="ph-blk-where">{b.location}</div>}
                      {showChildren && (
                        <div className="mt-1 flex min-h-0 flex-col gap-0.5 overflow-hidden">
                          {b.children!.slice(0, 3).map((c, ci) => (
                            <div key={ci} className="ph-blk-child" data-done={c.done || undefined}>
                              {c.title}
                            </div>
                          ))}
                          {b.children!.length > 3 && (
                            <span className="ph-blk-where">{b.children!.length - 3} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Claimed gap — the press preview, then the seed while capture
                  is open. No title: they haven't named it yet. The span is
                  the one fact a finger already chose (D-122: a surface that
                  draws a time does not also write a second spelling). */}
              {ghostMin != null && (
                <div
                  data-day-draft
                  aria-hidden
                  className="ph-draft pointer-events-none absolute"
                  style={{
                    top: y(ghostMin),
                    height: Math.max((ghostDur * HOUR_PX) / 60, MIN_ITEM_PX),
                    left: CAL_GUTTER + 2,
                    right: 0,
                  }}
                >
                  {ghostDur * HOUR_PX >= 34 * 60 && (
                    <span className="ph-draft-span">
                      {span(dateAtMinutes(selected, ghostMin), dateAtMinutes(selected, ghostMin + ghostDur))}
                    </span>
                  )}
                </div>
              )}

              {/* Now — the one thing --signal is for. */}
              {plan.isToday && nowMin >= winStart && nowMin <= winEnd && (
                <div
                  className="pointer-events-none absolute z-10"
                  style={{ top: y(nowMin) - 1, left: CAL_GUTTER - 5, right: 0 }}
                >
                  {/* `now-wake`: the same static wake the desktop's now-line
                      draws (D-187) — which way time is moving, not a pulse. */}
                  <div className="now-wake relative h-[2px] rounded-full" style={{ background: "var(--signal)" }}>
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
