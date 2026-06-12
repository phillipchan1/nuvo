import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import type { DatesSetArg, DateSelectArg, EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { EventReceiveArg, EventResizeDoneArg, EventDragStopArg } from "@fullcalendar/interaction";
import type { CalendarAccount, ExternalEvent, RecurrenceScope, Slot, Task, UserSettings } from "../lib/types";
import { DEFAULT_DURATION_MINUTES } from "../lib/types";
import { endOf, isOverdue, toDateISO } from "../lib/dates";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useExternalEventMutations } from "../hooks/useCalendar";
import type { useSlotMutations } from "../hooks/useSlots";
import DraftComposer, { type CreateKind } from "./DraftComposer";

export type CalView = "timeGridWeek" | "timeGridDay" | "dayGridMonth";

type ExtendedProps = {
  kind: "task" | "google" | "m365" | "slot";
  refId: string;
  calColor?: string;
  recurringEventId?: string;
  slotDone?: number;
  slotTotal?: number;
  slotChildren?: { title: string; done: boolean }[];
};

// ── Recurrence scope dialog ────────────────────────────────────────────────
function RecurrenceDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (scope: RecurrenceScope) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<RecurrenceScope>("THIS");

  const options: { value: RecurrenceScope; label: string; sub: string }[] = [
    { value: "THIS", label: "Just this event", sub: "Only this occurrence changes" },
    { value: "ALL", label: "All events in series", sub: "Every occurrence shifts by the same amount" },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/25"
        onClick={onCancel}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="moment pointer-events-auto bg-surface border border-line rounded-[var(--radius-lg)] w-[300px] p-5 elev-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-1">
            Recurring event
          </p>
          <h2 className="text-[14px] font-semibold mb-4 text-text leading-snug">
            Edit this event or the whole series?
          </h2>

          <div className="flex flex-col gap-1.5 mb-5">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setScope(opt.value)}
                className={`fast flex items-start gap-3 w-full px-3 py-2.5 rounded-[var(--radius)] text-left border transition-colors ${
                  scope === opt.value
                    ? "bg-accent-soft border-accent"
                    : "border-line hover:border-line-strong hover:bg-surface-2"
                }`}
              >
                <span
                  className={`mt-[3px] h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                    scope === opt.value ? "border-accent bg-accent" : "border-muted"
                  }`}
                />
                <span>
                  <span className={`block text-[12px] font-medium leading-tight ${scope === opt.value ? "text-text" : "text-text"}`}>
                    {opt.label}
                  </span>
                  <span className="block text-[10.5px] text-muted mt-0.5 leading-snug">{opt.sub}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="fast px-3 py-1.5 text-[12px] text-muted rounded-[var(--radius-sm)] hover:bg-bg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(scope)}
              className="fast px-3 py-1.5 text-[12px] font-medium bg-accent text-white rounded-[var(--radius-sm)] hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function CalendarPane({
  view,
  tasks,
  events,
  slots,
  slotTasks,
  accounts,
  settings,
  now,
  taskAccent,
  mutations,
  eventMutations,
  slotMutations,
  onOpenTask,
  onOpenEvent,
  onOpenSlot,
  onRangeChange,
  railRef,
}: {
  view: CalView;
  tasks: Task[];
  events: ExternalEvent[];
  slots: Slot[];
  /** Child tasks grouped by slot id — drives the in-block progress read. */
  slotTasks: Record<string, Task[]>;
  accounts: CalendarAccount[];
  settings: UserSettings | undefined;
  now: Date;
  /** Domain color per task — blocks carry their thread up the vertical. */
  taskAccent: (t: Task) => string | null;
  mutations: ReturnType<typeof useTaskMutations>;
  eventMutations: ReturnType<typeof useExternalEventMutations>;
  slotMutations: ReturnType<typeof useSlotMutations>;
  onOpenTask: (t: Task, anchor: DOMRect) => void;
  onOpenEvent: (e: ExternalEvent, anchor: DOMRect) => void;
  onOpenSlot: (s: Slot, anchor: DOMRect) => void;
  onRangeChange: (startISO: string, endISO: string) => void;
  railRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const calRef = useRef<FullCalendar>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const [viewTitle, setViewTitle] = useState("");

  const googleAvailable = useMemo(
    () => accounts.some((a) => a.provider === "google"),
    [accounts],
  );

  // What a plain (no-modifier) click-drag creates. ⌥-drag forces event,
  // ⌘/Ctrl-drag forces slot regardless of this.
  const [createMode, setCreateMode] = useState<CreateKind>("task");

  // The in-flight click-drag draft → renders the DraftComposer card.
  const [draft, setDraft] = useState<{
    start: Date;
    end: Date;
    kind: CreateKind;
    point: { x: number; y: number };
  } | null>(null);

  // Pending recurrence scope choice — set when a recurring event is
  // dropped or resized; cleared on confirm/cancel.
  const [recurrencePrompt, setRecurrencePrompt] = useState<null | {
    onConfirm: (scope: RecurrenceScope) => void;
  }>(null);

  // Alt+← / Alt+→ = prev/next  |  Alt+T = today
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const api = calRef.current?.getApi();
      if (!api) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); api.prev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); api.next(); }
      if (e.key.toLowerCase() === "t") { e.preventDefault(); api.today(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
                borderColor: `color-mix(in srgb, ${accent} 30%, var(--line))`,
                borderLeftColor: accent,
                backgroundColor: `color-mix(in srgb, ${accent} 15%, var(--surface))`,
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
            ? `color-mix(in srgb, ${calColor} 18%, var(--surface))`
            : "transparent",
          borderColor: isGoogle
            ? `color-mix(in srgb, ${calColor} 50%, var(--line))`
            : undefined,
          extendedProps: {
            kind: isGoogle ? ("google" as const) : ("m365" as const),
            refId: e.id,
            calColor,
            // Prefer the DB-derived field (post-migration); fall back to
            // detecting the Google instance ID pattern: base_YYYYMMDDTHHMMSSZ
            recurringEventId:
              e.recurring_event_id ??
              (isGoogle && /_.{8}T\d{6}Z?$/.test(e.provider_event_id)
                ? e.provider_event_id
                : undefined),
          },
        };
      });

    const slotEvents = slots.map((s) => {
      const end = new Date(new Date(s.start_time).getTime() + s.duration_minutes * 60_000);
      const color = s.color ?? "var(--accent)";
      const children = (slotTasks[s.id] ?? [])
        .filter((t) => t.status !== "trashed")
        .map((t) => ({ title: t.title, done: t.status === "done" }))
        // completed tasks sink to the bottom
        .sort((a, b) => Number(a.done) - Number(b.done));
      const done = children.filter((c) => c.done).length;
      return {
        id: `slot:${s.id}`,
        title: s.title || "Time slot",
        start: s.start_time,
        end: end.toISOString(),
        editable: true,
        durationEditable: true,
        classNames: ["evt-slot"],
        backgroundColor: `color-mix(in srgb, ${color} 10%, var(--surface))`,
        borderColor: `color-mix(in srgb, ${color} 35%, var(--line))`,
        extendedProps: {
          kind: "slot" as const,
          refId: s.id,
          calColor: color,
          slotDone: done,
          slotTotal: children.length,
          slotChildren: children,
        },
      };
    });

    return [...taskEvents, ...externalEvents, ...slotEvents];
  }, [tasks, events, slots, slotTasks, hidden, accountById, now, taskAccent]);

  const findTask = (id: string) => tasksRef.current.find((t) => t.id === id);
  const findEvent = (id: string) => eventsRef.current.find((e) => e.id === id);
  const findSlot = (id: string) => slotsRef.current.find((s) => s.id === id);

  // If the event is part of a recurring series, revert immediately and
  // surface the scope dialog. On confirm the caller gets scope + executes.
  const withRecurrenceScope = (
    extProps: ExtendedProps,
    revert: () => void,
    action: (scope: RecurrenceScope) => void,
  ) => {
    if (extProps.kind !== "google" || !extProps.recurringEventId) {
      action("THIS");
      return;
    }
    revert();
    setRecurrencePrompt({
      onConfirm: (scope) => {
        setRecurrencePrompt(null);
        action(scope);
      },
    });
  };

  const onReceive = (info: EventReceiveArg) => {
    const taskId = info.draggedEl.getAttribute("data-task-drag");
    const start = info.event.start;
    info.revert();
    const task = taskId ? findTask(taskId) : undefined;
    if (!task || !start) return;
    // Dropped onto a slot's time range → it joins the slot (no block of its
    // own); otherwise it becomes a normal time block at the drop time.
    const t = start.getTime();
    const slot = slotsRef.current.find((s) => {
      const ss = new Date(s.start_time).getTime();
      return t >= ss && t < ss + s.duration_minutes * 60_000;
    });
    if (slot) mutations.assignToSlot(task, slot);
    else mutations.block(task, start);
  };

  const onDrop = (info: EventDropArg) => {
    const extProps = info.event.extendedProps as ExtendedProps;
    const { kind, refId } = extProps;

    if (kind === "task") {
      const task = findTask(refId);
      if (task && info.event.start) mutations.block(task, info.event.start);
      return;
    }

    if (kind === "slot") {
      const ns = info.event.start;
      const ne = info.event.end;
      if (ns) {
        slotMutations.updateSlot({
          id: refId,
          patch: {
            start_time: ns.toISOString(),
            do_date: toDateISO(ns),
            ...(ne
              ? { duration_minutes: Math.max(15, Math.round((ne.getTime() - ns.getTime()) / 60_000)) }
              : {}),
          },
        });
      }
      return;
    }

    if (kind === "google") {
      // Capture new times before any revert call.
      const newStart = info.event.start;
      const newEnd = info.event.end;
      if (!newStart || !newEnd) { info.revert(); return; }

      withRecurrenceScope(extProps, () => info.revert(), (scope) => {
        eventMutations.updateEvent({
          id: refId,
          patch: { start_at: newStart.toISOString(), end_at: newEnd.toISOString() },
          scope,
        });
      });
      return;
    }

    info.revert(); // m365 is read-only
  };

  const onResize = (info: EventResizeDoneArg) => {
    const extProps = info.event.extendedProps as ExtendedProps;
    const { kind, refId } = extProps;

    if (kind === "task") {
      const task = findTask(refId);
      if (task && info.event.start && info.event.end) {
        const mins = Math.round((info.event.end.getTime() - info.event.start.getTime()) / 60_000);
        mutations.patchTask(task.id, { duration_minutes: Math.max(15, mins) });
      }
      return;
    }

    if (kind === "slot") {
      const ns = info.event.start;
      const ne = info.event.end;
      if (ns && ne) {
        slotMutations.updateSlot({
          id: refId,
          patch: {
            start_time: ns.toISOString(),
            do_date: toDateISO(ns),
            duration_minutes: Math.max(15, Math.round((ne.getTime() - ns.getTime()) / 60_000)),
          },
        });
      }
      return;
    }

    if (kind === "google") {
      const newStart = info.event.start;
      const newEnd = info.event.end;
      if (!newStart || !newEnd) { info.revert(); return; }

      withRecurrenceScope(extProps, () => info.revert(), (scope) => {
        eventMutations.updateEvent({
          id: refId,
          patch: { start_at: newStart.toISOString(), end_at: newEnd.toISOString() },
          scope,
        });
      });
      return;
    }

    info.revert();
  };

  // Drag a block back onto the left rail → unblock (keeps do_date)
  const onDragStop = (info: EventDragStopArg) => {
    const rail = railRef.current;
    if (!rail) return;
    const r = rail.getBoundingClientRect();
    const { clientX, clientY } = info.jsEvent;
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const { kind, refId } = info.event.extendedProps as ExtendedProps;
      if (kind === "task") {
        const task = findTask(refId);
        if (task) mutations.unblock(task);
      }
    }
  };

  // Click-drag on empty grid → open the quick-create card. Modifiers pick the
  // type up front (⌥ event, ⌘/Ctrl slot); otherwise the toolbar create mode.
  const onSelect = (arg: DateSelectArg) => {
    const je = arg.jsEvent;
    let kind: CreateKind = createMode;
    if (je?.altKey) kind = "event";
    else if (je?.metaKey || je?.ctrlKey) kind = "slot";
    if (kind === "event" && !googleAvailable) kind = "task";
    setDraft({
      start: arg.start,
      end: arg.end,
      kind,
      point: { x: je?.clientX ?? 0, y: je?.clientY ?? 0 },
    });
  };

  const handleCreate = async (kind: CreateKind, title: string) => {
    if (!draft) return;
    const { start, end, point } = draft;
    const duration = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));
    const doDate = toDateISO(start);
    setDraft(null);
    calRef.current?.getApi().unselect();

    try {
      if (kind === "task") {
        await mutations.create({
          title,
          do_date: doDate,
          start_time: start.toISOString(),
          duration_minutes: duration,
        });
      } else if (kind === "event") {
        await eventMutations.createEvent({
          title,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
        });
      } else {
        const slot = await slotMutations.createSlot({
          title,
          do_date: doDate,
          start_time: start.toISOString(),
          duration_minutes: duration,
        });
        // Open the new slot so the user can immediately fill it with tasks.
        onOpenSlot(slot, new DOMRect(point.x, point.y, 0, 0));
      }
    } catch (e) {
      console.warn("[nuvo] create from grid failed:", e);
    }
  };

  const onClick = (info: EventClickArg) => {
    const { kind, refId } = info.event.extendedProps as ExtendedProps;
    if (kind === "task") {
      const task = findTask(refId);
      if (task) onOpenTask(task, info.el.getBoundingClientRect());
    } else if (kind === "slot") {
      const slot = findSlot(refId);
      if (slot) onOpenSlot(slot, info.el.getBoundingClientRect());
    } else {
      const evt = findEvent(refId);
      if (evt) onOpenEvent(evt, info.el.getBoundingClientRect());
    }
  };

  const renderEvent = (arg: EventContentArg) => {
    const { kind, refId, calColor } = arg.event.extendedProps as ExtendedProps;
    const inMonth = arg.view.type === "dayGridMonth";

    // ── Month view: compact dot + title pill ──────────────────────────────
    if (inMonth) {
      const task = kind === "task" ? findTask(refId) : null;
      const done = task?.status === "done";
      const dotColor = kind === "task" ? "var(--accent)" : (calColor ?? "var(--muted)");
      return (
        <div className="flex min-w-0 items-center gap-1 px-1.5 py-[2px]">
          <span
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ backgroundColor: dotColor, opacity: kind === "m365" ? 0.55 : 1 }}
          />
          <span
            className={`truncate text-label font-medium leading-none ${done ? "line-through opacity-50" : ""}`}
          >
            {arg.event.title}
          </span>
        </div>
      );
    }

    // ── Time-grid view ────────────────────────────────────────────────────
    const startMs = arg.event.start?.getTime() ?? 0;
    const endMs = arg.event.end?.getTime() ?? startMs + 3_600_000;
    const durationMins = (endMs - startMs) / 60_000;
    const showTime = durationMins > 29;

    // ── Slot: a container with a progress badge + child task peek ──────────
    if (kind === "slot") {
      const { slotDone = 0, slotTotal = 0, slotChildren = [] } =
        arg.event.extendedProps as ExtendedProps;
      const color = calColor ?? "var(--accent)";
      const tall = durationMins > 44;
      return (
        <div className="flex h-full min-w-0 overflow-hidden">
          <div
            className="w-[3px] shrink-0 self-stretch rounded-l-[3px]"
            style={{ backgroundColor: color }}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-1.5 pt-1 pb-0.5">
            <div className="flex items-center gap-1">
              <span className="truncate text-label font-semibold leading-tight">
                {arg.event.title}
              </span>
              {slotTotal > 0 && (
                <span className="mono ml-auto shrink-0 rounded-full bg-bg px-1 text-micro leading-snug text-muted">
                  {slotDone}/{slotTotal}
                </span>
              )}
            </div>
            {tall && slotChildren.length > 0 && (
              <div className="mt-0.5 flex min-h-0 flex-col gap-px overflow-hidden">
                {slotChildren.slice(0, 4).map((c, i) => (
                  <div key={i} className="flex items-center gap-1 text-meta leading-tight">
                    <span
                      className="h-[3px] w-[3px] shrink-0 rounded-full"
                      style={{ backgroundColor: c.done ? "var(--muted)" : color }}
                    />
                    <span className={`truncate ${c.done ? "line-through opacity-50" : "opacity-80"}`}>
                      {c.title}
                    </span>
                  </div>
                ))}
                {slotChildren.length > 4 && (
                  <span className="text-micro text-muted">+{slotChildren.length - 4} more</span>
                )}
              </div>
            )}
            {tall && slotChildren.length === 0 && (
              <span className="mt-0.5 text-meta italic text-muted/70">empty — click to add</span>
            )}
          </div>
        </div>
      );
    }

    if (kind !== "task") {
      return (
        <div className="flex h-full min-w-0 overflow-hidden">
          {calColor && (
            <div
              className="w-[3px] shrink-0 self-stretch rounded-l-[3px]"
              style={{ backgroundColor: calColor, opacity: kind === "m365" ? 0.5 : 1 }}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-start overflow-hidden px-1.5 pt-1.5 pb-1">
            <div className="truncate text-label font-semibold leading-tight">
              {arg.event.title}
            </div>
            {showTime && (
              <div className="mono mt-0.5 truncate text-micro leading-tight opacity-60">
                {arg.timeText}
              </div>
            )}
          </div>
        </div>
      );
    }

    const task = findTask(refId);
    const done = task?.status === "done";
    return (
      <div className="flex h-full min-w-0 items-start gap-1.5 overflow-hidden pt-0.5">
        <button
          aria-label="toggle done"
          className={`fast mt-[1px] flex h-[12px] w-[12px] shrink-0 items-center justify-center border ${
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
          <div
            className={`truncate text-label font-semibold leading-tight ${
              done ? "line-through opacity-55" : ""
            }`}
          >
            {arg.event.title}
          </div>
          {showTime && (
            <div className="mono mt-0.5 text-micro leading-tight opacity-60">
              {arg.timeText}
            </div>
          )}
        </div>
      </div>
    );
  };

  const dayStart = settings?.day_start_hour ?? 6;
  const dayEnd = settings?.day_end_hour ?? 24;

  const isMonth = view === "dayGridMonth";

  const handleDatesSet = (arg: DatesSetArg) => {
    onRangeChange(arg.start.toISOString(), arg.end.toISOString());
    setViewTitle(calRef.current?.getApi().view.title ?? "");
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-surface">
      {recurrencePrompt && (
        <RecurrenceDialog
          onConfirm={recurrencePrompt.onConfirm}
          onCancel={() => setRecurrencePrompt(null)}
        />
      )}

      {draft && (
        <DraftComposer
          start={draft.start}
          end={draft.end}
          point={draft.point}
          initialKind={draft.kind}
          googleAvailable={googleAvailable}
          onCreate={handleCreate}
          onCancel={() => {
            setDraft(null);
            calRef.current?.getApi().unselect();
          }}
        />
      )}

      {/* ── Navigation bar ──────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5">
        <button
          onClick={() => calRef.current?.getApi().prev()}
          className="fast flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
          title="Previous (Alt+←)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          onClick={() => calRef.current?.getApi().next()}
          className="fast flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
          title="Next (Alt+→)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <span className="mx-1 select-none text-caption font-semibold text-text">
          {viewTitle}
        </span>

        <button
          onClick={() => calRef.current?.getApi().today()}
          className="fast ml-1 rounded border border-line px-2 py-0.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
          title="Go to today (Alt+T)"
        >
          Today
        </button>

        <div className="flex-1" />

        {/* Drag-to-create mode — what a plain click-drag makes. Power users can
            also ⌥-drag (event) or ⌘-drag (slot) to override this. */}
        {!isMonth && (
          <div
            className="flex items-center gap-1.5"
            title="What a plain drag creates · ⌥-drag = event · ⌘-drag = slot"
          >
            <span className="text-meta text-muted">drag adds</span>
            <div className="flex overflow-hidden rounded-md border border-line">
              {(["task", "event", "slot"] as const)
                .filter((k) => k !== "event" || googleAvailable)
                .map((k) => (
                  <button
                    key={k}
                    onClick={() => setCreateMode(k)}
                    className={`fast px-2 py-0.5 text-meta font-medium capitalize ${
                      createMode === k ? "bg-accent text-white" : "text-muted hover:text-ink"
                    }`}
                  >
                    {k}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* ── FullCalendar ────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 p-2">
        <FullCalendar
          ref={calRef}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView={view}
          headerToolbar={false}
          allDaySlot={false}
          firstDay={settings?.week_start ?? 0}
          nowIndicator={!isMonth}
          nowIndicatorContent={(arg) =>
            arg.isAxis ? (
              <span className="mono whitespace-nowrap border border-signal bg-surface px-1 text-[9px] leading-none text-signal">
                {format(now, "h:mma").toLowerCase()}
              </span>
            ) : null
          }
          {...(!isMonth && {
            slotMinTime: `${String(dayStart).padStart(2, "0")}:00:00`,
            slotMaxTime: `${String(dayEnd).padStart(2, "0")}:00:00`,
            slotDuration: "00:15:00",
            snapDuration: "00:15:00",
            slotLabelInterval: "01:00",
            slotLabelFormat: { hour: "numeric", minute: "2-digit", hour12: true, meridiem: "short" },
            eventTimeFormat: { hour: "numeric", minute: "2-digit", hour12: true, meridiem: "short" },
            scrollTime: `${String(Math.max(dayStart, Math.min(now.getHours() - 1, 20))).padStart(2, "0")}:00:00`,
          })}
          dayHeaderContent={(arg) => {
            const isToday = arg.isToday;
            const weekday = arg.date.toLocaleDateString([], { weekday: "short" }).toUpperCase();
            const dateNum = arg.date.getDate();
            return (
              <div className="flex flex-col items-center gap-0.5 py-1">
                <span className="text-micro font-semibold tracking-widest text-muted">
                  {weekday}
                </span>
                <span
                  className={`mono flex h-7 w-7 items-center justify-center rounded-full text-head font-semibold tabular-nums leading-none transition-colors ${
                    isToday ? "bg-accent text-white" : "text-text"
                  }`}
                >
                  {dateNum}
                </span>
              </div>
            );
          }}
          height="100%"
          expandRows={!isMonth}
          dayMaxEvents={isMonth ? 4 : false}
          events={fcEvents}
          editable
          droppable
          selectable={!isMonth}
          selectMirror
          unselectAuto={false}
          selectMinDistance={5}
          select={onSelect}
          eventReceive={onReceive}
          eventDrop={onDrop}
          eventResize={onResize}
          eventDragStop={onDragStop}
          eventClick={onClick}
          eventContent={renderEvent}
          datesSet={handleDatesSet}
        />
      </div>
    </div>
  );
}

function minutesToDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
