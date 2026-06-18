import { useMemo, useRef } from "react";
import { useSettings } from "../../hooks/useSettings";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks } from "../../hooks/useTasks";
import { fmtMins, readDay, toBusyBlocks, type Gap } from "../../lib/now";
import type { ExternalEvent, Task } from "../../lib/types";

// The mobile Calendar — built to answer one question fast: "are you free on X?"
// A 14-day agenda where each day shows its commitments AND its open windows,
// computed by the same readDay() the Now view uses. Read-only for now.

const HORIZON_DAYS = 14;
const DAY_MS = 24 * 3600_000;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const at = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

interface DayPlan {
  date: Date;
  isToday: boolean;
  label: string; // "Today" / "Tomorrow" / weekday
  allDay: ExternalEvent[];
  timed: { title: string; start: Date; end: Date; kind: "event" | "block"; location?: string | null; done?: boolean }[];
  gaps: Gap[];
  openMins: number;
  isPast: boolean; // a fully-elapsed work window (today, after hours)
}

export default function MobileCalendar({ now }: { now: Date }) {
  const { settings } = useSettings();

  const today0 = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [dayKey(now)]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = useMemo(
    () => ({
      start: today0.toISOString(),
      end: new Date(today0.getTime() + HORIZON_DAYS * DAY_MS).toISOString(),
    }),
    [today0],
  );

  const { data: events = [], isLoading: evLoading } = useExternalEvents(range.start, range.end);
  const { data: blocks = [], isLoading: blkLoading } = useScheduledTasks(range.start, range.end);

  const hidden = useMemo(() => new Set(settings?.hidden_calendar_ids ?? []), [settings]);
  const workStart = settings?.work_start_minutes ?? 480;
  const workEnd = settings?.work_end_minutes ?? 990;

  const days = useMemo<DayPlan[]>(() => {
    const visibleEvents = events.filter((e) => !hidden.has(e.calendar_id));
    const out: DayPlan[] = [];
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const date = new Date(today0.getTime() + i * DAY_MS);
      const dStart = new Date(date);
      const dEnd = new Date(date.getTime() + DAY_MS);
      const isToday = i === 0;

      const allDay = visibleEvents.filter(
        (e) => e.all_day && new Date(e.start_at) < dEnd && new Date(e.end_at) > dStart,
      );

      // Timed events belonging to this day (by local start date), plus this
      // day's scheduled task blocks. Reuse toBusyBlocks for the busy math.
      const dayEvents = visibleEvents.filter((e) => !e.all_day && dayKey(new Date(e.start_at)) === dayKey(date));
      const dayBlocks = blocks.filter((t: Task) => t.start_time && dayKey(new Date(t.start_time)) === dayKey(date));
      const busy = toBusyBlocks(dayEvents, dayBlocks, hidden);

      // Work window for this day; on today, don't count time already elapsed.
      const ws = new Date(date);
      ws.setHours(0, workStart, 0, 0);
      const we = new Date(date);
      we.setHours(0, workEnd, 0, 0);
      const refNow = isToday ? new Date(Math.max(now.getTime(), ws.getTime())) : ws;
      const read = readDay(refNow, busy, ws, we);

      const timed = busy
        .map((b) => ({ title: b.title, start: b.start, end: b.end, kind: b.kind, location: b.location, done: b.done }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      out.push({
        date,
        isToday,
        label: isToday ? "Today" : i === 1 ? "Tomorrow" : date.toLocaleDateString([], { weekday: "long" }),
        allDay,
        timed,
        gaps: read.gaps,
        openMins: read.openMins,
        isPast: isToday && now.getTime() >= we.getTime(),
      });
    }
    return out;
  }, [events, blocks, hidden, today0, workStart, workEnd, now]);

  // Refs for the date-strip jump-to-day.
  const dayRefs = useRef<Record<string, HTMLElement | null>>({});
  const jumpTo = (key: string) => {
    dayRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const loading = evLoading || blkLoading;

  return (
    <div className="pb-24">
      {/* Date strip — tap a day to jump to it */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mobile-scroll flex gap-1.5 overflow-x-auto px-3 py-2.5">
          {days.map((d) => {
            const key = dayKey(d.date);
            const busyDay = d.timed.length > 0 || d.allDay.length > 0;
            return (
              <button
                key={key}
                onClick={() => jumpTo(key)}
                className={`tap fast flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border py-1.5 ${
                  d.isToday ? "border-accent bg-accent-soft" : "border-line"
                }`}
              >
                <span className={`text-micro font-medium uppercase ${d.isToday ? "text-accent" : "text-muted"}`}>
                  {d.date.toLocaleDateString([], { weekday: "short" }).slice(0, 2)}
                </span>
                <span className={`text-body font-semibold leading-none ${d.isToday ? "text-accent" : "text-ink"}`}>
                  {d.date.getDate()}
                </span>
                <span
                  className="h-1 w-1 rounded-full"
                  style={{ background: busyDay ? "var(--line-strong)" : "transparent" }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {loading && days.every((d) => d.timed.length === 0 && d.allDay.length === 0) ? (
        <div className="px-4 py-10 text-center text-body text-muted">Reading your calendar…</div>
      ) : (
        <div className="divide-y divide-line">
          {days.map((d) => (
            <DayCard
              key={dayKey(d.date)}
              day={d}
              innerRef={(el) => {
                dayRefs.current[dayKey(d.date)] = el;
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One day: header with a free/busy read, the day's events, and — the point of
// this whole view — its open windows spelled out so you can answer on the spot.
function DayCard({ day, innerRef }: { day: DayPlan; innerRef: (el: HTMLElement | null) => void }) {
  const { date, isToday, label, allDay, timed, gaps, openMins, isPast } = day;
  const fullyOpen = timed.length === 0 && allDay.length === 0;

  return (
    <section ref={innerRef} className="scroll-mt-14 px-4 py-3.5">
      {/* Day header */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className={`text-head font-semibold ${isToday ? "text-accent" : "text-ink"}`}>{label}</span>
          <span className="mono text-label text-muted">{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span>
        </div>
        <span className="mono text-label" style={{ color: openMins > 0 && !isPast ? "var(--accent)" : "var(--muted)" }}>
          {isPast ? "done for today" : openMins > 0 ? `${fmtMins(openMins)} open` : "fully booked"}
        </span>
      </div>

      {/* All-day banners */}
      {allDay.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {allDay.map((e) => (
            <span key={e.id} className="mono rounded-md border border-line bg-surface-2 px-2 py-0.5 text-label text-muted">
              {e.title || "Busy"}
            </span>
          ))}
        </div>
      )}

      {/* Timed commitments */}
      {timed.length > 0 && (
        <div className="space-y-1.5">
          {timed.map((b, i) => (
            <div key={i} className="flex items-baseline gap-2.5">
              <span
                className="mono w-[68px] shrink-0 text-right text-meta"
                style={{ color: b.kind === "block" ? "var(--accent)" : "var(--muted)" }}
              >
                {at(b.start)}
              </span>
              <span
                className="mt-[5px] h-1.5 w-1.5 shrink-0 self-start rounded-full"
                style={{ background: b.kind === "block" ? "var(--accent)" : "var(--line-strong)" }}
              />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-body ${b.done ? "text-muted line-through" : "text-ink"}`}>{b.title || "Untitled"}</div>
                <div className="mono text-meta text-muted">
                  {at(b.start)}–{at(b.end)}
                  {b.location ? ` · ${b.location}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Open windows — the availability answer */}
      {!isPast && gaps.length > 0 && (
        <div className={timed.length > 0 || allDay.length > 0 ? "mt-3" : ""}>
          {!fullyOpen && <div className="section-label mb-1.5 !p-0">Free</div>}
          <div className="flex flex-wrap gap-1.5">
            {gaps.map((g, i) => (
              <span
                key={i}
                className="rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-label font-medium text-accent"
              >
                {at(g.start)}–{at(g.end)} · {fmtMins(g.mins)}
              </span>
            ))}
          </div>
        </div>
      )}

      {fullyOpen && gaps.length === 0 && !isPast && (
        <div className="text-body text-muted">No commitments — wide open.</div>
      )}
    </section>
  );
}
