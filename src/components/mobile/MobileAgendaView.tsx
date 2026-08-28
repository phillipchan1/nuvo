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
import { blockDesignation } from "../../lib/slots";
import { fmtMins } from "../../lib/now";
import type { CalendarTap } from "./MobileEventSheet";
import { TIME_RAIL } from "./CalendarChrome";
import { at, buildDayPlan, dayKey, dayReadout, scrollParent, span, type DayCtx, type DayPlan } from "./dayPlan";

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
        <div className="px-4 py-10 text-center text-body text-muted">Reading your calendar…</div>
      ) : (
        // overflow-anchor: none so the one scroll-anchoring authority is our
        // manual pin. Chromium would otherwise also shift scrollTop on prepend
        // (double-correcting); WebKit — the real iOS/Tauri target — has no
        // native anchoring at all. Opting out makes both engines identical.
        <div className="divide-y divide-line" style={{ overflowAnchor: "none" }}>
          {/* Reach further back — the top of history. */}
          <button
            onClick={loadEarlier}
            className="tap fast flex w-full items-center justify-center gap-1.5 py-3.5 text-label font-medium text-muted active:bg-surface-2"
          >
            <span className="text-body leading-none">↑</span>
            Earlier days
          </button>
          {days.map((d) => (
            <DayCard
              key={dayKey(d.date)}
              day={d}
              innerRef={innerRefFor(dayKey(d.date))}
              stickyPx={stickyPx}
              onTapEvent={onTapEvent}
              onTapTask={onTapTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One day: header with a free/busy read, the day's events, and — the point of
// this whole view — its open windows spelled out so you can answer on the spot.
// Memoized: 21 of these render per agenda, and the audit measured this as the
// single most expensive component anywhere in the app — a parent re-render with
// unchanged plans must not re-render every card.
const DayCard = memo(function DayCard({
  day,
  innerRef,
  stickyPx,
  onTapEvent,
  onTapTask,
}: {
  day: DayPlan;
  innerRef: (el: HTMLElement | null) => void;
  stickyPx: number;
  onTapEvent?: (tap: CalendarTap) => void;
  onTapTask?: (taskId: string) => void;
}) {
  const { date, isToday, label, allDay, anytime, timed, gaps, isPast, isBygone } = day;
  const fullyOpen = timed.length === 0 && allDay.length === 0 && anytime.length === 0;

  // A past date is a record of what happened, not an availability question —
  // its readout counts commitments and it never advertises open windows.
  const { text: readout, accent: readoutAccent } = dayReadout(day);

  return (
    <section ref={innerRef} className="px-4 py-3.5" style={{ scrollMarginTop: stickyPx }}>
      {/* Day header */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className={`text-head font-semibold ${isToday ? "text-accent" : isBygone ? "text-muted" : "text-ink"}`}>
            {label}
          </span>
          <span className="mono text-label text-muted">
            {date.toLocaleDateString([], { month: "short", day: "numeric" })}
          </span>
        </div>
        {readout && (
          <span className="mono text-label" style={{ color: readoutAccent ? "var(--accent)" : "var(--muted)" }}>
            {readout}
          </span>
        )}
      </div>

      {/* All-day banners and anytime chips share one row — both are "on this
          day, at no particular time", and two stacked chip rows was one band of
          chrome per kind for a distinction the chip's own colour already
          carries (neutral is somebody else's event, accent is your work). */}
      {(allDay.length > 0 || anytime.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {allDay.map((e) => (
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
          {anytime.map((t) => (
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

      {/* Timed commitments */}
      {timed.length > 0 && (
        <div className="space-y-1.5">
          {timed.map((b, i) => {
            const isSlot = b.kind === "slot";
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
                  ? {
                      kind: "slot",
                      slot: b.slot!,
                      title: b.title || "Untitled",
                      start: b.start,
                      end: b.end,
                      childCount: b.childCount ?? 0,
                      doneCount: b.doneCount ?? 0,
                    }
                  : { kind: "block", taskId: b.taskId!, title: b.title || "Untitled", start: b.start, end: b.end, done: !!b.done };
            const markColor = isSlot ? "var(--slot)" : b.kind === "block" ? "var(--accent)" : "var(--line-strong)";
            // A slot is a container, not a single commitment — it gets the same
            // dashed teal wash the Day lens draws for it, so tasks riding
            // inside one don't read as a bare timestamped row.
            return (
              <button
                key={i}
                onClick={() => onTapEvent?.(tap)}
                className={`tap fast -mx-1 flex w-full items-baseline gap-2.5 rounded-lg px-1 text-left active:bg-surface-2 ${
                  isSlot ? "border py-1" : ""
                }`}
                style={
                  isSlot
                    ? {
                        background: "color-mix(in srgb, var(--slot) 14%, transparent)",
                        borderColor: "color-mix(in srgb, var(--slot) 45%, var(--line))",
                        borderStyle: "dashed",
                      }
                    : undefined
                }
              >
                <span
                  className="mono shrink-0 text-right text-meta"
                  style={{ color: markColor, width: TIME_RAIL }}
                >
                  {at(b.start)}
                </span>
                <span
                  className={`mt-[5px] shrink-0 self-start ${
                    isSlot || b.projectBacked ? "h-2 w-2 rounded-[2px]" : "h-1.5 w-1.5 rounded-full"
                  }`}
                  style={{ background: markColor }}
                />
                <div className="min-w-0 flex-1">
                  {/* A sitting held for a project says so, in the same words the
                      Schedule and Plan the week use (`blockDesignation`) — the
                      `▸` it wore is a glyph you'd have to be taught. */}
                  {isSlot && b.projectBacked && (
                    <div
                      className="truncate text-micro font-semibold uppercase leading-none"
                      style={{ color: "var(--slot)", letterSpacing: "0.06em" }}
                    >
                      {blockDesignation({ kind: "project" })}
                    </div>
                  )}
                  <div className={`flex min-w-0 items-center gap-1.5 ${isSlot && b.projectBacked ? "mt-[3px]" : ""}`}>
                    <div className={`min-w-0 truncate text-body ${b.done ? "text-muted line-through" : "text-ink"}`}>
                      {b.projectBacked && !isSlot ? `▸ ${b.title || "Untitled"}` : b.title || "Untitled"}
                    </div>
                    {isSlot && (b.childCount ?? 0) > 0 && (
                      <span
                        className="mono ml-auto shrink-0 rounded-full px-1.5 text-micro leading-snug text-muted"
                        style={{ background: "var(--bg)" }}
                      >
                        {b.doneCount}/{b.childCount}
                      </span>
                    )}
                  </div>
                  {/* How long, and where. The rail to the left already said
                      WHEN, and this line used to open by saying it again —
                      `9am` in the column, `9–9:30am` two centimetres right of
                      it, on every row of a two-week list. So it keeps the half
                      the rail can't carry: the length, in the same words the
                      day's open time is counted in (`fmtMins`), and the place. */}
                  <div className="mono text-meta text-muted">
                    {fmtMins(Math.max(1, Math.round((b.end.getTime() - b.start.getTime()) / 60_000)))}
                    {b.location ? ` · ${b.location}` : ""}
                  </div>
                  {isSlot && (b.children?.length ?? 0) > 0 && (
                    <div className="mt-0.5 truncate text-meta text-muted">
                      {b.children!.map((c) => c.title).join(" · ")}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Open windows — the availability answer. A bygone day is history, so we
          don't offer to fill windows that have already elapsed. */}
      {!isPast && !isBygone && gaps.length > 0 && (
        <div className={timed.length > 0 || allDay.length > 0 || anytime.length > 0 ? "mt-3" : ""}>
          {!fullyOpen && <div className="section-label mb-1.5 !p-0">Free</div>}
          <div className="flex flex-wrap gap-1.5">
            {gaps.map((g, i) => (
              <span
                key={i}
                className="rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-label font-medium text-accent"
              >
                {span(g.start, g.end)} · {fmtMins(g.mins)}
              </span>
            ))}
          </div>
        </div>
      )}

      {fullyOpen && !isPast && (isBygone || gaps.length === 0) && (
        <div className="text-body text-muted">{isBygone ? "Nothing scheduled." : "No commitments — wide open."}</div>
      )}
    </section>
  );
});
