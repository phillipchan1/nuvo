import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import type { DatesSetArg, DateSelectArg, EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { DateClickArg, EventReceiveArg, EventResizeDoneArg, EventDragStopArg } from "@fullcalendar/interaction";
import type { CalendarAccount, ExternalEvent, RecurrenceScope, Slot, Task, UserSettings } from "../lib/types";
import { DEFAULT_DURATION_MINUTES } from "../lib/types";
import { endOf, isOverdue, parseDateISO, toDateISO } from "../lib/dates";
import { addDays } from "date-fns";
import { expandRule, toGoogleRRULE, type RecurrenceRule } from "../lib/recurrence";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useExternalEventMutations } from "../hooks/useCalendar";
import type { useSlotMutations } from "../hooks/useSlots";
import { HORIZON_DAYS, type useRecurrenceMutations } from "../hooks/useRecurrence";
import DraftComposer, { type CreateKind } from "./DraftComposer";
import WeekEmblem from "./floors/WeekEmblem";
import WeekBoard from "./floors/WeekBoard";
import type { EmblemSpec } from "../lib/weekEmblem";

export type CalView = "timeGridWeek" | "timeGridDay" | "dayGridMonth" | "board";

type ExtendedProps = {
  kind: "task" | "google" | "m365" | "ics" | "slot";
  refId: string;
  calColor?: string;
  /** Solid color of the 3px accent bar (domain / calendar / slot color). */
  barColor?: string;
  recurringEventId?: string;
  /** Part of a repeating series (task/slot occurrence or Google instance). */
  recurring?: boolean;
  /** Baked-in done state so FC re-renders event content when status toggles. */
  done?: boolean;
  slotDone?: number;
  slotTotal?: number;
  slotChildren?: { title: string; done: boolean }[];
  /** User's own RSVP on this event. Null/undefined = organizer (treat as confirmed). */
  selfRsvp?: string | null;
};

/** One consistent fill + border, tinted from an item's own color. `fillPct`
 *  lets a class read stronger (tasks/slots) or quieter (events) than the base.
 *  Every colour is first pulled ~20% toward the active theme's neutral (--muted),
 *  so a cool-blue Google event warms up on warm paper — and stays cool on Fog —
 *  keeping the calendar cohesive whatever's on it, without losing each hue's
 *  identity (the solid bar still carries the true colour). */
