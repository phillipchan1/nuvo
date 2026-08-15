// The desktop Agenda — the Schedule's list lens.
//
// The audit's rank-10 finding was that view coverage was split across shells:
// the phone had an agenda and no week grid, the desktop had a week grid and no
// agenda. This is the desktop half, and the important thing about it is what it
// does NOT do: it computes nothing. Every day it draws comes from the same
// `buildDayPlan()` the phone's List lens, Day lens and month density already
// read, so "what counts as busy" and "what is open" still live in exactly one
// place (dayPlan.ts → readDay / toBusyBlocks). A second derivation here is how
// the two shells would start disagreeing about the same Tuesday.
//
// What an agenda is FOR, in a planner: answering "what is actually coming" in
// one scroll, with the open windows shown alongside the commitments — the grid
// answers "when", the agenda answers "what and how much room is left".

import { memo, useMemo, useRef } from "react";
import { addDays, format, startOfDay } from "date-fns";
import { fmtMins } from "../lib/now";
import { Icon } from "./Icon";
// dayPlan.ts is shell-neutral (pure TS, no JSX) — it lives under mobile/ only
// because that is where it was extracted from. Importing it is the point: the
// alternative is a desktop copy of the day read, which is the bug this fixes.
import { at, buildDayPlan, dayKey, dayReadout, type DayCtx, type DayPlan, type TimedItem } from "./mobile/dayPlan";

/** Days shown ahead of the anchor. Two weeks is the phone's horizon too. */
export const AGENDA_HORIZON_DAYS = 14;
/** How much history one "Earlier" click reveals. */
export const AGENDA_PAST_STEP = 7;

export interface AgendaOpen {
  (item: TimedItem, rect: DOMRect, el: HTMLElement | null): void;
}

// ── one day ────────────────────────────────────────────────────────────────

