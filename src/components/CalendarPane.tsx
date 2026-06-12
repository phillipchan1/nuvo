import { format } from "date-fns";
import { useEffect, useMemo, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import type { EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { EventReceiveArg, EventResizeDoneArg, EventDragStopArg } from "@fullcalendar/interaction";
import type { CalendarAccount, ExternalEvent, Task, UserSettings } from "../lib/types";
import { DEFAULT_DURATION_MINUTES } from "../lib/types";
import { endOf, isOverdue } from "../lib/dates";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useExternalEventMutations } from "../hooks/useCalendar";

export type CalView = "timeGridWeek" | "timeGridDay";

export default function CalendarPane({
  view,
  tasks,
  events,
  accounts,
  settings,
  now,
  taskAccent,
  mutations,
  eventMutations,
  onOpenTask,
  onOpenEvent,
  onRangeChange,
  railRef,
}: {
  view: CalView;
  tasks: Task[];
  events: ExternalEvent[];
  accounts: CalendarAccount[];
  settings: UserSettings | undefined;
  now: Date;
  /** Domain color per task — blocks carry their thread up the vertical. */
  taskAccent: (t: Task) => string | null;
  mutations: ReturnType<typeof useTaskMutations>;
  eventMutations: ReturnType<typeof useExternalEventMutations>;
  onOpenTask: (t: Task) => void;
  onOpenEvent: (e: ExternalEvent) => void;
  onRangeChange: (startISO: string, endISO: string) => void;
  railRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const calRef = useRef<FullCalendar>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // External drag: any [data-task-drag] row in the left rail can be dropped
  // onto the grid. FullCalendar owns the drop geometry; we own the state.
  useEffect(() => {
    if (!railRef.current) return;
    const draggable = new Draggable(railRef.current, {
      itemSelector: "[data-task-drag]",
      eventData: (el) => ({
        title: el.getAttribute("data-task-title") ?? "task",
        duration: minutesToDuration(
          Number(el.getAttribute("data-task-duration")) || DEFAULT_DURATION_MINUTES,
        ),
        create: true,
      }),
    });
    return () => draggable.destroy();
  }, [railRef]);

  useEffect(() => {
    const api = calRef.current?.getApi();
    if (api && api.view.type !== view) api.changeView(view);
  }, [view]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const hidden = useMemo(
    () => new Set(settings?.hidden_calendar_ids ?? []),
    [settings],
  );

  const fcEvents = useMemo(() => {
    const taskEvents = tasks
      .filter((t) => t.start_time)
      .map((t) => {
        const overdue = t.status !== "done" && isOverdue(t, now);
        // domain tint (skipped while overdue — signal orange must win)
        const accent = overdue ? null : taskAccent(t);
        return {
          id: `task:${t.id}`,
          title: t.title,
          start: t.start_time!,
          end: endOf({ start_time: t.start_time!, duration_minutes: t.duration_minutes }).toISOString(),
          editable: true,
          classNames: [
            "evt-task",
            t.status === "done" ? "evt-done" : "",
            overdue ? "evt-overdue" : "",
          ].filter(Boolean),
          ...(accent
            ? {
                borderColor: accent,
                backgroundColor: `color-mix(in srgb, ${accent} 12%, var(--surface))`,
              }
            : {}),
          extendedProps: { kind: "task" as const, refId: t.id },
        };
      });

    const externalEvents = events
      .filter((e) => !hidden.has(e.calendar_id) && !e.all_day)
      .map((e) => {
        const account = accountById.get(e.account_id);
        const isGoogle = account?.provider === "google";
        const calColor =
          account?.calendars?.find((c) => c.id === e.calendar_id)?.color ?? "#7986cb";
        return {
          id: `evt:${e.id}`,
          title: e.title,
          start: e.start_at,
          end: e.end_at,
          editable: isGoogle,
          durationEditable: isGoogle,
          classNames: [isGoogle ? "evt-google" : "evt-m365"],
          backgroundColor: isGoogle
            ? `color-mix(in srgb, ${calColor} 10%, var(--surface))`
            : "transparent",
          borderColor: isGoogle
            ? `color-mix(in srgb, ${calColor} 30%, var(--line))`
            : undefined,
          extendedProps: { kind: isGoogle ? ("google" as const) : ("m365" as const), refId: e.id, calColor },
        };
      });

    return [...taskEvents, ...externalEvents];
  }, [tasks, events, hidden, accountById, now, taskAccent]);

  const findTask = (id: string) => tasksRef.current.find((t) => t.id === id);
  const findEvent = (id: string) => eventsRef.current.find((e) => e.id === id);

  const onReceive = (info: EventReceiveArg) => {
    const taskId = info.draggedEl.getAttribute("data-task-drag");
    const start = info.event.start;
    info.revert(); // state is the source of truth; the mutation re-renders the block
    const task = taskId ? findTask(taskId) : undefined;
    if (task && start) mutations.block(task, start);
  };

  const onDrop = (info: EventDropArg) => {
    const { kind, refId } = info.event.extendedProps as { kind: string; refId: string };
    if (kind === "task") {
      const task = findTask(refId);
      if (task && info.event.start) mutations.block(task, info.event.start);
    } else if (kind === "google") {
      const evt = findEvent(refId);
      if (evt && info.event.start && info.event.end) {
        eventMutations.updateEvent({
          id: refId,
          patch: { start_at: info.event.start.toISOString(), end_at: info.event.end.toISOString() },
        });
      }
    } else {
      info.revert(); // m365 is read-only
    }
  };

  const onResize = (info: EventResizeDoneArg) => {
    const { kind, refId } = info.event.extendedProps as { kind: string; refId: string };
    if (kind === "task") {
      const task = findTask(refId);
      if (task && info.event.start && info.event.end) {
        const mins = Math.round((info.event.end.getTime() - info.event.start.getTime()) / 60_000);
        mutations.patchTask(task.id, { duration_minutes: Math.max(15, mins) });
      }
    } else if (kind === "google") {
      if (info.event.start && info.event.end) {
        eventMutations.updateEvent({
          id: refId,
          patch: { start_at: info.event.start.toISOString(), end_at: info.event.end.toISOString() },
        });
      }
    } else {
      info.revert();
    }
  };

  // Drag a block back onto the left rail → unblock (keeps do_date)
  const onDragStop = (info: EventDragStopArg) => {
    const rail = railRef.current;
    if (!rail) return;
    const r = rail.getBoundingClientRect();
    const { clientX, clientY } = info.jsEvent;
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const { kind, refId } = info.event.extendedProps as { kind: string; refId: string };
      if (kind === "task") {
        const task = findTask(refId);
        if (task) mutations.unblock(task);
      }
    }
  };

  const onClick = (info: EventClickArg) => {
    const { kind, refId } = info.event.extendedProps as { kind: string; refId: string };
    if (kind === "task") {
      const task = findTask(refId);
      if (task) onOpenTask(task);
    } else {
      const evt = findEvent(refId);
      if (evt) onOpenEvent(evt);
    }
  };

  const renderEvent = (arg: EventContentArg) => {
    const { kind, refId, calColor } = arg.event.extendedProps as {
      kind: string;
      refId: string;
      calColor?: string;
    };
    if (kind !== "task") {
      const startMs = arg.event.start?.getTime() ?? 0;
      const endMs = arg.event.end?.getTime() ?? startMs + 3_600_000;
      const showTime = (endMs - startMs) / 60_000 > 29;
      return (
        <div className="flex h-full min-w-0 overflow-hidden">
          {calColor && (
            <div
              className="w-[3px] shrink-0 self-stretch rounded-l-[3px]"
              style={{ backgroundColor: calColor, opacity: kind === "m365" ? 0.5 : 1 }}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden px-1.5 py-px">
            <div className="truncate text-[11px] font-semibold leading-snug">{arg.event.title}</div>
            {showTime && (
              <div className="mono truncate text-[9.5px] leading-tight opacity-55">{arg.timeText}</div>
            )}
          </div>
        </div>
      );
    }
    const task = findTask(refId);
    const done = task?.status === "done";
    return (
      <div className="flex h-full min-w-0 items-start gap-1 overflow-hidden">
        <button
          aria-label="toggle done"
          className={`fast mt-px flex h-[12px] w-[12px] shrink-0 items-center justify-center border ${
            done ? "border-accent bg-accent text-white" : "border-accent bg-surface"
          }`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (task) done ? mutations.uncomplete(task) : mutations.complete(task);
          }}
        >
          {done && (
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          )}
        </button>
        <div className="min-w-0">
          <div className={`truncate text-[11px] font-medium ${done ? "line-through opacity-60" : ""}`}>
            {arg.event.title}
          </div>
          <div className="mono text-[10px] opacity-70">{arg.timeText}</div>
        </div>
      </div>
    );
  };

  const dayStart = settings?.day_start_hour ?? 6;
  const dayEnd = settings?.day_end_hour ?? 24;

  return (
    <div className="h-full min-w-0 flex-1 bg-surface p-2">
      <FullCalendar
        ref={calRef}
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView={view}
        headerToolbar={false}
        allDaySlot={false}
        firstDay={settings?.week_start ?? 1}
        nowIndicator
        nowIndicatorContent={(arg) =>
          arg.isAxis ? (
            <span className="mono whitespace-nowrap border border-signal bg-surface px-1 text-[9px] leading-none text-signal">
              {format(now, "h:mma").toLowerCase()}
            </span>
          ) : null
        }
        slotMinTime={`${String(dayStart).padStart(2, "0")}:00:00`}
        slotMaxTime={`${String(dayEnd).padStart(2, "0")}:00:00`}
        slotDuration="00:15:00"
        snapDuration="00:15:00"
        slotLabelInterval="01:00"
        slotLabelFormat={{ hour: "numeric", minute: "2-digit", hour12: true, meridiem: "short" }}
        eventTimeFormat={{ hour: "numeric", minute: "2-digit", hour12: true, meridiem: "short" }}
        dayHeaderContent={(arg) => (
          <div className="flex items-baseline gap-1.5">
            <span>{arg.date.toLocaleDateString([], { weekday: "short" })}</span>
            <span className="day-num mono">{arg.date.getDate()}</span>
          </div>
        )}
        height="100%"
        expandRows
        events={fcEvents}
        editable
        droppable
        eventReceive={onReceive}
        eventDrop={onDrop}
        eventResize={onResize}
        eventDragStop={onDragStop}
        eventClick={onClick}
        eventContent={renderEvent}
        datesSet={(arg) => onRangeChange(arg.start.toISOString(), arg.end.toISOString())}
        scrollTime={`${String(Math.max(dayStart, Math.min(now.getHours() - 1, 20))).padStart(2, "0")}:00:00`}
      />
    </div>
  );
}

function minutesToDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
