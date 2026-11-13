// The Agenda body — an availability list that opens ON its anchor day (today by
// default): the anchor is the first row, so the list simply starts at the top on
// it, with no scroll math and nothing to race on first load. Forward runs a
// 14-day horizon; the past is revealed upward on demand via "Earlier days".
//
// Body only. The hero ("Agenda", and the span it covers), the horizon ladder,
// travel and the week row live in `CalendarChrome`. This used to carry its own
// sticky back-header AND its own 14-chip date strip, which is two of the four
// bands that reshuffled every time you changed horizon; the week row above
// re-anchors the list now, and the hero is the date picker.
//
// Extracted from `MobileCalendar` when the chrome was lifted out of the lenses.

import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { addDays, startOfDay } from "date-fns";
import { Button } from "../kit";
import { Icon } from "../Icon";
import type { CalendarTap } from "./MobileEventSheet";
import { buildDayPlan, dayKey, dayReadout, scrollParent, type DayCtx, type DayPlan } from "./dayPlan";
import { OpenWindows, PlanRow, TimedRow, allDayTap, type ToggleTask } from "./planRows";

/** How many days forward the agenda runs from its anchor. Exported because the
 *  chrome names the span in the hero and the data wrapper has to fetch it — one
 *  number, owned by the body that draws it. */
export const AGENDA_DAYS = 14;