const DayRow = memo(function DayRow({
  day,
  onOpen,
  onNewOnDay,
}: {
  day: DayPlan;
  onOpen: AgendaOpen;
  onNewOnDay?: (d: Date) => void;
}) {
  const { date, isToday, label, allDay, timed, gaps, isPast, isBygone } = day;
  const fullyOpen = timed.length === 0 && allDay.length === 0;
  const { text: readout, accent: readoutAccent } = dayReadout(day);

  return (
    // Dissolve, don't frame: a hairline between days on the warm-paper canvas,
    // never a card. Today is the one row allowed to carry the signal.
    <section
      data-agenda-day={dayKey(date)}
      className="scroll-mt-2 border-b border-line px-4 py-3 last:border-b-0"
      style={isToday ? { boxShadow: "inset 2px 0 0 var(--signal)" } : undefined}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-body font-semibold ${isToday ? "text-signal" : isBygone ? "text-muted" : "text-ink"}`}
          >
            {label}
          </span>
          <span className="mono text-label text-muted">{format(date, "EEE MMM d")}</span>
        </div>
        <div className="flex items-baseline gap-2">
          {readout && (
            <span className="mono text-label" style={{ color: readoutAccent ? "var(--accent)" : "var(--muted)" }}>
              {readout}
            </span>
          )}
          {onNewOnDay && !isBygone && (
            <button
              onClick={() => onNewOnDay(date)}
              title={`New event on ${format(date, "EEE MMM d")}`}
              className="fast flex h-5 w-5 items-center justify-center rounded text-muted opacity-0 hover:bg-bg hover:text-ink group-hover:opacity-100 [section:hover_&]:opacity-100"
            >
              <Icon name="plus" size={12} />
            </button>
          )}
        </div>
      </div>

      {allDay.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {allDay.map((e) => (
            <button
              key={e.id}
              onClick={(ev) =>
                onOpen(
                  {
                    title: e.title || "Busy",
                    start: new Date(e.start_at),
                    end: new Date(e.end_at),
                    kind: "event",
                    eventId: e.id,
                    accountId: e.account_id,
                    calendarId: e.calendar_id,
                    self_rsvp: e.self_rsvp ?? null,
                  },
                  ev.currentTarget.getBoundingClientRect(),
                  ev.currentTarget,
                )
              }
              className="fast mono rounded-md border border-line bg-surface-2 px-2 py-0.5 text-label text-muted hover:border-line-strong hover:text-ink"
            >
              {e.title || "Busy"}
            </button>
          ))}
        </div>
      )}

      {timed.length > 0 && (
        <div className="space-y-0.5">
          {timed.map((b, i) => {
            const isSlot = b.kind === "slot";
            const isBlock = b.kind === "block";
            const markColor = isSlot ? "var(--slot)" : isBlock ? "var(--accent)" : "var(--line-strong)";
            return (
              <button
                key={i}
                onClick={(ev) => onOpen(b, ev.currentTarget.getBoundingClientRect(), ev.currentTarget)}
                className={`fast -mx-1 flex w-full items-baseline gap-2.5 rounded-lg px-1 py-0.5 text-left hover:bg-surface-2 ${
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
                <span className="mono w-[76px] shrink-0 text-right text-meta" style={{ color: markColor }}>
                  {at(b.start)}
                </span>
                <span
                  className={`mt-[5px] shrink-0 self-start ${
                    isSlot || b.projectBacked ? "h-2 w-2 rounded-[2px]" : "h-1.5 w-1.5 rounded-full"
                  }`}
                  style={{ background: markColor }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={`min-w-0 truncate text-body ${b.done ? "text-muted line-through" : "text-ink"}`}>
                      {b.projectBacked ? `▸ ${b.title || "Untitled"}` : b.title || "Untitled"}
                    </span>
                    {isSlot && (b.childCount ?? 0) > 0 && (
                      <span
                        className="mono ml-auto shrink-0 rounded-full px-1.5 text-micro leading-snug text-muted"
                        style={{ background: "var(--bg)" }}
                      >
                        {b.doneCount}/{b.childCount}
                      </span>
                    )}
                  </div>
                  <div className="mono text-meta text-muted">
                    {at(b.start)}–{at(b.end)}
                    {b.location ? ` · ${b.location}` : ""}
                  </div>
                  {isSlot && (b.children?.length ?? 0) > 0 && (
                    <div className="truncate text-meta text-muted">
                      {b.children!.map((c) => c.title).join(" · ")}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Open windows — the half a plain agenda doesn't show. A bygone day is
          history, so we never offer to fill a window that already elapsed. */}
      {!isPast && !isBygone && gaps.length > 0 && (
        <div className={timed.length > 0 || allDay.length > 0 ? "mt-2" : ""}>
          {!fullyOpen && <div className="section-label mb-1 !p-0">Free</div>}
          <div className="flex flex-wrap gap-1.5">
            {gaps.map((g, i) => (
              <span
                key={i}
                className="rounded-md border border-accent/40 bg-accent-soft px-2 py-0.5 text-label font-medium text-accent"
              >
                {at(g.start)}–{at(g.end)} · {fmtMins(g.mins)}
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

// ── the lens ───────────────────────────────────────────────────────────────

export default function CalendarAgenda({
  anchor,
  pastDays,
  ctx,
  loading = false,
  onLoadEarlier,
  onOpen,
  onNewOnDay,
}: {
  /** The first day shown (before any revealed history). */
  anchor: Date;
  pastDays: number;
  ctx: DayCtx;
  loading?: boolean;
  onLoadEarlier: () => void;
  onOpen: AgendaOpen;
  onNewOnDay?: (d: Date) => void;
}) {
  const days = useMemo<DayPlan[]>(() => {
    const start = addDays(startOfDay(anchor), -pastDays);
    const total = pastDays + AGENDA_HORIZON_DAYS;
    return Array.from({ length: total }, (_, i) => buildDayPlan(addDays(start, i), ctx));
  }, [anchor, pastDays, ctx]);

  // Revealing history prepends above the fold. Hold the day that was on top so
  // the list doesn't yank — same problem the phone's List lens solves, and the
  // same fix, minus the WebKit scroll-anchor caveat (this scroller is ours).
  const scrollRef = useRef<HTMLDivElement>(null);
  const holdKey = useRef<string | null>(null);
  const loadEarlier = () => {
    const scroller = scrollRef.current;
    if (scroller && days.length) {
      holdKey.current = dayKey(days[0].date);
      const el = scroller.querySelector<HTMLElement>(`[data-agenda-day="${holdKey.current}"]`);
      const before = el ? el.getBoundingClientRect().top : 0;
      requestAnimationFrame(() => {
        const after = scroller.querySelector<HTMLElement>(`[data-agenda-day="${holdKey.current}"]`);
        if (after) scroller.scrollTop += after.getBoundingClientRect().top - before;
      });
    }
    onLoadEarlier();
  };

  const nothingYet = loading && days.every((d) => d.timed.length === 0 && d.allDay.length === 0);

  return (
    // Transparent — the one warm-paper gradient has to read continuously from
    // the spine through the rail to here. An opaque bg is the frost seam.
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[860px]">
        <div className="px-4 pt-2">
          <button
            onClick={loadEarlier}
            className="fast w-full rounded-lg border border-dashed border-line py-1.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
          >
            ↑ Earlier days
          </button>
        </div>
        {nothingYet ? (
          <div className="px-4 py-10 text-center text-body text-muted">Reading your calendar…</div>
        ) : (
          days.map((d) => (
            <DayRow key={dayKey(d.date)} day={d} onOpen={onOpen} onNewOnDay={onNewOnDay} />
          ))
        )}
      </div>
    </div>
  );
}
