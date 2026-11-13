// A day's commitments as rows — the agenda's and the month preview's one shape.
//
// The two lists answer the same question a tap apart (the month preview is the
// agenda for one day), so they draw it with the same row: 48px on a hairline,
// the clock in a 48px tabular gutter, then a 20px TaskCheck for your own work
// or a 3px identity bar for someone else's time (an event, a slot), the title
// at 15/500, and one quiet fact at the end (styles/phone.css, `ph-row`).
//
// The row says only what its neighbour can't (D-122): the gutter says WHEN, so
// the meta says HOW LONG. The exact minutes live in the record sheet.

import type { ReactNode } from "react";
import { TaskCheck } from "../kit";
import { fmtMins } from "../../lib/now";
import { blockDesignation } from "../../lib/slots";
import type { ExternalEvent } from "../../lib/types";
import type { CalendarTap } from "./MobileEventSheet";
import { at, span, tapFor as tapForLike, type DayPlan, type TimedItem } from "./dayPlan";

/** What a tap on a timed item opens — `dayPlan`'s one builder, typed for the sheet. */
const tapFor = (b: TimedItem) => tapForLike(b) as CalendarTap;

/** An all-day event's tap. */
export function allDayTap(e: ExternalEvent): CalendarTap {
  return {
    kind: "event",
    id: e.id,
    providerEventId: e.provider_event_id,
    title: e.title || "Busy",
    start: new Date(e.start_at),
    end: new Date(e.end_at),
    allDay: true,
    location: e.location,
    self_rsvp: e.self_rsvp ?? null,
    accountId: e.account_id,
    calendarId: e.calendar_id,
  };
}

/** Complete / reopen a task from a list row — the act lives everywhere (D-111). */
export type ToggleTask = (taskId: string, done: boolean) => void;

type Mark =
  | { kind: "check"; checked: boolean; label: string; onToggle?: (next: boolean) => void }
  | { kind: "bar"; color: string };

/** One commitment: gutter · mark · title · meta. */
export function PlanRow({
  time,
  timeTone,
  mark,
  title,
  aside,
  meta,
  done,
  onOpen,
}: {
  time: string;
  /** `now` lights the clock (an all-day / anytime word stays faint). */
  timeTone?: "faint" | "muted";
  mark: Mark;
  title: string;
  /** Quiet words after the title, on the same line — the place. */
  aside?: string | null;
  meta?: ReactNode;
  done?: boolean;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <span className="ph-row-time" style={timeTone === "muted" ? { color: "var(--muted)" } : undefined}>
        {time}
      </span>
      {mark.kind === "check" ? (
        <span className="ph-row-lead" onClick={(e) => e.stopPropagation()}>
          <TaskCheck
            size="lg"
            checked={mark.checked}
            label={mark.label}
            onChange={(next) => mark.onToggle?.(next)}
            disabled={!mark.onToggle}
          />
        </span>
      ) : (
        <span className="ph-row-lead" aria-hidden>
          <span className="ph-idbar" style={{ ["--h" as string]: mark.color }} />
        </span>
      )}
      <span className="ph-row-title">
        {title}
        {aside && <span className="ph-row-aside"> · {aside}</span>}
      </span>
      {meta != null && <span className="ph-row-meta">{meta}</span>}
    </>
  );
  // A row with a live check is a cell holding a control, so it can't itself be
  // a <button>: it answers taps and Enter the way the kit's Row does.
  if (mark.kind === "check") {
    return (
      <div
        role="button"
        tabIndex={0}
        className="ph-row row-hover"
        data-done={done || undefined}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onOpen?.();
          }
        }}
      >
        {inner}
      </div>
    );
  }
  return (
    <button type="button" className="ph-row row-hover" data-done={done || undefined} onClick={onOpen}>
      {inner}
    </button>
  );
}

const minutes = (b: TimedItem) => Math.max(1, Math.round((b.end.getTime() - b.start.getTime()) / 60_000));

/** A timed item as a row — a block (your task) checks; an event or a slot is
 *  someone else's time, or a container, and wears its bar. */
export function TimedRow({
  item: b,
  onTapEvent,
  onToggleTask,
}: {
  item: TimedItem;
  onTapEvent?: (tap: CalendarTap) => void;
  onToggleTask?: ToggleTask;
}) {
  const open = () => onTapEvent?.(tapFor(b));
  if (b.kind === "block") {
    return (
      <PlanRow
        time={at(b.start)}
        mark={{
          kind: "check",
          checked: !!b.done,
          label: b.done ? `Reopen ${b.title || "task"}` : `Complete ${b.title || "task"}`,
          onToggle: onToggleTask && b.taskId ? (next) => onToggleTask(b.taskId!, next) : undefined,
        }}
        title={b.title || "Untitled"}
        aside={b.location}
        meta={fmtMins(minutes(b))}
        done={b.done}
        onOpen={open}
      />
    );
  }
  if (b.kind === "slot") {
    const n = b.childCount ?? 0;
    return (
      <PlanRow
        time={at(b.start)}
        mark={{ kind: "bar", color: "var(--slot)" }}
        // A sitting held for a project says so, in the same words the Schedule
        // and Plan the week use (`blockDesignation`).
        title={b.title || "Untitled"}
        aside={b.projectBacked ? blockDesignation({ kind: "project" }) : null}
        meta={n > 0 ? `${b.doneCount ?? 0}/${n}` : fmtMins(minutes(b))}
        onOpen={open}
      />
    );
  }
  return (
    <PlanRow
      time={at(b.start)}
      mark={{ kind: "bar", color: "var(--event-default)" }}
      title={b.title || "Untitled"}
      aside={b.location}
      meta={fmtMins(minutes(b))}
      done={b.done}
      onOpen={open}
    />
  );
}

/** The day's open windows — the availability answer, in the open-time colour. */
export function OpenWindows({ gaps }: { gaps: DayPlan["gaps"] }) {
  if (gaps.length === 0) return null;
  return (
    <div className="ph-open-row">
      <span className="ph-row-time">open</span>
      <div className="ph-open-list">
        {gaps.map((g, i) => (
          <span key={i} className="ph-open">
            {span(g.start, g.end)}
            <span className="ph-open-len">{fmtMins(g.mins)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