export default function MobileAgendaView({
  anchor,
  ctx,
  loading,
  stickyPx,
  pastDays,
  onLoadEarlier,
  onTapEvent,
  onTapTask,
  onToggleTask,
}: {
  anchor: Date;
  ctx: DayCtx;
  loading: boolean;
  /** Height of the sticky chrome above, so a day header parks under it. */
  stickyPx: number;
  pastDays: number;
  onLoadEarlier: () => void;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
  /** Complete a task from its row — an act lives everywhere (D-111). */
  onToggleTask?: ToggleTask;
}) {
  const days = useMemo<DayPlan[]>(() => {
    const start = addDays(startOfDay(anchor), -pastDays);
    const total = pastDays + AGENDA_DAYS;
    return Array.from({ length: total }, (_, i) => buildDayPlan(addDays(start, i), ctx));
  }, [anchor, pastDays, ctx]);

  const rootRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Record<string, HTMLElement | null>>({});
  // Stable ref callbacks per day key — DayCard is memoized (it was the single
  // most expensive component in the app), and an inline closure here would hand
  // every card a fresh prop each render, defeating the memo.
  const dayRefFns = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const innerRefFor = (key: string) => {
    let fn = dayRefFns.current.get(key);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        dayRefs.current[key] = el;
      };
      dayRefFns.current.set(key, fn);
    }
    return fn;
  };

  // ── Revealing history (WebKit has no `overflow-anchor`) ──────────────────
  // The list opens on the anchor day as the first row, so first-load needs no
  // scroll math. The only scroll we manage by hand is the "earlier" prepend:
  // when we add days *above* the current top, we hold that prior top day at its
  // place so the new days arrive above the fold instead of yanking the list
  // down. We keep the hold for a beat because freshly-fetched days fill in
  // their heights asynchronously; the user's first scroll gesture releases it so
  // we never fight a real drag.
  const hold = useRef<{ key: string; offset: number } | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const releaseHold = () => {
    hold.current = null;
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
  };

  useLayoutEffect(() => {
    const h = hold.current;
    if (!h) return;
    const scroller = scrollParent(rootRef.current);
    const el = dayRefs.current[h.key];
    if (!scroller || !el) return;
    const cur = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const delta = cur - h.offset;
    if (Math.abs(delta) > 1) scroller.scrollTop += delta;
    // Debounced release: every height change (fetched days filling in) pushes
    // the release out, so we let go only after ~1s of layout quiet.
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      hold.current = null;
    }, 1000);
  }, [days, loading]);

  // A real scroll gesture ends the hold immediately. (Programmatic scrollTop
  // writes fire only `scroll`, which we don't listen for, so it can't
  // self-cancel.)
  useEffect(() => {
    const scroller = scrollParent(rootRef.current);
    if (!scroller) return;
    const events = ["wheel", "touchstart", "pointerdown", "keydown"];
    for (const e of events) scroller.addEventListener(e, releaseHold, { passive: true });
    return () => {
      for (const e of events) scroller.removeEventListener(e, releaseHold);
    };
  }, []);

  // Reveal more history. Park the newly-loaded block's most-recent day just
  // under the sticky chrome — so the tap visibly surfaces recent history (that
  // day at the top, older days above it, today below), and the hold keeps it
  // there while the fetched days fill in their heights.
  const loadEarlier = () => {
    if (days.length) hold.current = { key: dayKey(addDays(days[0].date, -1)), offset: stickyPx };
    onLoadEarlier();
  };

  const empty = days.every((d) => d.timed.length === 0 && d.allDay.length === 0 && d.anytime.length === 0);

  return (
    <div ref={rootRef}>
      {loading && empty ? (
        <div className="ph-empty">Reading your calendar…</div>
      ) : (
        // overflow-anchor: none so the one scroll-anchoring authority is our
        // manual pin. Chromium would otherwise also shift scrollTop on prepend
        // (double-correcting); WebKit — the real iOS/Tauri target — has no
        // native anchoring at all. Opting out makes both engines identical.
        <div style={{ overflowAnchor: "none" }}>
          {/* Reach further back — the top of history. */}
          <div className="flex justify-center pt-2">
            <Button kind="ghost" size="md" className="tap-h" icon={<Icon name="chevron-down" size={14} className="rotate-180" />} onClick={loadEarlier}>
              Earlier days
            </Button>
          </div>
          {days.map((d) => (
            <DayCard
              key={dayKey(d.date)}
              day={d}
              innerRef={innerRefFor(dayKey(d.date))}
              stickyPx={stickyPx}
              onTapEvent={onTapEvent}
              onTapTask={onTapTask}
              onToggleTask={onToggleTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One day: a header with its free/busy read, the day's commitments as rows,
// and — the point of this whole view — its open windows spelled out so you can
// answer on the spot. Memoized: 21 of these render per agenda, and the audit
// measured this as the single most expensive component anywhere in the app — a
// parent re-render with unchanged plans must not re-render every card.
const DayCard = memo(function DayCard({
  day,
  innerRef,
  stickyPx,
  onTapEvent,
  onTapTask,
  onToggleTask,
}: {
  day: DayPlan;
  innerRef: (el: HTMLElement | null) => void;
  stickyPx: number;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
  onToggleTask?: ToggleTask;
}) {
  const { date, isToday, label, allDay, anytime, timed, gaps, isPast, isBygone } = day;
  const fullyOpen = timed.length === 0 && allDay.length === 0 && anytime.length === 0;

  // A past date is a record of what happened, not an availability question —
  // its readout counts commitments and it never advertises open windows.
  const { text: readout, accent: readoutAccent } = dayReadout(day);

  return (
    <section ref={innerRef} style={{ scrollMarginTop: stickyPx }}>
      <div className="ph-dayhead">
        <span className="ph-dayhead-label" data-today={isToday || undefined} data-past={isBygone || undefined}>
          {label}
        </span>
        <span className="ph-dayhead-date">{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span>
        {readout && (
          <span className="ph-dayhead-read" data-accent={readoutAccent || undefined}>
            {readout}
          </span>
        )}
      </div>

      {/* On this day at no particular time: someone else's all-day event wears
          its bar, your own anytime task its check — one list, the kinds told
          apart by the mark rather than by a band of chrome each. */}
      {allDay.map((e) => (
        <PlanRow
          key={e.id}
          time="all day"
          mark={{ kind: "bar", color: "var(--event-default)" }}
          title={e.title || "Busy"}
          onOpen={() => onTapEvent?.(allDayTap(e))}
        />
      ))}
      {anytime.map((t) => (
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
      {timed.map((b, i) => (
        <TimedRow key={i} item={b} onTapEvent={onTapEvent} onToggleTask={onToggleTask} />
      ))}

      {/* Open windows — the availability answer. A bygone day is history, so we
          don't offer to fill windows that have already elapsed. */}
      {!isPast && !isBygone && <OpenWindows gaps={gaps} />}

      {fullyOpen && !isPast && (isBygone || gaps.length === 0) && (
        <div className="ph-dayempty">{isBygone ? "Nothing scheduled" : "Wide open"}</div>
      )}
    </section>
  );
});