function blockColors(c: string, fillPct = 14) {
  const base = `color-mix(in srgb, ${c} 80%, var(--muted))`;
  return {
    // Translucent (over transparent, not surface) so the block is a pane of
    // tinted glass — the gridlines/atmosphere read through it, frosted by the
    // .fc-event backdrop blur. The solid 3px left bar still carries the true hue.
    backgroundColor: `color-mix(in srgb, ${base} ${fillPct + 10}%, transparent)`,
    // No outline — the soft fill + the 3px left bar carry the block. Outlines
    // were the main thing making the calendar feel busy.
    borderColor: "transparent",
  };
}

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
          <p className="text-label font-semibold uppercase tracking-widest text-muted mb-1">
            Recurring event
          </p>
          <h2 className="text-head font-semibold mb-4 text-text leading-snug">
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
                  <span className={`block text-caption font-medium leading-tight ${scope === opt.value ? "text-text" : "text-text"}`}>
                    {opt.label}
                  </span>
                  <span className="block text-meta text-muted mt-0.5 leading-snug">{opt.sub}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="fast px-3 py-1.5 text-caption text-muted rounded-[var(--radius-sm)] hover:bg-bg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(scope)}
              className="fast px-3 py-1.5 text-caption font-medium bg-accent text-white rounded-[var(--radius-sm)] hover:opacity-90"
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
  slotTitle,
  mutations,
  eventMutations,
  slotMutations,
  recurrenceMutations,
  onRefreshCalendars,
  onFullRefreshCalendars,
  refreshingCalendars = false,
  onOpenTask,
  onOpenEvent,
  onOpenSlot,
  onRangeChange,
  railRef,
  onViewChange,
  hotkeysEnabled = true,
  weekGlyph,
  onOpenWeekPlan,
  weekButtonLabel,
  weekButtonGlow,
}: {
  view: CalView;
  onViewChange?: (v: CalView) => void;
  /** Schedule hotkeys (view switch + paging) stand down while a modal owns the screen. */
  hotkeysEnabled?: boolean;
  /** The living emblem for the current week — the toolbar's ambient gauge + door. */
  weekGlyph?: EmblemSpec | null;
  onOpenWeekPlan?: () => void;
  /** Lifecycle label for the week door: "Plan the week" / "The week's plan" / "Review ready". */
  weekButtonLabel?: string;
  /** Friday-review glow — only the review state lights the signal ring. */
  weekButtonGlow?: boolean;
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
  /** Display title for a slot — derived from its contents when unnamed. */
  slotTitle: (s: Slot) => string;
  mutations: ReturnType<typeof useTaskMutations>;
  eventMutations: ReturnType<typeof useExternalEventMutations>;
  slotMutations: ReturnType<typeof useSlotMutations>;
  recurrenceMutations: ReturnType<typeof useRecurrenceMutations>;
  onRefreshCalendars?: () => void;
  onFullRefreshCalendars?: () => void;
  refreshingCalendars?: boolean;
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
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;

  const [viewTitle, setViewTitle] = useState("");

  const googleAvailable = useMemo(
    () => accounts.some((a) => a.provider === "google"),
    [accounts],
  );

  const writableGoogleAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.provider === "google" && a.sync_direction === "two_way")
        .map((a) => ({ id: a.id, email: a.email })),
    [accounts],
  );

  // What a plain (no-modifier) click-drag creates. ⌥-drag forces event,
  // ⌘/Ctrl-drag forces slot regardless of this.
  // Plain drag always creates a task now (the segmented control was removed for
  // calm). Power overrides still apply: ⌥-drag = event, ⌘-drag = slot.
  const [createMode] = useState<CreateKind>("task");

  // The in-flight click-drag draft → renders the DraftComposer card.
  const [draft, setDraft] = useState<{
    start: Date;
    end: Date;
    kind: CreateKind;
    point: { x: number; y: number };
    allDay?: boolean;
  } | null>(null);

  // Highlight the anytime row cell for the draft's day while the composer is open.
  useEffect(() => {
    if (!draft?.allDay) return;
    const dateStr = toDateISO(draft.start);
    const cell = document.querySelector<HTMLElement>(`.fc-daygrid-day[data-date="${dateStr}"]`);
    cell?.classList.add("anytime-active");
    return () => cell?.classList.remove("anytime-active");
  }, [draft]);

  // The clicked block is brought to the front of any overlap (full width, on top)
  // so it's readable, and lifts toward you. Focus is applied IMPERATIVELY — a
  // direct class toggle on the block's own element — rather than by re-feeding
  // FullCalendar a new events array. Routing focus through the event model forced
  // FC to re-parse EVERY event on each click before the class (and so the lift)
  // could land, which is the "slight delay" you felt. A direct classList toggle
  // lifts the clicked block on the very next frame. Click-driven (not hover);
  // cleared by clicking empty grid or anywhere off a block.
  const focusedElRef = useRef<HTMLElement | null>(null);
  const clearFocus = () => {
    focusedElRef.current?.classList.remove("evt-focused");
    focusedElRef.current = null;
  };
  const focusBlock = (el: HTMLElement) => {
    if (focusedElRef.current === el) return;
    clearFocus();
    el.classList.add("evt-focused");
    focusedElRef.current = el;
  };

  // A focused block stays lifted/expanded until you move on — so a pointerdown
  // anywhere that ISN'T a calendar block (the rail, another floor, a button)
  // drops the focus, instead of it lingering once you've clicked elsewhere.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".fc-event")) return;
      clearFocus();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Pending recurrence scope choice — set when a recurring event is
  // dropped or resized; cleared on confirm/cancel.
  const [recurrencePrompt, setRecurrencePrompt] = useState<null | {
    onConfirm: (scope: RecurrenceScope) => void;
  }>(null);

  // Surfaced when a grid create (task/event/slot, incl. repeats) fails, so a
  // server-side error never silently swallows the thing you just made.
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Vertical density: "how many hours fill the screen" ──────────────────
  // Fewer hours = taller rows (more scroll); more hours = everything fits.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [availH, setAvailH] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvailH(el.clientHeight));
    ro.observe(el);
    setAvailH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const dayStart = settings?.day_start_hour ?? 6;
  const dayEnd = settings?.day_end_hour ?? 24;
  // An hour of headroom around the working window so an early (or late) event
  // is always reachable instead of jammed against the top edge of the grid.
  const viewStart = Math.max(0, dayStart - 1);
  const viewEnd = Math.min(24, dayEnd < 24 ? dayEnd + 1 : 24);
  const windowHours = Math.max(1, viewEnd - viewStart);
  const fitClamped = Math.min(Math.max(6, settings?.calendar_fit_hours ?? 13), windowHours);
  // px-per-hour that makes `fitClamped` hours fill the viewport; the rest
  // scrolls. (~16px chrome padding + ~52px day header subtracted.)
  const pxPerHour =
    availH > 160 ? Math.max(26, Math.min(190, (availH - 16 - 52) / fitClamped)) : 52;
  const densityRef = useRef(pxPerHour);
  densityRef.current = pxPerHour;

  // Schedule hotkeys. Views always win on bare s / w / d / m (the rail's triage
  // letters moved off these). = / - page the period, as do ⌘→ / ⌘←; ⌘T returns
  // to today. Paging/today need FullCalendar's api, so they no-op in Spread.
  useEffect(() => {
    if (!hotkeysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const api = () => calRef.current?.getApi();

      if (e.metaKey || e.ctrlKey) {
        if (e.key === "ArrowLeft") { e.preventDefault(); api()?.prev(); }
        else if (e.key === "ArrowRight") { e.preventDefault(); api()?.next(); }
        else if (e.key.toLowerCase() === "t") { e.preventDefault(); api()?.today(); }
        return;
      }
      if (e.altKey) return;

      switch (e.key) {
        case "s": e.preventDefault(); onViewChange?.("board"); break;
        case "w": e.preventDefault(); onViewChange?.("timeGridWeek"); break;
        case "d": e.preventDefault(); onViewChange?.("timeGridDay"); break;
        case "m": e.preventDefault(); onViewChange?.("dayGridMonth"); break;
        case "=":
        case "+": e.preventDefault(); api()?.next(); break;
        case "-":
        case "_": e.preventDefault(); api()?.prev(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeysEnabled, onViewChange]);

  // External drag: any [data-task-drag] row in the left rail can be dropped
  // onto the grid. FullCalendar owns the drop geometry; we own the state. In the
  // board ("Spread") view there's no grid — WeekBoard owns rail-row drags itself,
  // so this FC draggable must stand down or it fights for the same rows.
  useEffect(() => {
    if (!railRef.current || view === "board") return;
    const draggable = new Draggable(railRef.current, {
      itemSelector: "[data-task-drag]",
      // A few px of slop so a click (or a cmd/shift multi-select) on a rail row
      // isn't misread as the start of a drag onto the grid.
      minDistance: 6,
      eventData: (el) => {
        const groupCount = el.getAttribute("data-task-drag-group")?.split(",").length ?? 1;
        return {
          title:
            groupCount > 1 ? `${groupCount} tasks` : (el.getAttribute("data-task-title") ?? "task"),
          duration: minutesToDuration(
            Number(el.getAttribute("data-task-duration")) || DEFAULT_DURATION_MINUTES,
          ),
          create: true,
        };
      },
    });
    return () => draggable.destroy();
  }, [railRef, view]);

  // Live drop-target feedback while a task is being dragged. Classes are toggled
  // imperatively (no React state) so a drag never re-renders CalendarPane
  // mid-gesture (which could disturb FullCalendar's own drag/drop):
  //   body.cal-dragging        → the day cells glow as "anytime" drop targets
  //   body.over-slot           → fade the drag ghost (it's "dropping into" a slot)
  //   .evt-slot.slot-drop-target → the hovered slot lights up, ready to accept
  //   .rail-drop-active        → the left rail is highlighted as the Inbox zone
  // The slot/rail are hit-tested per move via elementFromPoint (the ghost is
  // pointer-events:none, so it sees the element underneath). Armed for tasks
  // only — dragging an event/slot itself stays quiet.
  useEffect(() => {
    let armed = false;
    let active = false;
    let overSlot: HTMLElement | null = null;
    let dragId: string | null = null; // external [data-task-drag] id (rail / slot popover row)
    let fromRail = false; // did this drag start inside the rail itself?
    let overRail = false; // is the pointer currently over the rail?
    const reset = () => {
      document.body.classList.remove("cal-dragging", "over-slot");
      overSlot?.classList.remove("slot-drop-target");
      overSlot = null;
      railRef.current?.classList.remove("rail-drop-active");
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      armed = Boolean(el?.closest?.("[data-task-drag], .evt-task"));
      const dragEl = el?.closest?.("[data-task-drag]") as HTMLElement | null;
      dragId = dragEl?.getAttribute("data-task-drag") ?? null;
      fromRail = Boolean(dragEl && railRef.current?.contains(dragEl));
    };
    const onMove = (e: PointerEvent) => {
      if (!armed) return;
      if (!active) { active = true; document.body.classList.add("cal-dragging"); }
      const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const slotEl = (under?.closest?.(".fc-event.evt-slot") ?? null) as HTMLElement | null;
      if (slotEl !== overSlot) {
        overSlot?.classList.remove("slot-drop-target");
        slotEl?.classList.add("slot-drop-target");
        overSlot = slotEl;
      }
      document.body.classList.toggle("over-slot", Boolean(slotEl));
      const rail = railRef.current;
      if (rail) {
        const rr = rail.getBoundingClientRect();
        const onRail =
          e.clientX >= rr.left && e.clientX <= rr.right && e.clientY >= rr.top && e.clientY <= rr.bottom;
        overRail = onRail && !slotEl;
        // Only an item dragged *in* from elsewhere (a slot popover row) is an
        // inbox candidate; dragging a rail row back onto the rail just cancels.
        rail.classList.toggle("rail-drop-active", overRail && !fromRail && Boolean(dragId));
      }
    };
    const onUp = () => {
      // Capture drag state before resetting — needed to suppress the phantom
      // click the browser fires on the original element after any drag gesture.
      const wasRailDrag = active && fromRail;
      armed = false;
      if (active) {
        active = false;
        // A slot/popover item dropped on the rail → back to the Inbox. (Calendar
        // blocks use onDragStop; rail rows dropped on the rail just cancel.)
        if (overRail && dragId && !fromRail) {
          const task = tasksRef.current.find((t) => t.id === dragId);
          if (task) mutationsRef.current.backToInbox(task);
        }
        reset();
      }
      dragId = null;
      fromRail = false;
      overRail = false;
      // After dragging from the rail (whether dropped, cancelled, or returned),
      // the browser fires a click on the original TaskRow. Eat it once so the
      // task popover doesn't open when the user changes their mind mid-drag.
      if (wasRailDrag) {
        document.addEventListener("click", (e) => { e.stopPropagation(); }, { capture: true, once: true });
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      reset();
    };
  }, [railRef]);

  useEffect(() => {
    if (view === "board") return; // the board isn't a FullCalendar view
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
        // Tasks share one identity — the violet accent — so "this is my work"
        // reads at a glance against the calendar's own (arbitrarily coloured)
        // events. The domain thread lives on in the thin bar; overdue goes ember.
        const fill = overdue ? "var(--signal)" : "var(--accent)";
        const bar = overdue ? "var(--signal)" : (taskAccent(t) ?? "var(--accent)");
        return {
          id: `task:${t.id}`,
          title: t.title,
          start: t.start_time!,
          end: endOf({ start_time: t.start_time!, duration_minutes: t.duration_minutes }).toISOString(),
          editable: true,
          classNames: ["evt-task", t.status === "done" ? "evt-done" : ""].filter(Boolean),
          ...blockColors(fill, 22),
          extendedProps: {
            kind: "task" as const,
            refId: t.id,
            barColor: bar,
            recurring: Boolean(t.recurrence_id),
            done: t.status === "done",
          },
        };
      });

    // Planned for a day but not yet time-blocked → an all-day chip at the top of
    // its day. Drag it down to a time to block it, or onto another day's all-day
    // row to re-plan it. Dropping a task on the all-day row (vs a time slot) is
    // how you say "do it that day, time TBD".
    const plannedTaskEvents = tasks
      .filter(
        (t) =>
          !t.start_time &&
          t.do_date &&
          !t.slot_id &&
          t.status !== "done" &&
          t.status !== "trashed",
      )
      .map((t) => {
        return {
          id: `task:${t.id}`,
          title: t.title,
          start: t.do_date!,
          allDay: true,
          editable: true,
          durationEditable: false,
          classNames: ["evt-task", "evt-allday"],
          ...blockColors("var(--accent)", 20),
          extendedProps: {
            kind: "task" as const,
            refId: t.id,
            barColor: taskAccent(t) ?? "var(--accent)",
            recurring: Boolean(t.recurrence_id),
          },
        };
      });

    const externalEvents = events
      .filter((e) => !hidden.has(e.calendar_id) && !e.all_day)
      .map((e) => {
        const account = accountById.get(e.account_id);
        const isGoogle = account?.provider === "google";
        const isIcs = account?.provider === "ics";
        const calColor =
          account?.calendars?.find((c) => c.id === e.calendar_id)?.color ?? "var(--event-default)";
        // Dim events where the user hasn't confirmed yet.
        const rsvp = e.self_rsvp ?? null;
        const rsvpClass =
          rsvp === "needsAction" ? "evt-pending"
          : rsvp === "tentative" ? "evt-tentative"
          : rsvp === "declined" ? "evt-declined"
          : null;

        return {
          id: `evt:${e.id}`,
          title: e.title,
          start: e.start_at,
          end: e.end_at,
          editable: isGoogle,
          durationEditable: isGoogle,
          classNames: [
            isGoogle ? "evt-google" : isIcs ? "evt-ics" : "evt-m365",
            ...(rsvpClass ? [rsvpClass] : []),
          ],
          // Google + ICS render as quiet tinted blocks (the "given" calendar, so
          // your bolder tasks read on top); only M365 keeps the read-only hatch.
          ...(isGoogle || isIcs ? blockColors(calColor, 13) : {}),
          extendedProps: {
            kind: isGoogle ? ("google" as const) : isIcs ? ("ics" as const) : ("m365" as const),
            refId: e.id,
            calColor,
            barColor: calColor,
            selfRsvp: rsvp,
            // Prefer the DB-derived field (post-migration); fall back to
            // detecting the Google instance ID pattern: base_YYYYMMDDTHHMMSSZ
            recurringEventId:
              e.recurring_event_id ??
              (isGoogle && /_.{8}T\d{6}Z?$/.test(e.provider_event_id)
                ? e.provider_event_id
                : undefined),
            recurring: Boolean(
              e.recurring_event_id ?? (isGoogle && /_.{8}T\d{6}Z?$/.test(e.provider_event_id)),
            ),
          },
        };
      });

    const slotEvents = slots.map((s) => {
      const end = new Date(new Date(s.start_time).getTime() + s.duration_minutes * 60_000);
      // The container reads as a slot (teal) regardless of domain; the thin bar
      // still carries the project/domain thread when one is set.
      const barColor = s.color ?? "var(--slot)";
      const children = (slotTasks[s.id] ?? [])
        .filter((t) => t.status !== "trashed")
        .map((t) => ({ title: t.title, done: t.status === "done" }))
        // completed tasks sink to the bottom
        .sort((a, b) => Number(a.done) - Number(b.done));
      const done = children.filter((c) => c.done).length;
      return {
        id: `slot:${s.id}`,
        title: slotTitle(s),
        start: s.start_time,
        end: end.toISOString(),
        editable: true,
        durationEditable: true,
        classNames: ["evt-slot"],
        // A clearly teal container — stronger than a task/event tint (14%) so a
        // slot is unmistakable. Border comes from .evt-slot (dashed teal) in CSS.
        backgroundColor: "color-mix(in srgb, var(--slot) 26%, var(--surface))",
        borderColor: "color-mix(in srgb, var(--slot) 55%, var(--line))",
        extendedProps: {
          kind: "slot" as const,
          refId: s.id,
          calColor: "var(--slot)",
          barColor,
          recurring: Boolean(s.recurrence_id),
          slotDone: done,
          slotTotal: children.length,
          slotChildren: children,
        },
      };
    });

    return [...taskEvents, ...plannedTaskEvents, ...externalEvents, ...slotEvents];
  }, [tasks, events, slots, slotTasks, hidden, accountById, now, taskAccent, slotTitle]);

  // Ghost block shown while the DraftComposer popover is open from a click
  // (drag already gets selectMirror; click has no selection on the grid).
  const draftPreviewEvent = draft
    ? {
        id: "draft:preview",
        title: "",
        start: draft.start.toISOString(),
        end: draft.end.toISOString(),
        editable: false,
        classNames: ["evt-task", "evt-draft-preview"],
        ...blockColors("var(--accent)"),
        extendedProps: { kind: "task" as const, refId: "", barColor: "var(--accent)", recurring: false },
      }
    : null;

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
    const el = info.draggedEl;
    const start = info.event.start;
    const allDay = info.event.allDay;
    info.revert();
    // A multi-selection drags as a group (data-task-drag-group); a single row is
    // just its own id. Resolve to the list of tasks being dropped.
    const group = el.getAttribute("data-task-drag-group");
    const ids = group ? group.split(",") : [el.getAttribute("data-task-drag") ?? ""];
    const tasks = ids.map((id) => findTask(id)).filter((t): t is Task => Boolean(t));
    if (!tasks.length || !start) return;

    // Dropped on the all-day row → planned for that day, time TBD (no block).
    if (allDay) {
      const date = toDateISO(start);
      tasks.forEach((t) => mutations.planFor(t, date));
      return;
    }
    // Dropped onto a slot's time range → join the slot (no block of their own).
    const t0 = start.getTime();
    const slot = slotsRef.current.find((s) => {
      const ss = new Date(s.start_time).getTime();
      return t0 >= ss && t0 < ss + s.duration_minutes * 60_000;
    });
    if (slot) {
      tasks.forEach((t) => mutations.assignToSlot(t, slot));
      return;
    }
    // Otherwise time-block them — a group stacks back-to-back from the drop time.
    let cursor = new Date(start);
    tasks.forEach((t) => {
      mutations.block(t, cursor);
      cursor = new Date(cursor.getTime() + (t.duration_minutes ?? DEFAULT_DURATION_MINUTES) * 60_000);
    });
  };

  const onDrop = (info: EventDropArg) => {
    const extProps = info.event.extendedProps as ExtendedProps;
    const { kind, refId } = extProps;

    // The all-day row holds tasks only — block events/slots from landing there.
    if (info.event.allDay && kind !== "task") {
      info.revert();
      return;
    }

    if (kind === "task") {
      const task = findTask(refId);
      if (task && info.event.start) {
        // All-day row → planned for that day, no time block; a time slot → block.
        if (info.event.allDay) mutations.planFor(task, toDateISO(info.event.start));
        else mutations.block(task, info.event.start);
        if (task.recurrence_id && !task.recurrence_overridden)
          mutations.patchTask(task.id, { recurrence_overridden: true });
      }
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
            ...(findSlot(refId)?.recurrence_id ? { recurrence_overridden: true } : {}),
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
        mutations.patchTask(task.id, {
          duration_minutes: Math.max(15, mins),
          ...(task.recurrence_id && !task.recurrence_overridden ? { recurrence_overridden: true } : {}),
        });
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
            ...(findSlot(refId)?.recurrence_id ? { recurrence_overridden: true } : {}),
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

  // Drag a block (or "anytime" chip) back onto the left rail → return it to the
  // Inbox. (To just drop the time but keep the day, drag it to the anytime row.)
  const onDragStop = (info: EventDragStopArg) => {
    const rail = railRef.current;
    if (!rail) return;
    const r = rail.getBoundingClientRect();
    const { clientX, clientY } = info.jsEvent;
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const { kind, refId } = info.event.extendedProps as ExtendedProps;
      if (kind === "task") {
        const task = findTask(refId);
        if (task) mutations.backToInbox(task);
      }
    }
  };

  // Click-drag on empty grid → open the quick-create card. Modifiers pick the
  // type up front (⌥ event, ⌘/Ctrl slot); otherwise the toolbar create mode.
  const onSelect = (arg: DateSelectArg) => {
    if (arg.allDay) {
      // Anytime row click → plan a task for that day with no time.
      const day = arg.start;
      day.setHours(0, 0, 0, 0);
      const je = arg.jsEvent;
      setDraft({ start: day, end: day, kind: "task", point: { x: je?.clientX ?? 0, y: je?.clientY ?? 0 }, allDay: true });
      return;
    }
    clearFocus();
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

  const onDateClick = (arg: DateClickArg) => {
    clearFocus(); // clicking empty space drops the focused block
    if (isMonth || draft) return;
    if (arg.allDay) {
      const day = arg.date;
      day.setHours(0, 0, 0, 0);
      const je = arg.jsEvent;
      setDraft({ start: day, end: day, kind: "task", point: { x: je.clientX, y: je.clientY }, allDay: true });
      return;
    }
    const start = arg.date;
    const end = new Date(start.getTime() + 30 * 60_000);
    const je = arg.jsEvent;
    let kind: CreateKind = createMode;
    if (je?.altKey) kind = "event";
    else if (je?.metaKey || je?.ctrlKey) kind = "slot";
    if (kind === "event" && !googleAvailable) kind = "task";
    setDraft({ start, end, kind, point: { x: je.clientX, y: je.clientY } });
  };

  const handleCreate = async (kind: CreateKind, title: string, recurrence: RecurrenceRule | null, attendees: string[] = [], calendarAccountId?: string) => {
    if (!draft) return;
    const { start, end, point, allDay: draftAllDay } = draft;
    const duration = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));
    const doDate = toDateISO(start);
    const minutes = start.getHours() * 60 + start.getMinutes();
    setDraft(null);
    calRef.current?.getApi().unselect();

    // A repeat may exclude the very day you drew on (e.g. "every weekday" on a
    // Saturday → first occurrence Monday). Jump to the first real occurrence so
    // the series is visibly there instead of seeming to vanish.
    const revealFirstOccurrence = () => {
      if (!recurrence) return;
      const toISO = toDateISO(addDays(parseDateISO(doDate), HORIZON_DAYS));
      const first = expandRule(recurrence, doDate, doDate, toISO)[0];
      if (first && first !== doDate) calRef.current?.getApi().gotoDate(`${first}T12:00:00`);
    };

    try {
      if (kind === "task") {
        if (recurrence) {
          await recurrenceMutations.createSeries({
            kind: "task",
            rule: recurrence,
            anchorISO: doDate,
            template: { title, duration_minutes: duration, time_of_day_minutes: draftAllDay ? null : minutes },
          });
          revealFirstOccurrence();
        } else {
          await mutations.create({
            title,
            do_date: doDate,
            ...(draftAllDay ? {} : { start_time: start.toISOString(), duration_minutes: duration }),
          });
        }
      } else if (kind === "event") {
        await eventMutations.createEvent({
          title,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          ...(recurrence ? { recurrence: toGoogleRRULE(recurrence) } : {}),
          ...(attendees.length ? { attendees } : {}),
          ...(calendarAccountId ? { accountId: calendarAccountId } : {}),
        });
      } else if (recurrence) {
        await recurrenceMutations.createSeries({
          kind: "slot",
          rule: recurrence,
          anchorISO: doDate,
          template: { title, duration_minutes: duration, time_of_day_minutes: minutes },
        });
        revealFirstOccurrence();
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
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[nuvo] create from grid failed:", e);
      setCreateError(
        kind === "event"
          ? `Couldn't create the event: ${msg}`
          : `Couldn't create ${recurrence ? "the repeating " : "the "}${kind}: ${msg}`,
      );
    }
  };

  const onClick = (info: EventClickArg) => {
    const { kind, refId } = info.event.extendedProps as ExtendedProps;
    // Clicking the checkbox toggles done — handle it in FullCalendar's own click
    // (FC's native eventClick fires before React's onClick on the rendered
    // checkbox, and opening the detail re-renders it away), and never focus/open.
    if (kind === "task") {
      const target = info.jsEvent?.target as HTMLElement | null;
      // Primary: target is the button or a child of it (normal case).
      // Fallback: coordinate hit-test for when the browser retargets the click
      // to the event container (e.g. due to pointer capture).
      const onCheckbox = Boolean(target?.closest("[data-done-toggle]")) || (() => {
        const x = info.jsEvent?.clientX;
        const y = info.jsEvent?.clientY;
        if (x == null || y == null) return false;
        return Array.from(info.el.querySelectorAll("[data-done-toggle]")).some(btn => {
          const r = btn.getBoundingClientRect();
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        });
      })();
      if (onCheckbox) {
        const task = findTask(refId);
        if (task) task.status === "done" ? mutations.uncomplete(task) : mutations.complete(task);
        return;
      }
    }
    // A click brings the block to the front of any overlap (full width, on top)
    // and opens its detail — the lift lands this frame, the detail opens with it.
    focusBlock(info.el);
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
    const { kind, calColor, recurring, done: doneProp } = arg.event.extendedProps as ExtendedProps;
    const inMonth = arg.view.type === "dayGridMonth";

    // ── Month view: compact dot + title pill ──────────────────────────────
    if (inMonth) {
      const done = kind === "task" ? (doneProp ?? false) : false;
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

    // ── All-day task chip: "planned for the day, time TBD" — a compact pill ─
    if (arg.event.allDay && kind === "task") {
      const dotColor = (arg.event.extendedProps as ExtendedProps).barColor ?? "var(--accent)";
      return (
        <div className="flex h-full min-w-0 items-center gap-1.5 overflow-hidden px-1.5">
          <span
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: dotColor }}
          />
          <span className="truncate text-label font-medium leading-none">{arg.event.title}</span>
          {recurring ? <RecurMark className="shrink-0 opacity-45" /> : null}
        </div>
      );
    }

    // ── Time-grid view: one shell for every kind ──────────────────────────
    const { barColor, slotDone = 0, slotTotal = 0, slotChildren = [] } =
      arg.event.extendedProps as ExtendedProps;
    const startMs = arg.event.start?.getTime() ?? 0;
    const endMs = arg.event.end?.getTime() ?? startMs + 3_600_000;
    const durationMins = (endMs - startMs) / 60_000;
    // Pick chrome from the block's real rendered height, not just its minutes,
    // so density (zoom) and short blocks both stay legible.
    const heightPx = (durationMins / 60) * densityRef.current;
    const compact = heightPx < 34; // one line, no time
    const tiny = heightPx < 19; // ultra-short — kill the vertical padding
    const bar = barColor ?? calColor ?? "var(--accent)";
    const padY = tiny ? "py-0" : "py-[3px]";

    const Bar = (
      <span
        className="shrink-0 self-stretch rounded-l-[5px]"
        style={{ width: 3, background: bar, opacity: kind === "m365" ? 0.5 : 1 }}
      />
    );
    const TimeLine = !compact ? (
      <div className="mono mt-px truncate text-micro leading-none text-muted">{arg.timeText}</div>
    ) : null;
    const Recur = recurring ? <RecurMark className="shrink-0 opacity-45" /> : null;
    const titleCls = "truncate text-label font-semibold leading-[1.2]";

    // ── Slot: container with a progress badge + child task peek ────────────
    if (kind === "slot") {
      const showChildren = heightPx > 64;
      return (
        <div className="flex h-full min-w-0 overflow-hidden">
          {Bar}
          <div className={`flex min-w-0 flex-1 flex-col overflow-hidden px-1.5 ${padY} ${compact ? "justify-center" : "justify-start"}`}>
            <div className="flex min-w-0 items-center gap-1">
              <span className={titleCls}>{arg.event.title}</span>
              {Recur}
              {slotTotal > 0 && (
                <span className="mono ml-auto shrink-0 rounded-full bg-bg px-1 text-micro leading-snug text-muted">
                  {slotDone}/{slotTotal}
                </span>
              )}
            </div>
            {showChildren && slotChildren.length > 0 && (
              <div className="mt-1 flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {slotChildren.slice(0, 4).map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-meta leading-tight">
                    <span
                      className="h-[3px] w-[3px] shrink-0 rounded-full"
                      style={{ background: c.done ? "var(--muted)" : bar }}
                    />
                    <span className={`truncate ${c.done ? "line-through opacity-50" : "opacity-80"}`}>
                      {c.title}
                    </span>
                  </div>
                ))}
                {slotChildren.length > 4 && (
                  <span className="pl-[9px] text-micro text-muted">+{slotChildren.length - 4} more</span>
                )}
              </div>
            )}
            {showChildren && slotChildren.length === 0 && (
              <span className="mt-1 text-meta italic text-muted/70">empty — click to add</span>
            )}
          </div>
        </div>
      );
    }

    // ── Google / M365 event ────────────────────────────────────────────────
    if (kind !== "task") {
      return (
        <div className="flex h-full min-w-0 overflow-hidden">
          {Bar}
          <div className={`flex min-w-0 flex-1 flex-col overflow-hidden px-1.5 ${padY} ${compact ? "justify-center" : "justify-start"}`}>
            <div className="flex min-w-0 items-center gap-1">
              <span className={`${titleCls} ${kind === "m365" ? "text-muted" : ""}`}>{arg.event.title}</span>
              {Recur}
            </div>
            {TimeLine}
          </div>
        </div>
      );
    }

    // ── Task: checkbox tinted to its own color ─────────────────────────────
    const done = doneProp ?? false;
    return (
      <div className="flex h-full min-w-0 overflow-hidden">
        {Bar}
        <div className={`flex min-w-0 flex-1 gap-1.5 overflow-hidden px-1.5 ${padY} ${compact ? "items-center" : "items-start"}`}>
          <button
            aria-label="toggle done"
            data-done-toggle
            className={`fast mt-[1px] flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border ${
              done ? "border-accent bg-accent text-white" : "bg-surface"
            }`}
            style={done ? undefined : { borderColor: bar }}
            onMouseDown={(e) => {
              // Don't let a press on the checkbox begin an event drag.
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
          >
            {done && (
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <span className={`${titleCls} ${done ? "line-through opacity-55" : ""}`}>
                {arg.event.title}
              </span>
              {Recur}
            </div>
            {TimeLine}
          </div>
        </div>
      </div>
    );
  };

  const isMonth = view === "dayGridMonth";

  const handleDatesSet = (arg: DatesSetArg) => {
    onRangeChange(arg.start.toISOString(), arg.end.toISOString());
    setViewTitle(calRef.current?.getApi().view.title ?? "");
  };

  return (
    // Transparent so the single .atmosphere canvas (laid down by AppShellInner)
    // reads continuously across the spine, the rail, and the calendar grid —
    // the grid IS the paper. A solid surface here is the "frost" seam that made
    // the calendar read lighter than the rail.
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      {createError && (
        <div className="flex shrink-0 items-start gap-2 border-b border-signal bg-signal-soft px-3 py-2 text-caption text-signal">
          <span className="mt-px shrink-0">⚠</span>
          <span className="min-w-0 flex-1 break-words">{createError}</span>
          <button
            onClick={() => setCreateError(null)}
            className="fast shrink-0 rounded p-0.5 hover:opacity-70"
            aria-label="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

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
          allDay={draft.allDay}
          googleAvailable={googleAvailable}
          writableAccounts={writableGoogleAccounts}
          onCreate={handleCreate}
          onCancel={() => {
            setDraft(null);
            calRef.current?.getApi().unselect();
          }}
        />
      )}

      {/* ── Navigation bar — also fills the macOS titlebar zone (titlebar-pad)
            and hosts the window-drag handle on its empty spacer. ──────────── */}
      <div className="titlebar-pad relative flex shrink-0 items-center gap-1 px-3 py-1.5">
        {view !== "board" && (
        <>
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

        {/* Editorial masthead, centered in the bar like the mockup. Absolute so
            it's window-centered regardless of the nav/toggle widths, and
            pointer-events-none so the drag region beneath it still drags. */}
        <span className="masthead pointer-events-none absolute left-1/2 -translate-x-1/2 select-none text-lead leading-none text-text">
          {viewTitle}
        </span>

        <button
          onClick={() => calRef.current?.getApi().today()}
          className="fast ml-1 rounded border border-line px-2 py-0.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
          title="Go to today (Alt+T)"
        >
          Today
        </button>

        {onRefreshCalendars && (
          <button
            onClick={(e) => e.shiftKey && onFullRefreshCalendars ? onFullRefreshCalendars() : onRefreshCalendars()}
            disabled={refreshingCalendars}
            className="fast ml-1 flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink disabled:opacity-40"
            title="Refresh calendars (Shift+click to force full sync)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className={refreshingCalendars ? "animate-spin" : undefined}
            >
              <path
                d="M11.5 7A4.5 4.5 0 107.8 2.3M11.5 2.3v2.8H8.7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        </>
        )}

        <div data-tauri-drag-region className="flex-1 self-stretch" />

        {/* "This week" — the living-emblem button: an ambient gauge that fills
            across the week, and the door to the Week's Plan / Review floor. */}
        {onOpenWeekPlan && weekGlyph && (
          <button
            onClick={onOpenWeekPlan}
            className={`fast relative mr-1 flex items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-2.5 text-label font-medium ${
              weekButtonGlow ? "text-ink" : "border-line text-muted hover:border-line-strong hover:text-ink"
            }`}
            style={weekButtonGlow ? { borderColor: "var(--signal)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--signal) 18%, transparent)" } : undefined}
            title={weekButtonGlow ? "Your week is ready to review" : weekButtonLabel}
          >
            <WeekEmblem spec={weekGlyph} state="forming" size={22} hideAmbient />
            <span className="leading-none">{weekButtonLabel}</span>
            {weekButtonGlow && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ background: "var(--signal)" }} />}
          </button>
        )}

        {onViewChange && (
          <div className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2 p-0.5">
            {(["board", "timeGridDay", "timeGridWeek", "dayGridMonth"] as const).map((v) => {
              const on = view === v;
              return (
                <button
                  key={v}
                  onClick={() => onViewChange(v)}
                  className="fast rounded-full px-2.5 py-0.5 text-label leading-none"
                  style={{
                    background: on ? "var(--surface)" : "transparent",
                    color: on ? "var(--accent)" : "var(--muted)",
                    fontWeight: on ? 600 : 500,
                    boxShadow: on ? "var(--shadow-1)" : "none",
                  }}
                >
                  {v === "board" ? "Spread" : v === "timeGridDay" ? "Day" : v === "timeGridWeek" ? "Week" : "Month"}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── The Week Board — "which day" altitude, a toggle away from the grid ── */}
      {view === "board" && (
        <WeekBoard
          now={now}
          settings={settings}
          taskAccent={taskAccent}
          mutations={mutations}
          onOpenTask={onOpenTask}
        />
      )}

      {/* ── FullCalendar ────────────────────────────────────────────────── */}
      {view !== "board" && (
      <div
        ref={wrapRef}
        className="min-h-0 flex-1 p-2"
        style={{ "--nuvo-hour": `${pxPerHour}px` } as React.CSSProperties}
      >
        <FullCalendar
          ref={calRef}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView={view}
          headerToolbar={false}
          allDaySlot={!isMonth}
          allDayText="anytime"
          firstDay={settings?.week_start ?? 0}
          nowIndicator={!isMonth}
          nowIndicatorContent={(arg) =>
            arg.isAxis ? (
              <span className="whitespace-nowrap pr-1 text-micro font-semibold leading-none tabular-nums text-signal">
                {format(now, "h:mma").toLowerCase()}
              </span>
            ) : null
          }
          {...(!isMonth && {
            slotMinTime: `${String(viewStart).padStart(2, "0")}:00:00`,
            slotMaxTime: `${String(viewEnd).padStart(2, "0")}:00:00`,
            slotDuration: "00:15:00",
            snapDuration: "00:15:00",
            slotLabelInterval: "01:00",
            slotLabelFormat: { hour: "numeric", hour12: true, meridiem: "short" },
            eventTimeFormat: { hour: "numeric", minute: "2-digit", hour12: true, meridiem: "short" },
            scrollTime: `${String(Math.max(viewStart, Math.min(now.getHours() - 1, viewEnd - 1))).padStart(2, "0")}:00:00`,
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
                {/* Editorial serif numerals — judicious Fraunces, the day's anchor.
                    Today is marked by accent ink + a small dot, not a heavy chip. */}
                <span
                  className="masthead tabular-nums leading-none"
                  style={{ fontSize: "20px", color: isToday ? "var(--accent)" : "var(--text)" }}
                >
                  {dateNum}
                </span>
                {isToday && (
                  <span className="h-1 w-1 rounded-full" style={{ background: "var(--accent)" }} />
                )}
              </div>
            );
          }}
          height="100%"
          expandRows={!isMonth}
          dayMaxEvents={isMonth ? 4 : false}
          events={draftPreviewEvent ? [...fcEvents, draftPreviewEvent] : fcEvents}
          editable
          droppable
          selectable={!isMonth}
          selectMirror
          unselectAuto={false}
          selectMinDistance={5}
          select={onSelect}
          dateClick={onDateClick}
          eventReceive={onReceive}
          eventDrop={onDrop}
          eventResize={onResize}
          eventDragStop={onDragStop}
          eventClick={onClick}
          eventContent={renderEvent}
          datesSet={handleDatesSet}
        />
      </div>
      )}
    </div>
  );
}

function minutesToDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The two-arrow repeat glyph marking a block as part of a series. */
function RecurMark({ className = "" }: { className?: string }) {
  return (
    <svg width="9" height="9" viewBox="0 0 14 14" fill="none" className={className}>
      <path d="M3 5a4 4 0 016.9-2.7M11 9a4 4 0 01-6.9 2.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 1.5V4H7.5M4 12.5V10h2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
