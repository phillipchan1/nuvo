import { format } from "date-fns";
import { Icon } from "./Icon";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import type { DatesSetArg, DateSelectArg, DayCellContentArg, EventApi, EventClickArg, EventContentArg, EventDropArg, EventInput, EventMountArg } from "@fullcalendar/core";
import type { DateClickArg, EventReceiveArg, EventResizeDoneArg, EventDragStopArg } from "@fullcalendar/interaction";
import { restingStatus, type CalendarAccount, type ExternalEvent, type RecurrenceScope, type Slot, type Task, type UserSettings } from "../lib/types";
import { DEFAULT_DURATION_MINUTES } from "../lib/types";
import { firstDayOfWeek } from "../hooks/useSettings";
import { allDayDates, allDayRangeFromStart, allowAnytimeLanding, endOf, isOverdue, parseDateISO, spanFromCalendarDrop, toDateISO, todayISO, toFcInstant } from "../lib/dates";
import { resolveCompleteTarget } from "../lib/completeTarget";
import { addDays, startOfDay } from "date-fns";
import { eventRRule, expandRule } from "../lib/recurrence";
import type { useTaskMutations } from "../hooks/useTasks";
import { useEventDetails, useHiddenEvents, usePrefetchEventDetails, type useExternalEventMutations } from "../hooks/useCalendar";
import { eventSeriesKey, isExternalEventRecurring, resolveRecurringEventId } from "../lib/now";
import { clearCalendarReveal, onCalendarReveal, pendingCalendarReveal } from "../lib/calendarReveal";
import { synClass } from "../lib/syntax";
import { createDefaults, isWritableAccount, isWritableCalendar, pickCreateTarget, providerLabel, writableCalendarTargets, type CreateTarget } from "../lib/calendarWrite";
import { isPendingEventCreate } from "../lib/eventWriteback";
import type { useSlotMutations } from "../hooks/useSlots";
import { HORIZON_DAYS, type useRecurrenceMutations } from "../hooks/useRecurrence";
import DraftComposer, { type CreateDraft, type CreateKind } from "./DraftComposer";
import { CalendarTargetList, useCreateTargets } from "./calendar/EventCalendarPicker";
import { DeferCard } from "./DeferCard";
import { at, span } from "./mobile/dayPlan";
import TaskActionsMenu from "./tasks/TaskActionsMenu";
import { TaskDateMenu, TaskMoveMenu } from "./tasks/TaskMenus";
import { RecurMark } from "./ui";
import WeekEmblem from "./floors/WeekEmblem";
import WeekBoard from "./floors/WeekBoard";
import CalendarYear from "./CalendarYear";
import type { EmblemSpec } from "../lib/weekEmblem";
import { useWeather, indexWeather, type WeatherDay } from "../hooks/useWeather";
import WeatherIcon from "./WeatherIcon";
import WeatherPopover from "./WeatherPopover";
import TimeZoneChip from "./TimeZoneChip";
import { fixedCssPx, useUiScale } from "../hooks/useUiScale";
import { useOptionalUndoStack } from "../hooks/useUndoStack";
import { consumeCalendarClickHandled } from "../lib/calendarDismissGuard";
import { isTypingIn } from "../lib/a11y";
import { announce } from "../lib/announce";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useTaskListKeys } from "./tasks/useTaskListKeys";
import { claimKeys, keyOwner } from "./tasks/keyOwner";
import { usePriorityAct, useRenameAct } from "./tasks/TaskMenus";
import {
  DRAFT_PREVIEW_ID,
  gridBlocks,
  homeBlockId,
  shiftForKey,
  shiftSpan,
  type BlockShift,
  type GridBlock,
} from "./calendar/blockKeys";
import { createGestureCancel, type GestureCancel } from "./calendar/gestureCancel";
// One rule for "how big is this block", shared with the chat's `create_slot`.
import { sizeSlotToContents } from "../../supabase/functions/_shared/slotSizing.ts";
import { skipWhenAsleep } from "./KeepAlive";
import { useStableHandler } from "../hooks/useStableHandler";
import { syncCalendarEvents, type CalendarBlockInput } from "../lib/syncCalendarEvents";
import { gridSyncPlan } from "../lib/calendarGridSync";
// One spelling for what a block IS — shared with Plan the week's grid.
import {
  adjacentPreviewRect,
  blockDesignation,
  resolveSlotDrop,
  slotDropZoneFromPointer,
  type SlotDropIntent,
  type SlotDropZone,
} from "../lib/slots";

/** Hoisted. A fresh array literal here re-created the `<FullCalendar>` element on
 *  every render, and FullCalendar re-measures the entire grid on every render. */
const FC_PLUGINS = [timeGridPlugin, dayGridPlugin, interactionPlugin];

export type CalView = "timeGridWeek" | "timeGridDay" | "dayGridMonth" | "board" | "year";

/** Views that aren't FullCalendar at all — they own their own canvas, so every
 *  `calRef.getApi()` path (paging, today, resize, drag wiring) has to stand
 *  down for them. Named once so a third one can't half-join the family. */
const NON_FC_VIEWS: CalView[] = ["board", "year"];
const isFcView = (v: CalView) => !NON_FC_VIEWS.includes(v);

/** Draft preview sorts ahead of real blocks in month overflow. */
function draftPreviewFirst(a: unknown, b: unknown): number {
  const ai = (a as EventApi).id;
  const bi = (b as EventApi).id;
  if (ai === DRAFT_PREVIEW_ID) return -1;
  if (bi === DRAFT_PREVIEW_ID) return 1;
  return 0;
}

/** SUN…SAT, indexed by day-of-week, in the viewer's locale. Built off a known
 *  Sunday read in UTC so the label can never slide a day on either side of the
 *  date line — Month's headers are weekday names, and this is the only place
 *  that spells them. */
const DOW_LABELS = Array.from({ length: 7 }, (_, i) =>
  new Date(Date.UTC(2024, 0, 7 + i))
    .toLocaleDateString([], { weekday: "short", timeZone: "UTC" })
    .toUpperCase(),
);

type ExtendedProps = {
  kind: "task" | "google" | "m365" | "ics" | "icloud" | "slot";
  refId: string;
  calColor?: string;
  /** Solid color of the 3px accent bar (domain / calendar / slot color). */
  barColor?: string;
  recurringEventId?: string;
  /** Part of a repeating series (task/slot occurrence or Google instance). */
  recurring?: boolean;
  /** Baked-in done state so FC re-renders event content when status toggles. */
  done?: boolean;
  /** Project-backed task — renders as a "project slot" (thicker bar + ▸ marker). */
  projectBacked?: boolean;
  /** The project a sitting is FOR — carried so the block can wear its
   *  designation (`PROJECT · Frontier Site`) when its own title doesn't say it. */
  projectName?: string | null;
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

// Google's web client accepts a base64 "{event_id} {calendar_id}" eid — no
// official API for it, but the format is stable and widely relied on.
function googleEventUrl(eventId: string, calendarId: string): string {
  const eid = btoa(`${eventId} ${calendarId}`).replace(/=+$/, "");
  return `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eid)}`;
}

/** The delete menu's rows, in the order ↑↓ walks them. */
const DELETE_SCOPES: RecurrenceScope[] = ["THIS", "FOLLOWING", "ALL"];

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
    { value: "FOLLOWING", label: "This and following events", sub: "Earlier occurrences stay as they were" },
    { value: "ALL", label: "All events in series", sub: "Every occurrence shifts by the same amount" },
  ];

  // A keyboard nudge of a series (⌥↓ on its block, D-158) lands here, so the
  // question answers the keyboard: ↑↓ pick, ↵ done, Esc cancel.
  const live = useRef({ scope, onConfirm, onCancel });
  live.current = { scope, onConfirm, onCancel };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { scope, onConfirm, onCancel } = live.current;
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onConfirm(scope);
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const order: RecurrenceScope[] = ["THIS", "FOLLOWING", "ALL"];
        const step = e.key === "ArrowDown" ? 1 : order.length - 1;
        setScope((s) => order[(order.indexOf(s) + step) % order.length]);
      }
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <>
      <div
        data-nested-surface=""
        className="fixed inset-0 z-50 bg-black/25"
        onClick={onCancel}
      />
      <div data-nested-surface="" className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="pop-in pointer-events-auto bg-surface border border-line rounded-[var(--radius-lg)] w-[300px] p-5 elev-3">
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
              className="fast px-3 py-1.5 text-caption font-medium bg-accent text-on-accent rounded-[var(--radius-sm)] hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// The time-grid's date + scroll survive CalendarPane remounting (the Year
// isn't an FC view, so drilling out remounts the grid on `initialDate`). Floors
// used to unmount the whole pane; they now hide it. One CalendarPane per shell.
const remountCache: { dateISO: string | null; scrollTop: number | null } = {
  dateISO: null,
  scrollTop: null,
};

/** Paint a block's done state on the event element this frame.
 *
 *  Checking a box used to wait for React to rebuild `fcEvents` and FullCalendar
 *  to reconcile the whole grid — a hundred-millisecond hitch with the check
 *  appearing after it. `.evt-done` on the harness is the whole visual (fill,
 *  mark, strike, dim), so this class toggle is the click. The cache write is
 *  deferred until after paint so it cannot steal the frame. */
function paintCalendarTaskDone(el: HTMLElement, done: boolean) {
  el.classList.toggle("evt-done", done);
  const btn = el.querySelector<HTMLElement>("[data-done-toggle]");
  if (!btn) return;
  btn.classList.remove("bloom");
  if (done) {
    void btn.offsetWidth;
    btn.classList.add("bloom");
  }
}

/** Keep a floating menu on screen by MEASURING it. The menus here used to clamp
 *  against a guessed height, so a writable recurring event's menu (~300px)
 *  near the bottom edge lost "Delete all events in series" off-screen. Client
 *  px in; CSS px out (UI zoom corrected, like every fixed layer here). `key`
 *  re-measures when the menu's body changes shape (a step expanding in place). */
function useOnScreen(ref: React.RefObject<HTMLElement | null>, x: number, y: number, key: string) {
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    const { width, height } = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
    const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  }, [ref, x, y, key]);
  return { left: fixedCssPx(pos.left), top: fixedCssPx(pos.top) };
}

// ── Main component ─────────────────────────────────────────────────────────
function CalendarPane({
  view,
  tasks,
  events,
  slots,
  slotTasks,
  accounts,
  settings,
  now,
  taskAccent,
  taskDomain,
  slotTitle,
  slotProject,
  taskProject,
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
  onWeekWorkPlaced,
  resolveDropTask,
  onConvertTaskToEvent,
  onConvertEventToTask,
  onViewChange,
  hotkeysEnabled = true,
  weekGlyph,
  onOpenWeekPlan,
  weekButtonLabel,
  weekButtonTitle,
  weekButtonGlow,
  focusMode = false,
  onToggleFocus,
  domains = [],
  onOpenUpkeep,
}: {
  view: CalView;
  onViewChange?: (v: CalView) => void;
  /** Schedule hotkeys (view switch + paging) stand down while a modal owns the screen. */
  hotkeysEnabled?: boolean;
  /** False while a floor covers the Schedule — skip reconciling the grid. */
  live?: boolean;
  /** The living emblem for the current week — the toolbar's ambient gauge + door. */
  weekGlyph?: EmblemSpec | null;
  onOpenWeekPlan?: () => void;
  /** Short toolbar label for the week door: "Plan" / "This week" / "Review". */
  weekButtonLabel?: string;
  /** Longer tooltip for the week door (hover). Falls back to the short label. */
  weekButtonTitle?: string;
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
  /** The project a slot is reserved for, and the hue it inherits — so a project
   *  sitting can name its kind on the grid instead of wearing a bare `▸`. */
  slotProject?: (s: Slot) => { name: string; color: string | null } | null;
  /** The project a task belongs to, by name — worn on its block's second line. */
  taskProject?: (t: Task) => string | null;
  mutations: ReturnType<typeof useTaskMutations>;
  eventMutations: ReturnType<typeof useExternalEventMutations>;
  slotMutations: ReturnType<typeof useSlotMutations>;
  recurrenceMutations: ReturnType<typeof useRecurrenceMutations>;
  onRefreshCalendars?: () => void;
  onFullRefreshCalendars?: () => void;
  refreshingCalendars?: boolean;
  onOpenTask: (t: Task, anchor: DOMRect, anchorEl?: HTMLElement | null) => void;
  onOpenEvent: (e: ExternalEvent, anchor: DOMRect, anchorEl?: HTMLElement | null) => void;
  /** `focusTitle` opens the popover with the name selected — used when a drop
   *  just MADE the block, so naming it is the same gesture, not a second one. */
  onOpenSlot: (
    s: Slot,
    anchor: DOMRect,
    anchorEl?: HTMLElement | null,
    opts?: { focusTitle?: boolean },
  ) => void;
  /** Where a task's hours actually count (`taskDomainId`) — the affinity a
   *  block picks up from its contents. Never `task.domain_id` (D-088). */
  taskDomain: (t: Task) => string | null;
  onRangeChange: (startISO: string, endISO: string) => void;
  railRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Rows carrying `data-task-week` are this week's project work being placed by
   *  hand. Commit them to the week alongside the block, or the placement writes a
   *  `do_date` with no `sprint_id` and slips past the Week gate (P2). */
  onWeekWorkPlaced?: (taskIds: string[]) => void;
  /** Last-resort lookup for a dropped row that isn't in `tasks`.
   *
   *  `tasks` is the RENDER set — inbox · today · sprint · scheduled · anytime ·
   *  slot children. A project's backlog work is in none of those (no `do_date`,
   *  no `start_time`, no `sprint_id`), so when the week crown started offering it
   *  for drag, every drop resolved to nothing and silently reverted: the row
   *  looked draggable and could not be scheduled. Kept separate from `tasks`
   *  rather than folded into it, because that set also drives `fcEvents` — widening
   *  it to fix a lookup would start rendering work that has no time yet. */
  resolveDropTask?: (id: string) => Task | undefined;
  /** Task → Event. `target` is the calendar picked in the menu; omitted when
   *  there is only one calendar to offer. */
  onConvertTaskToEvent?: (task: Task, target?: CreateTarget) => void;
  onConvertEventToTask?: (event: ExternalEvent) => void;
  /** Focus mode is on — toolbar shows a slim "Show panels" exit (⌘. still toggles). */
  focusMode?: boolean;
  /** Toggle focus mode (slide the side panels away / back). Enables the exit button. */
  onToggleFocus?: () => void;
  /** Domains offered on the Slot create dialog (standing "domain slots"). */
  domains?: Array<{ id: string; name: string; color: string }>;
  onOpenUpkeep?: () => void;
}) {
  const calRef = useRef<FullCalendar>(null);
  const { scale: uiScale } = useUiScale();
  const { recordUndo } = useOptionalUndoStack();
  const [utilsOpen, setUtilsOpen] = useState(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  // While a drag is live, defer FullCalendar reconciles and freeze the clock
  // used for overdue tints — both were moving blocks under the pointer.
  const gridSyncPausedRef = useRef(false);
  const pendingGridSyncRef = useRef<readonly CalendarBlockInput[] | null>(null);
  const [fcNow, setFcNow] = useState(now);
  const fcNowRef = useRef(fcNow);
  fcNowRef.current = fcNow;
  // Mount-only for FullCalendar, but the element may be rebuilt later (a month
  // toggle) — a ref keeps it current without making `view` a memo dependency.
  const viewRef = useRef(view);
  viewRef.current = view;
  const fcFirstDay = firstDayOfWeek(settings);
  const pauseGridSync = useCallback(() => {
    gridSyncPausedRef.current = true;
  }, []);
  // `now` through a ref, so this — and the FullCalendar handlers built on it —
  // keep one identity for the pane's life. It used to depend on `now`, which
  // ticks every 30s, and `onFcResizeStop` sat in `calendarElement`'s deps: the
  // whole <FullCalendar> was re-created and re-measured twice a minute, drags
  // included (the 09-03 memo fix, quietly undone one callback away).
  const nowRef = useRef(now);
  nowRef.current = now;
  const resumeGridSync = useCallback(() => {
    if (!gridSyncPausedRef.current) return;
    gridSyncPausedRef.current = false;
    // The overdue clock catches up AFTER the drop's cache patch has rendered.
    // Setting it here scheduled a render that ran first, with the pre-drop
    // tasks, and the sync put the block back at its old time for a frame.
    if (fcNowRef.current !== nowRef.current) {
      window.setTimeout(() => {
        if (!gridSyncPausedRef.current) setFcNow(nowRef.current);
      }, 300);
    }
    const api = calRef.current?.getApi();
    const pending = pendingGridSyncRef.current;
    pendingGridSyncRef.current = null;
    if (api && pending) syncCalendarEvents(api, pending);
  }, []);
  const pauseGridSyncRef = useRef(pauseGridSync);
  pauseGridSyncRef.current = pauseGridSync;
  const resumeGridSyncRef = useRef(resumeGridSync);
  resumeGridSyncRef.current = resumeGridSync;
  useEffect(() => {
    if (!gridSyncPausedRef.current) setFcNow(now);
  }, [now]);
  // Slot under the pointer during a task drag — id + whether the drop is into the
  // slot or beside it (left/right edge bands). onReceive reads this to prefer the
  // highlighted target over time-range math, which breaks when FC snaps the ghost
  // adjacent to the slot to avoid overlap.
  const slotDropIntentRef = useRef<SlotDropIntent | null>(null);
  // Frozen at pointer-up so async FullCalendar drops still read the edge zone.
  const committedSlotDropIntentRef = useRef<SlotDropIntent | null>(null);
  // The multi-selection being dragged, captured at drag START rather than read
  // off the DOM at drop time. The rail clears `selectedIds` when the gesture
  // ends, which re-renders the rows without their `data-task-drag-group` — a
  // race that made a four-row drag land as one task. What the user picked up is
  // decided once, when they pick it up.
  const dragGroupRef = useRef<string[] | null>(null);
  // Where the pointer last was during a drag — `eventReceive` carries no mouse
  // event, and a popover opened by a drop has to appear where the drop landed.
  const dropPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;
  const resolveDropTaskRef = useRef(resolveDropTask);
  resolveDropTaskRef.current = resolveDropTask;

  /** Slot drop intent captured during drag — recomputed from the last pointer
   *  position if FullCalendar consumed the live ref before firing. */
  const takeSlotDropIntent = (): SlotDropIntent | null => {
    let intent = committedSlotDropIntentRef.current ?? slotDropIntentRef.current;
    committedSlotDropIntentRef.current = null;
    slotDropIntentRef.current = null;
    if (intent) return intent;
    const { x, y } = dropPointRef.current;
    for (const el of document.querySelectorAll<HTMLElement>(".fc-event.evt-slot[data-slot-id]")) {
      const r = el.getBoundingClientRect();
      const zone = slotDropZoneFromPointer(r, x, y);
      const slotId = el.getAttribute("data-slot-id");
      if (zone && slotId) return { slotId, zone };
    }
    return null;
  };

  /** A dropped id → its task. The render set first, then the wider lookup for
   *  rows that live outside it (project backlog offered by the week crown).
   *  Reads only refs, so it's safe to call from a long-lived drag listener. */
  const resolveDroppedTask = (id: string): Task | undefined =>
    tasksRef.current.find((t) => t.id === id) ?? resolveDropTaskRef.current?.(id);

  // Month and Year have no other orientation cue (Week/Day are covered by the
  // "THIS WEEK" rail label) — without a title, paging ‹ › leaves no way to
  // tell which span you're looking at. The Year's numeral lives here, not as
  // an in-pane masthead, so the chrome says the year once (D-123 / D-129).
  const [monthTitle, setMonthTitle] = useState("");
  // What's drawn (activeStart → activeEnd) — where j / k start from (D-158).
  const [visibleSpan, setVisibleSpan] = useState({ start: 0, end: 0 });

  // Hidden events (Fantastical-style): kept off the board + out of the busy math.
  // `showHidden` reveals them dimmed so you can bring one back. The context menu /
  // popover toggle the per-event hidden state.
  const { keys: hiddenKeys, isHidden, hiddenKeyFor, hide, unhide } = useHiddenEvents();
  const prefetchEventDetails = usePrefetchEventDetails();
  const [showHidden, setShowHidden] = useState(false);
  // `intent: "delete"` — opened by ⌫ on the block: straight to the delete step
  // (the series' scope, or the confirm that says who gets told).
  const [eventMenu, setEventMenu] = useState<{
    x: number;
    y: number;
    event: ExternalEvent;
    el: HTMLElement;
    intent?: "delete";
  } | null>(null);
  const eventMenuAccountEmail = accounts.find((a) => a.id === eventMenu?.event.account_id)?.email;
  const { data: eventMenuDetails } = useEventDetails(eventMenu?.event.id ?? null, eventMenuAccountEmail);
  const eventMenuOtherGuests = useMemo(
    () => (eventMenuDetails?.attendees ?? []).filter((a) => !a.self),
    [eventMenuDetails],
  );
  const eventMenuCancelNotifies =
    eventMenuDetails?.organizer?.self === true && eventMenuOtherGuests.length > 0;
  const eventMenuHasInvitees = eventMenuOtherGuests.length > 0;
  // Delete is a hard API call — confirm in-place rather than firing on one click.
  const [eventDeleteConfirm, setEventDeleteConfirm] = useState<RecurrenceScope | null>(null);
  // Right-click "Move to…" — expands to a grouped calendar/account list in place;
  // a lossy cross-account pick asks to confirm the copy.
  const [eventMoveMode, setEventMoveMode] = useState(false);
  const [eventMoveConfirm, setEventMoveConfirm] = useState<{ accountId: string; calendarId: string; name: string } | null>(null);
  // A project was just sat on the week, and some of its work already had a time
  // somewhere else. The sitting is placed; this asks whether to bring the rest
  // in. Nothing that's already on the grid moves until it's pressed (P3).
  const [gatherOffer, setGatherOffer] = useState<{
    point: { x: number; y: number };
    slot: Slot;
    name: string;
    tasks: Task[];
  } | null>(null);
  // A block's right-click is the SAME menu every task list offers
  // (TaskActionsMenu) — the calendar used to carry a five-item copy.
  // `startInDelete` — ⌫ on a series' block opens the menu on its scope question.
  const [taskMenu, setTaskMenu] = useState<{
    x: number;
    y: number;
    task: Task;
    el: HTMLElement;
    startInDelete?: boolean;
  } | null>(null);
  const closeTaskMenu = useCallback(() => setTaskMenu(null), []);
  // Its `t` / `v` menus, anchored on the block.
  // `t` / `v` on a selection hit every task in it, as in a list.
  const [taskRowMenu, setTaskRowMenu] = useState<{ kind: "date" | "move"; targets: Task[]; anchor: DOMRect } | null>(null);
  const closeTaskRowMenu = useCallback(() => setTaskRowMenu(null), []);
  // Task → Event asking which calendar (D-152), opened from the menu's item.
  const [taskEventPick, setTaskEventPick] = useState<{ x: number; y: number; task: Task } | null>(null);
  const [slotMenu, setSlotMenu] = useState<{ x: number; y: number; slot: Slot; el: HTMLElement } | null>(null);

  // Can the user create real calendar events? True when any writable account
  // (Google or iCloud two-way) is connected.
  const canCreateEvents = useMemo(
    () => accounts.some((a) => isWritableAccount(a)),
    [accounts],
  );
  // Where Task → Event may put the event, and where it goes unasked.
  const createTargets = useCreateTargets();

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

  // FullCalendar preventDefaults mousedown (so a drag can't select text), which
  // also means a press on the grid never takes focus away from a text field —
  // capture a task in the rail, click the calendar, press `w`, and the `w` went
  // into the capture box. A press in the grid is a move to the grid: let go of
  // a field that isn't part of it.
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const onDown = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !root.contains(active) && isTypingIn(active)) active.blur();
    };
    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
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
    let raf = 0;
    const ro = new ResizeObserver(() => {
      setAvailH(el.clientHeight);
      // FullCalendar caches its own width and only reflows on a WINDOW resize,
      // so a container that changes width on its own — the Nuvo panel sliding
      // open or shut — leaves the grid stranded at its old width, with a blank
      // strip where the days should be, until something else nudges it. This
      // observer already fires for that; it just never told FC. Coalesced to
      // one call per frame so the slide reflows smoothly instead of thrashing.
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => calRef.current?.getApi()?.updateSize());
    });
    ro.observe(el);
    setAvailH(el.clientHeight);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // ── The grid's selection (D-158) ───────────────────────────────────────────
  // A block is selected by ID — never only by a class on its element. The lift
  // used to be `classList.add("evt-focused")` on whatever element was clicked,
  // and FullCalendar re-renders a block whenever the reconcile patches it: the
  // class it didn't put there was gone, so a block dropped its lift the moment
  // its own write landed, and no key could act on "the selected block" because
  // there wasn't one. The selection is state. It is painted two ways, both off
  // `gridSelRef`: imperatively on change (the lift lands the frame you click —
  // no re-parse of every event, which is what made the old event-model route
  // feel late), and through `eventClassNames`, so any render FullCalendar does
  // of its own keeps it. The cursor lifts to the front at full column width
  // (`evt-focused`, readable over its neighbours); the rest of a ⇧/⌘-click
  // selection lift in place (`evt-selected`).
  const [gridCursor, setGridCursor] = useState<string | null>(null);
  const [gridSelected, setGridSelected] = useState<ReadonlySet<string>>(() => new Set());
  const gridSelRef = useRef<{ cursor: string | null; ids: ReadonlySet<string> }>({ cursor: null, ids: new Set() });
  const paintGridSelection = (cursor: string | null, ids: ReadonlySet<string>) => {
    gridSelRef.current = { cursor, ids };
    const root = wrapRef.current;
    if (!root) return;
    root.querySelectorAll(".evt-focused, .evt-selected").forEach((el) => el.classList.remove("evt-focused", "evt-selected"));
    const mark = (id: string, cls: string) =>
      root.querySelectorAll(`[data-block-id="${CSS.escape(id)}"]`).forEach((el) => el.classList.add(cls));
    ids.forEach((id) => id !== cursor && mark(id, "evt-selected"));
    if (cursor) mark(cursor, "evt-focused");
  };
  useLayoutEffect(() => {
    paintGridSelection(gridCursor, gridSelected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridCursor, gridSelected]);
  /** Light one block (a click, j / k, a fresh copy) — painted now, not next render. */
  const selectBlock = (id: string | null) => {
    const none: ReadonlySet<string> = new Set();
    paintGridSelection(id, none);
    setGridCursor(id);
    setGridSelected(none);
  };
  /** ⇧/⌘-click: add the block to the selection, or take it back out. */
  const toggleBlock = (id: string) => {
    const { cursor, ids } = gridSelRef.current;
    const next = new Set(ids);
    if (cursor) next.add(cursor);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const nextCursor = next.has(id) ? id : ([...next].pop() ?? null);
    paintGridSelection(nextCursor, next);
    setGridCursor(nextCursor);
    setGridSelected(next);
  };
  const clearGridSelection = () => {
    const { cursor, ids } = gridSelRef.current;
    if (cursor || ids.size) selectBlock(null);
  };

  // A press anywhere that isn't a block — empty grid, the rail, the toolbar,
  // another floor — moves on from the selection, and a press in this pane hands
  // it the keyboard (`keyOwner`; the rail puts its own cursor down for the same
  // press). The block's popover and any floating surface (a menu, the rename
  // field) count as still being on the block: dropping the lift under an open
  // popover shifted the popover anchored to it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-calendar-pane]")) claimKeys("grid");
      if (t?.closest?.(".fc-event, [data-block-popover], [data-nested-surface]")) return;
      clearGridSelection();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc mid-drag (#32) — one controller for every gesture on the grid.
  const gestureRef = useRef<GestureCancel | null>(null);
  if (!gestureRef.current && typeof document !== "undefined") gestureRef.current = createGestureCancel();
  useEffect(() => () => gestureRef.current?.dispose(), []);

  // Live ghost while dragging any all-day range — the month grid, or the
  // anytime row in week/day view (both render `.fc-daygrid-day` cells under
  // the hood, month via dayGrid, the anytime row via the same daygrid table
  // FC's timeGrid view reuses for its all-day section). FullCalendar's own
  // selectMirror only draws a flat cell tint for dayGrid (verified empirically —
  // it never renders a mirror event there, only for timeGrid), so without this
  // an all-day drag looks like nothing until you release. Runs a plain
  // mousedown/mousemove/mouseup watch alongside FC's own (untouched) selection
  // handling — same pointer-tracking idiom as the Timeline/board drag pattern,
  // since this is a visual overlay FC doesn't offer here, not a replacement for
  // FC's own `select`/`onSelect` (still the source of truth on release).
  const [allDayDragRange, setAllDayDragRange] = useState<{ start: Date; end: Date } | null>(null);
  useEffect(() => {
    if (!isFcView(view)) return; // no FullCalendar canvas at all
    const root = wrapRef.current;
    if (!root) return;

    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".fc-event")) return;
      // Snapshot every cell's rect once, up front, and hit-test against those —
      // not `elementFromPoint`, which during the drag resolves to whatever FC's
      // own `.fc-highlight` selection overlay (or our ghost) is sitting on top
      // of at that pixel, not the day cell actually under the cursor. In
      // week/day view this only ever finds the anytime row's cells — the timed
      // columns are `.fc-timegrid-col`, a different structure entirely.
      const cells = Array.from(root.querySelectorAll<HTMLElement>(".fc-daygrid-day[data-date]")).map((el) => ({
        date: el.dataset.date!,
        rect: el.getBoundingClientRect(),
      }));
      const cellAt = (x: number, y: number) =>
        cells.find((c) => x >= c.rect.left && x < c.rect.right && y >= c.rect.top && y < c.rect.bottom)?.date ?? null;
      const anchor = cellAt(e.clientX, e.clientY);
      if (!anchor) return;
      pauseGridSyncRef.current();
      let current = anchor;
      let lastKey = "";
      let dragRaf = 0;
      let pendingRange: { start: Date; end: Date } | null = null;
      const flushAllDay = () => {
        dragRaf = 0;
        if (pendingRange) setAllDayDragRange(pendingRange);
      };
      const onMove = (ev: MouseEvent) => {
        const date = cellAt(ev.clientX, ev.clientY);
        if (date) current = date;
        const startISO = anchor <= current ? anchor : current;
        const endISO = !canCreateEvents ? startISO : anchor <= current ? current : anchor;
        const key = `${startISO}:${endISO}`;
        if (key === lastKey) return;
        lastKey = key;
        pendingRange = { start: parseDateISO(startISO), end: parseDateISO(endISO) };
        if (!dragRaf) dragRaf = requestAnimationFrame(flushAllDay);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (dragRaf) cancelAnimationFrame(dragRaf);
        setAllDayDragRange(null);
        resumeGridSyncRef.current();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    root.addEventListener("mousedown", onMouseDown);
    return () => root.removeEventListener("mousedown", onMouseDown);
  }, [view, canCreateEvents]);

  const defaultDurationMins = settings?.default_task_duration_minutes ?? DEFAULT_DURATION_MINUTES;
  const showWeather = settings?.show_weather ?? false;
  const { data: weatherData } = useWeather(showWeather);
  const weatherIndex = useMemo(() => indexWeather(weatherData?.days), [weatherData]);
  const [wxPopover, setWxPopover] = useState<{ day: WeatherDay; anchor: { x: number; y: number } } | null>(null);

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
  // −28: the anytime row's resting height. Ignoring it made "fit N hours"
  // always fit a little under N.
  const pxPerHour =
    availH > 160 ? Math.max(26, Math.min(190, (availH - 16 - 52 - 28) / fitClamped)) : 52;
  const densityRef = useRef(pxPerHour);
  densityRef.current = pxPerHour;

  // ── Year state ────────────────────────────────────────────────────────────
  // Declared up here, above the hotkey effect, because the paging keys have to
  // reach it: the Year has no FullCalendar api, so ‹ › and ⌘T move a cursor
  // instead. The Year itself draws no calendar data (D-128) — just the map.
  const [yearCursor, setYearCursor] = useState(() => now.getFullYear());
  // Mount the Year on first use and never unmount it again. 365 cells cost
  // ~150ms to build, which is fine once and awful per click — but mounting it
  // eagerly would move that onto app boot, where nobody has asked for a year
  // yet. Latched, never cleared: the second visit is a class toggle.
  const [yearEverOpened, setYearEverOpened] = useState(view === "year");
  /** Host size FullCalendar was last laid out at, so a reveal only reflows when
   *  the box really changed. See the changeView effect. */
  const fcSizeRef = useRef({ w: 0, h: 0 });
  useEffect(() => {
    if (view === "year") setYearEverOpened(true);
  }, [view]);

  // One place paging is decided, so the toolbar buttons, the hotkeys and the
  // trackpad gesture can't drift into three different ideas of "next".
  const pageBy = (dir: -1 | 1) => {
    if (view === "year") setYearCursor((y) => y + dir);
    else calRef.current?.getApi()?.[dir === 1 ? "next" : "prev"]();
  };
  const pageToday = () => {
    if (view === "year") setYearCursor(now.getFullYear());
    else calRef.current?.getApi()?.today();
  };

  // Schedule hotkeys. Views always win on bare s / w / d / m / y (the rail's
  // triage letters moved off these). = / - page the period, as do ⌘→ / ⌘←; ⌘T
  // returns to today. In Spread there's nothing to page; the Year pages by year.
  useEffect(() => {
    if (!hotkeysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      // One guard for "typing" app-wide (it includes <select>, which this used
      // to miss), and nothing under a floating surface: `w` behind a block's
      // menu used to swap the view out from under it.
      if (isTypingIn(e.target) || e.defaultPrevented) return;
      if (document.querySelector("[data-nested-surface]")) return;

      if (e.metaKey || e.ctrlKey) {
        if (e.key === "ArrowLeft") { e.preventDefault(); pageBy(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); pageBy(1); }
        else if (e.key.toLowerCase() === "t") { e.preventDefault(); pageToday(); }
        return;
      }
      if (e.altKey) return;

      switch (e.key) {
        case "s": e.preventDefault(); onViewChange?.("board"); break;
        case "y": e.preventDefault(); onViewChange?.("year"); break;
        case "w": e.preventDefault(); onViewChange?.("timeGridWeek"); break;
        case "d": e.preventDefault(); onViewChange?.("timeGridDay"); break;
        case "m": e.preventDefault(); onViewChange?.("dayGridMonth"); break;
        case "=":
        case "+": e.preventDefault(); pageBy(1); break;
        case "-":
        case "_": e.preventDefault(); pageBy(-1); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeysEnabled, onViewChange, view, now]);

  // Trackpad horizontal swipe pages the period (Fantastical/Google Calendar
  // convention) — a mostly-horizontal wheel gesture goes to next/prev instead
  // of doing nothing (the grid has no native horizontal scroll to hijack).
  // Fires once per gesture: crossing the threshold locks further paging until
  // the gesture pauses (deltaX events stop for a beat), so one swipe = one page.
  useEffect(() => {
    if (!isFcView(view)) return; // no FC api to page
    const el = wrapRef.current;
    if (!el) return;
    const THRESHOLD = 60;
    let accumX = 0;
    let locked = false;
    let endTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical scroll — let it through
      e.preventDefault();
      if (endTimer) clearTimeout(endTimer);
      endTimer = setTimeout(() => { accumX = 0; locked = false; }, 150);
      if (locked) return;
      accumX += e.deltaX;
      const api = calRef.current?.getApi();
      if (accumX > THRESHOLD) { api?.next(); locked = true; }
      else if (accumX < -THRESHOLD) { api?.prev(); locked = true; }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (endTimer) clearTimeout(endTimer);
    };
  }, [view]);

  // External drag: any [data-task-drag] row in the left rail can be dropped
  // onto the grid — and, since the crown's rows are projects, any
  // [data-project-drag] row too. FullCalendar owns the drop geometry; we own the
  // state. In the board ("Spread") view there's no grid — WeekBoard owns rail-row
  // drags itself, so this FC draggable must stand down or it fights for the same rows.
  useEffect(() => {
    if (!railRef.current || !isFcView(view)) return;
    const draggable = new Draggable(railRef.current, {
      itemSelector: "[data-task-drag], [data-project-drag]",
      // A few px of slop so a click (or a cmd/shift multi-select) on a rail row
      // isn't misread as the start of a drag onto the grid.
      minDistance: 6,
      eventData: (el) => {
        // ── a PROJECT, dragged whole ──────────────────────────────────────
        // The preview has to be the thing you're about to get, not a generic
        // ghost: the in-grid mirror renders through the same `eventContent` as
        // a real block, so handing it slot-shaped props draws the sitting —
        // designation, project hue, the pieces it will hold — under the cursor
        // before you commit to a time.
        const projectId = el.getAttribute("data-project-drag");
        if (projectId) {
          dragGroupRef.current = null;
          const name = el.getAttribute("data-project-title") ?? "project";
          const hue = el.getAttribute("data-project-color") || "var(--slot)";
          const pieces = (el.getAttribute("data-project-tasks") ?? "")
            .split(",")
            .filter(Boolean)
            .map(resolveDroppedTask)
            .filter((t): t is Task => Boolean(t));
          return {
            title: name,
            duration: minutesToDuration(
              pieces.length > 0
                ? sizeSlotToContents(pieces.map((t) => t.duration_minutes))
                : defaultDurationMins,
            ),
            classNames: ["evt-slot"],
            // Same paint as the sitting it becomes (domain hue, not --slot).
            backgroundColor: `color-mix(in srgb, ${hue} 24%, var(--surface))`,
            borderColor: `color-mix(in srgb, ${hue} 62%, var(--line))`,
            extendedProps: {
              kind: "slot" as const,
              refId: "",
              calColor: "var(--slot)",
              barColor: hue,
              projectBacked: true,
              // The preview's title IS the project's name, so the designation
              // doesn't repeat it — the ghost has to read exactly like the block
              // it becomes, or the drop looks like it changed something.
              projectName: null,
              slotDone: 0,
              slotTotal: pieces.length,
              slotChildren: pieces.map((t) => ({ title: t.title, done: false })),
            },
            create: true,
          };
        }

        const taskId = el.getAttribute("data-task-drag");
        const groupAttr = el.getAttribute("data-task-drag-group");
        const groupIds = groupAttr?.split(",").filter(Boolean) ?? [];
        // Remember the selection now, while the rows are still rendered with it.
        dragGroupRef.current = groupIds.length > 1 ? groupIds : null;
        const group = dragGroupRef.current;
        return {
          // For single-task drops, give the FC event the same id that fcEvents
          // will generate ("task:<id>"). That way FC keeps the event exactly where
          // the user dropped it and fcEvents reconciles it in-place — no snap-back.
          ...(!group && taskId ? { id: `task:${taskId}` } : {}),
          title: group ? `${group.length} tasks` : (el.getAttribute("data-task-title") ?? "task"),
          // The ghost has to be the size of the block you're about to get, or it
          // lies about how much of the morning this claims. A group is one slot
          // sized to its contents; a single row is its own length.
          duration: minutesToDuration(
            group
              ? sizeSlotToContents(
                  group.map((id) => resolveDroppedTask(id)?.duration_minutes ?? null),
                )
              : Number(el.getAttribute("data-task-duration")) || defaultDurationMins,
          ),
          create: true,
          allDay: false,
          // Same paint as a real task block. Without this the drop ghost is
          // FullCalendar's default blue and looks like a second calendar event
          // if reconcile misses it for a frame.
          ...(!group ? { classNames: ["evt-task"], ...blockColors("var(--accent)", 22) } : {}),
          ...(!group && taskId
            ? {
                extendedProps: {
                  kind: "task" as const,
                  refId: taskId,
                  barColor: "var(--accent)",
                  recurring: false,
                  done: false,
                  projectBacked: Boolean(el.getAttribute("data-task-project")),
                },
              }
            : {}),
        };
      },
    });
    return () => draggable.destroy();
  }, [railRef, view]);

  // Live drop-target feedback while a task is being dragged. Classes are toggled
  // imperatively (no React state) so a drag never re-renders CalendarPane
  // mid-gesture (which could disturb FullCalendar's own drag/drop):
  //   body.cal-dragging           → drag is live (drop-hover styles may apply)
  //   body.over-slot              → fade the drag ghost (it's "dropping into" a slot)
  //   body.over-anytime           → fade FC's mirror; our anytime pill is the read
  //   .evt-slot.slot-drop-target  → the hovered slot lights up, ready to accept
  //   .slot-adjacent-preview      → ghost block at the landing spot beside a slot
  //   .fc-daygrid-day.anytime-drop-target → the anytime cell under the pointer
  //   .anytime-drop-preview       → titled pill preview of the anytime chip
  //   .rail-drop-active           → the left rail is highlighted as the Inbox zone
  // The slot/anytime/rail are hit-tested per move via geometry (the ghost is
  // pointer-events:none). CSS :hover alone was too quiet on the anytime row —
  // the frame covered the day wash, so dropping there felt like nowhere. Armed
  // for tasks only — dragging an event/slot stays quiet.
  useEffect(() => {
    let armed = false;
    let active = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let overSlot: HTMLElement | null = null;
    let overZone: SlotDropZone | null = null;
    let overAnytime: HTMLElement | null = null;
    let dragId: string | null = null; // external [data-task-drag] id (rail / slot popover row)
    let dragTitle: string | null = null; // frozen at pointerdown — DOM lookup mid-drag can miss
    let fromRail = false; // did this drag start inside the rail itself?
    let calTask = false; // calendar block being dragged (inbox via eventDragStop, not here)
    let overRail = false; // is the pointer currently over the rail?
    let returnLabel = "↩ Back to Inbox"; // what letting go over the rail does
    let dragTaskId: string | null = null; // the calendar block being moved, if a task
    const chip = document.createElement("div");
    chip.className = "slot-drop-chip";
    chip.setAttribute("aria-hidden", "true");
    document.body.appendChild(chip);
    const preview = document.createElement("div");
    preview.className = "slot-adjacent-preview";
    preview.innerHTML = '<span class="slot-adjacent-preview-bar" aria-hidden="true"></span><span class="slot-adjacent-preview-title"></span>';
    preview.setAttribute("aria-hidden", "true");
    document.body.appendChild(preview);
    const previewTitle = preview.querySelector(".slot-adjacent-preview-title") as HTMLElement;
    const anytimePreview = document.createElement("div");
    anytimePreview.className = "anytime-drop-preview";
    anytimePreview.innerHTML =
      '<span class="anytime-drop-preview-dot" aria-hidden="true"></span><span class="anytime-drop-preview-title"></span>';
    anytimePreview.setAttribute("aria-hidden", "true");
    document.body.appendChild(anytimePreview);
    const anytimePreviewTitle = anytimePreview.querySelector(".anytime-drop-preview-title") as HTMLElement;
    // Esc mid-gesture (#32): the drag can't be stopped, so the cursor says what
    // letting go will now do — nothing.
    const cancelChip = document.createElement("div");
    cancelChip.className = "slot-drop-chip drop-chip-cancel";
    cancelChip.textContent = "Release to cancel";
    cancelChip.setAttribute("aria-hidden", "true");
    document.body.appendChild(cancelChip);
    let lastX = 0;
    let lastY = 0;
    const gesture = gestureRef.current;

    const dragDurationMins = (): number => {
      if (dragId) {
        const dragEl = document.querySelector<HTMLElement>(`[data-task-drag="${CSS.escape(dragId)}"]`);
        const group = dragEl?.getAttribute("data-task-drag-group");
        if (group) {
          const ids = group.split(",").filter(Boolean);
          return sizeSlotToContents(
            ids.map((id) => resolveDroppedTask(id)?.duration_minutes ?? null),
          );
        }
        return Number(dragEl?.getAttribute("data-task-duration")) || defaultDurationMins;
      }
      // A calendar block knows its length — the ratio below (ghost height over a
      // neighbour's) fell back to the default next to a task and was inflated by
      // the ghost's 3% scale, so the preview and the landing disagreed.
      if (dragTaskId) {
        const t = tasksRef.current.find((x) => x.id === dragTaskId);
        if (t?.duration_minutes) return t.duration_minutes;
      }
      const mirror = document.querySelector<HTMLElement>(".fc-event-mirror, .fc-event-dragging");
      if (mirror) {
        const h = mirror.getBoundingClientRect().height;
        const col = mirror.closest<HTMLElement>(".fc-timegrid-col");
        const sample = col?.querySelector<HTMLElement>(".fc-event.evt-slot[data-slot-id], .fc-event.evt-task");
        if (sample && h > 0) {
          const slot = slotsRef.current.find((s) => s.id === sample.getAttribute("data-slot-id"));
          const sampleMins = slot?.duration_minutes ?? defaultDurationMins;
          const sampleH = sample.getBoundingClientRect().height;
          if (sampleH > 0) return Math.max(15, Math.round((h / sampleH) * sampleMins));
        }
      }
      return defaultDurationMins;
    };

    const dragLabel = (): string => {
      if (dragTitle) return dragTitle;
      if (dragId) {
        const dragEl = document.querySelector<HTMLElement>(`[data-task-drag="${CSS.escape(dragId)}"]`);
        const group = dragEl?.getAttribute("data-task-drag-group");
        if (group) return `${group.split(",").filter(Boolean).length} tasks`;
        return dragEl?.getAttribute("data-task-title")?.trim() || "Task";
      }
      const mirror = document.querySelector(".fc-event-mirror .fc-event-main, .fc-event-dragging .fc-event-main");
      return mirror?.textContent?.trim() || "Task";
    };

    const hideAdjacentPreview = () => {
      preview.classList.remove("is-visible");
      document.body.classList.remove("slot-adjacent-drop");
    };

    const hideAnytimePreview = () => {
      anytimePreview.classList.remove("is-visible");
    };
    const clearAnytimeTarget = () => {
      overAnytime?.classList.remove("anytime-drop-target");
      overAnytime = null;
      document.body.classList.remove("over-anytime");
      hideAnytimePreview();
    };

    /** The drop feedback, off — the glow, the chip, the previews. */
    const clearFeedback = () => {
      document.body.classList.remove("cal-dragging", "over-slot", "slot-adjacent-drop", "over-anytime");
      overSlot?.classList.remove("slot-drop-target", "slot-adjacent-anchor");
      overSlot = null;
      overZone = null;
      slotDropIntentRef.current = null;
      clearAnytimeTarget();
      chip.classList.remove("is-visible", "drop-chip-act");
      hideAdjacentPreview();
      railRef.current?.classList.remove("rail-drop-active", "rail-return-armed");
      if (moveRaf) {
        cancelAnimationFrame(moveRaf);
        moveRaf = 0;
      }
      pendingMove = null;
    };
    const hideCancel = () => {
      cancelChip.classList.remove("is-visible");
      document.body.classList.remove("drag-cancelled");
    };
    const reset = () => {
      clearFeedback();
      resumeGridSyncRef.current();
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      committedSlotDropIntentRef.current = null;
      // A resize handle or the checkbox is a press inside a block that isn't a
      // move — arming on it faded the resize ghost over slots and offered
      // "↳ Drop into…" for a gesture that can't drop anything.
      // The draft's ghost isn't a task: moving it adjusts the draft, and it can't
      // drop into a slot or go back to the Inbox.
      armed =
        Boolean(el?.closest?.("[data-task-drag], [data-project-drag], .evt-task")) &&
        !el?.closest?.(".fc-event-resizer, [data-done-toggle], .evt-draft-preview");
      // A project row is a rail-origin drag like any other — it just has no task
      // id to return to the Inbox. Resolving `dragEl` off both attributes is what
      // makes `fromRail` true for it, which is what eats the phantom click that
      // would otherwise open the project record the moment you let go.
      const dragEl = el?.closest?.("[data-task-drag], [data-project-drag]") as HTMLElement | null;
      dragId = dragEl?.getAttribute("data-task-drag") ?? null;
      const group = dragEl?.getAttribute("data-task-drag-group");
      dragTitle = group
        ? `${group.split(",").filter(Boolean).length} tasks`
        : dragEl?.getAttribute("data-task-title")?.trim()
          || dragEl?.getAttribute("data-project-title")?.trim()
          || null;
      if (!dragTitle) {
        const calEl = el?.closest?.(".evt-task") as HTMLElement | null;
        dragTitle =
          calEl?.querySelector?.("[data-evt-title]")?.textContent?.trim()
          || calEl?.textContent?.trim()
          || null;
      }
      fromRail = Boolean(dragEl && railRef.current?.contains(dragEl));
      calTask = Boolean(el?.closest?.(".evt-task"));
      const homeId =
        dragId ?? (el?.closest?.(".evt-task") as HTMLElement | null)?.getAttribute("data-task-id") ?? null;
      const home = homeId ? tasksRef.current.find((t) => t.id === homeId) : undefined;
      dragTaskId = dragId ? null : homeId;
      returnLabel = home?.project_id ? "↩ Back to its project" : "↩ Back to Inbox";
      startX = e.clientX;
      startY = e.clientY;
      moved = false;
    };

    type RectSnap = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;
    type SlotTarget = { el: HTMLElement; slotId: string; rect: RectSnap };
    type DayTarget = { el: HTMLElement; rect: RectSnap };

    let slotTargets: SlotTarget[] = [];
    let dayTargets: DayTarget[] = [];
    let moveRaf = 0;
    let pendingMove: PointerEvent | null = null;

    const toSnap = (r: DOMRect): RectSnap => ({
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });

    const snapshotDragTargets = () => {
      slotTargets = [];
      for (const el of document.querySelectorAll<HTMLElement>(".fc-event.evt-slot[data-slot-id]")) {
        const slotId = el.getAttribute("data-slot-id");
        if (!slotId) continue;
        slotTargets.push({ el, slotId, rect: toSnap(el.getBoundingClientRect()) });
      }
      dayTargets = [];
      for (const el of document.querySelectorAll<HTMLElement>(".fc-daygrid-body .fc-daygrid-day")) {
        dayTargets.push({ el, rect: toSnap(el.getBoundingClientRect()) });
      }
    };

    const hitSlotAt = (x: number, y: number): { el: HTMLElement | null; zone: SlotDropZone | null } => {
      for (const t of slotTargets) {
        const hit = slotDropZoneFromPointer(t.rect as DOMRect, x, y);
        if (hit) return { el: t.el, zone: hit };
      }
      return { el: null, zone: null };
    };

    const hitDayAt = (x: number, y: number): HTMLElement | null => {
      for (const t of dayTargets) {
        const r = t.rect;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return t.el;
      }
      return null;
    };

    const flushMove = () => {
      moveRaf = 0;
      const e = pendingMove;
      if (!e || !armed) return;
      const clientX = e.clientX;
      const clientY = e.clientY;

      let slotEl: HTMLElement | null = null;
      let zone: SlotDropZone | null = null;
      ({ el: slotEl, zone } = hitSlotAt(clientX, clientY));
      if (slotEl !== overSlot || zone !== overZone) {
        overSlot?.classList.remove("slot-drop-target", "slot-adjacent-anchor");
        overSlot = slotEl;
        overZone = zone;
        const slotId = slotEl?.getAttribute("data-slot-id") ?? null;
        slotDropIntentRef.current = slotId && zone ? { slotId, zone } : null;
        if (slotEl && zone === "inside") slotEl.classList.add("slot-drop-target");
        else if (slotEl && (zone === "before" || zone === "after")) slotEl.classList.add("slot-adjacent-anchor");
      }
      document.body.classList.toggle("over-slot", zone === "inside");

      let anytimeEl: HTMLElement | null = null;
      if (!slotEl) anytimeEl = hitDayAt(clientX, clientY);
      if (anytimeEl !== overAnytime) {
        overAnytime?.classList.remove("anytime-drop-target");
        overAnytime = anytimeEl;
        anytimeEl?.classList.add("anytime-drop-target");
      }
      document.body.classList.toggle("over-anytime", Boolean(anytimeEl));
      if (!anytimeEl) hideAnytimePreview();

      if (zone === "before" || zone === "after") {
        clearAnytimeTarget();
        chip.classList.remove("is-visible", "drop-chip-act");
        const slotId = slotEl?.getAttribute("data-slot-id");
        const slot = slotId ? slotsRef.current.find((s) => s.id === slotId) : null;
        if (slotEl && slot) {
          const r = slotEl.getBoundingClientRect();
          const rect = adjacentPreviewRect(r, slot.duration_minutes, dragDurationMins(), zone);
          preview.style.left = `${fixedCssPx(rect.left)}px`;
          preview.style.top = `${fixedCssPx(rect.top)}px`;
          preview.style.width = `${fixedCssPx(rect.width)}px`;
          preview.style.height = `${fixedCssPx(rect.height)}px`;
          previewTitle.textContent = dragLabel();
          preview.classList.add("is-visible");
          document.body.classList.add("slot-adjacent-drop");
        } else {
          hideAdjacentPreview();
        }
      } else if (slotEl && zone === "inside") {
        hideAdjacentPreview();
        clearAnytimeTarget();
        const title = slotEl.querySelector(".fc-event-main")?.textContent?.trim();
        chip.textContent = `↳ Drop into ${title || "this slot"}`;
        chip.classList.remove("drop-chip-act");
        chip.style.left = `${fixedCssPx(clientX + 14)}px`;
        chip.style.top = `${fixedCssPx(clientY + 16)}px`;
        chip.classList.add("is-visible");
      } else if (anytimeEl) {
        hideAdjacentPreview();
        const frame =
          anytimeEl.querySelector<HTMLElement>(".fc-daygrid-day-events") ??
          anytimeEl.querySelector<HTMLElement>(".fc-daygrid-day-frame") ??
          anytimeEl;
        const r = frame.getBoundingClientRect();
        const padX = 6;
        const padY = 3;
        let top = r.top + padY;
        for (const existing of anytimeEl.querySelectorAll<HTMLElement>(".fc-daygrid-event")) {
          if (existing.classList.contains("fc-event-mirror") || existing.classList.contains("fc-event-dragging")) continue;
          const er = existing.getBoundingClientRect();
          if (er.bottom > top) top = er.bottom + 2;
        }
        if (top + 22 > r.bottom - 2) top = Math.max(r.top + padY, r.bottom - 24);
        const label = dragLabel();
        anytimePreview.style.left = `${fixedCssPx(r.left + padX)}px`;
        anytimePreview.style.top = `${fixedCssPx(top)}px`;
        anytimePreview.style.width = "auto";
        anytimePreview.style.maxWidth = `${fixedCssPx(Math.max(120, r.width - padX * 2))}px`;
        anytimePreviewTitle.textContent = label;
        anytimePreview.classList.add("is-visible");
        const dateStr = anytimeEl.getAttribute("data-date");
        const dayBit = dateStr ? ` · ${format(parseDateISO(dateStr), "EEE")}` : "";
        chip.textContent = `↳ Plan anytime${dayBit}`;
        chip.classList.add("drop-chip-act");
        chip.style.left = `${fixedCssPx(clientX + 14)}px`;
        chip.style.top = `${fixedCssPx(clientY + 16)}px`;
        chip.classList.add("is-visible");
      } else {
        hideAdjacentPreview();
        clearAnytimeTarget();
        chip.classList.remove("is-visible", "drop-chip-act");
      }
      const rail = railRef.current;
      if (rail) {
        const rr = rail.getBoundingClientRect();
        const onRail =
          clientX >= rr.left && clientX <= rr.right && clientY >= rr.top && clientY <= rr.bottom;
        overRail = onRail && !slotEl && !anytimeEl;
        const railArmed = !fromRail && overRail && (Boolean(dragId) || calTask);
        rail.classList.toggle("rail-drop-active", railArmed);
        // The rail lighting up said "something happens here", not what. The
        // chip says it — and for project work, that it isn't the Inbox.
        if (railArmed) {
          chip.textContent = returnLabel;
          chip.classList.add("drop-chip-act");
          chip.style.left = `${fixedCssPx(clientX + 14)}px`;
          chip.style.top = `${fixedCssPx(clientY + 16)}px`;
          chip.classList.add("is-visible");
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (gesture?.cancelled && gesture.live) {
        cancelChip.style.left = `${fixedCssPx(e.clientX + 14)}px`;
        cancelChip.style.top = `${fixedCssPx(e.clientY + 16)}px`;
        return;
      }
      if (!armed) return;
      // The same slop as whatever owns the drag: the rail's Draggable starts at
      // 6px, FullCalendar's block drag at 5. A 5px wobble used to arm this for a
      // rail click that never became a drag, and the click was then swallowed.
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < (fromRail ? 6 : 5)) return;
      if (!moved) {
        moved = true;
        active = true;
        gesture?.begin();
        document.body.classList.add("cal-dragging");
        pauseGridSyncRef.current();
        snapshotDragTargets();
      }
      dropPointRef.current = { x: e.clientX, y: e.clientY };
      pendingMove = e;
      if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
    };
    const onUp = () => {
      // Capture drag state before resetting — needed to suppress the phantom
      // click the browser fires on the original element after any drag gesture.
      const swallowClick = moved && fromRail;
      armed = false;
      // The pointer is up; FullCalendar's drop handlers run on the mouseup
      // after this and ask the gesture whether it was called off.
      hideCancel();
      gesture?.end();
      if (active && moved) {
        active = false;
        // Freeze intent before FullCalendar's async drop handlers run.
        committedSlotDropIntentRef.current = slotDropIntentRef.current;
        const dropInbox = Boolean(dragId) && !fromRail && overRail && !gesture?.take();
        if (dropInbox) {
          const dragEl = document.querySelector<HTMLElement>(`[data-task-drag="${dragId}"]`);
          const group = dragEl?.getAttribute("data-task-drag-group");
          const ids = group ? group.split(",") : [dragId];
          ids.forEach((id) => {
            const task = tasksRef.current.find((t) => t.id === id);
            if (task) mutationsRef.current.backToInbox(task, backHomeUndo(task));
          });
        }
        reset();
      } else if (!moved) {
        reset();
      }
      dragId = null;
      dragTitle = null;
      fromRail = false;
      calTask = false;
      moved = false;
      overRail = false;
      // After dragging from the rail (whether dropped, cancelled, or returned),
      // the browser fires a click on the original TaskRow. Eat it once so the
      // task popover doesn't open when the user changes their mind mid-drag.
      // Expires on the next task (as calendarDismissGuard does): if no click
      // follows — the dragged row left the DOM first — it used to wait and eat
      // the NEXT click anywhere, usually on the block you'd just placed.
      if (swallowClick) {
        const swallow = (e: MouseEvent) => e.stopPropagation();
        document.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 0);
      }
    };
    // Abandoning a drag must clear the glow too. Without these, Escape (which
    // the rail's reorder honours) or a cancelled pointer left `cal-dragging` on
    // the body — every day cell still lit for a drag that had already ended.
    // `dragGroupRef` is NOT cleared here: what the user picked up is decided
    // at pickup and consumed by the drop handler — clearing it on abort is how a
    // cancelled four-row drag used to land as one task.
    const onAbort = () => {
      armed = false;
      active = false;
      moved = false;
      dragId = null;
      dragTitle = null;
      fromRail = false;
      calTask = false;
      overRail = false;
      committedSlotDropIntentRef.current = null;
      slotDropIntentRef.current = null;
      hideCancel();
      gesture?.end();
      reset();
    };
    // Esc while something is in hand calls the gesture off: the feedback goes,
    // the cursor says "Release to cancel", and the release writes nothing (every
    // drop handler asks `gesture.take()`). Grid sync stays paused until the
    // release — resuming mid-drag would move blocks under the pointer.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !gesture?.escape()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      armed = false;
      clearFeedback();
      committedSlotDropIntentRef.current = null;
      cancelChip.style.left = `${fixedCssPx(lastX + 14)}px`;
      cancelChip.style.top = `${fixedCssPx(lastY + 16)}px`;
      cancelChip.classList.add("is-visible");
      document.body.classList.add("drag-cancelled");
      announce("Drag cancelled — release to put it back");
    };
    // The targets were measured once, at the drag's first move. FullCalendar
    // autoscrolls the grid when you drag near its edge (and the wheel scrolls
    // it too), which left those rects pointing at where the slots USED to be:
    // "↳ Drop into Morning block" over empty 4pm, and the drop joined a slot
    // hours away. Re-measure whenever anything scrolls mid-drag.
    const onScroll = () => {
      if (!active || !moved) return;
      snapshotDragTargets();
      if (pendingMove && !moveRaf) moveRaf = requestAnimationFrame(flushMove);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onAbort, true);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onAbort, true);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("keydown", onKey, true);
      reset();
      chip.remove();
      preview.remove();
      anytimePreview.remove();
      cancelChip.remove();
    };
  }, [railRef, defaultDurationMins]);

  useEffect(() => {
    if (!isFcView(view)) return; // the board and the Year aren't FullCalendar views
    const api = calRef.current?.getApi();
    if (!api) return;
    if (api.view.type !== view) api.changeView(view);
    // FullCalendar is hidden rather than unmounted now (see the render), and a
    // re-measure of the whole grid is expensive — ~100ms — so it must not be
    // paid on every reveal. `invisible` over a stable `absolute inset-0` keeps
    // the box it already had, so usually there is nothing to re-measure; the
    // exception is the Spread, which collapses the whole stack to `display:none`
    // and does return a zero box. Measure, and only reflow when it actually
    // moved. rAF so the class change has landed first.
    const raf = requestAnimationFrame(() => {
      const el = wrapRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return; // still hidden — nothing meaningful to measure
      if (w === fcSizeRef.current.w && h === fcSizeRef.current.h) return;
      fcSizeRef.current = { w, h };
      calRef.current?.getApi()?.updateSize();
    });
    return () => cancelAnimationFrame(raf);
  }, [view]);

  // Restore the remembered time-grid scroll on (re)mount, then keep the cache
  // current so the next remount lands where the user left. rAF because the FC
  // React wrapper builds its DOM after our effect runs; when the scroller isn't
  // found this quietly falls back to `scrollTime` (open at now).
  useEffect(() => {
    if (!isFcView(view) || view === "dayGridMonth") return;
    let detach: (() => void) | undefined;
    const raf = requestAnimationFrame(() => {
      const scroller = wrapRef.current?.querySelector<HTMLElement>(
        ".fc-scroller-liquid-absolute",
      );
      if (!scroller) return;
      if (remountCache.scrollTop != null) scroller.scrollTop = remountCache.scrollTop;
      const onScroll = () => {
        remountCache.scrollTop = scroller.scrollTop;
      };
      scroller.addEventListener("scroll", onScroll, { passive: true });
      detach = () => scroller.removeEventListener("scroll", onScroll);
    });
    return () => {
      cancelAnimationFrame(raf);
      detach?.();
    };
  }, [view]);

  // Document CSS zoom breaks FullCalendar pointer → date math. The calendar host
  // counters it (see wrap style) so interactions run at effective scale 1 —
  // tell FC to reflow whenever the UI zoom changes.
  useEffect(() => {
    calRef.current?.getApi()?.updateSize();
  }, [uiScale]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const hidden = useMemo(
    () => new Set(settings?.hidden_calendar_ids ?? []),
    [settings],
  );

  // Which blocks are late, as a set whose identity only changes when its
  // MEMBERSHIP does. `fcEvents` used to depend on `fcNow` itself, so the 30s
  // clock rebuilt every block and re-ran the grid reconcile twice a minute to
  // find, nearly always, that nothing had turned late.
  const overdueKey = useMemo(
    () =>
      tasks
        .filter((t) => t.start_time && t.status !== "done" && isOverdue(t, fcNow))
        .map((t) => t.id)
        .join(","),
    [tasks, fcNow],
  );
  const overdueIds = useMemo(() => new Set(overdueKey ? overdueKey.split(",") : []), [overdueKey]);

  const fcEvents = useMemo(() => {
    const taskEvents = tasks
      .filter((t) => t.start_time)
      .map((t) => {
        const overdue = overdueIds.has(t.id);
        // Tasks share one identity — the violet accent — so "this is my work"
        // reads at a glance against the calendar's own (arbitrarily coloured)
        // events. The domain thread lives on in the thin bar; overdue turns the
        // BAR ember, not the whole block — a signal slab was the loudest thing
        // on the grid, louder than the now-line it shares a colour with.
        const fill = "var(--accent)";
        const bar = overdue ? "var(--signal)" : (taskAccent(t) ?? "var(--accent)");
        const start = toFcInstant(t.start_time!);
        return {
          id: `task:${t.id}`,
          title: t.title,
          start,
          end: endOf({ start_time: start, duration_minutes: t.duration_minutes }).toISOString(),
          allDay: false,
          editable: true,
          // Stated, not inherited: the all-day "planned" chip below is
          // `durationEditable: false`, and when you drag it onto the grid the
          // reconcile moves the SAME FullCalendar event (`setDates`), which only
          // re-patches a flag the new input names. Left implicit, the block kept
          // the chip's `false` and came up with no resize handles.
          durationEditable: true,
          // evt-overdue carries the ember to CSS: the inline `fill` above is
          // enough on Warm Paper, but a mono skin restyles the block wholesale
          // (!important), so without a class the "this is late" signal is lost.
          classNames: [
            "evt-task",
            overdue ? "evt-overdue" : "",
            t.status === "done" ? "evt-done" : "",
          ].filter(Boolean),
          ...blockColors(fill, 22),
          extendedProps: {
            kind: "task" as const,
            refId: t.id,
            barColor: bar,
            recurring: Boolean(t.recurrence_id),
            done: t.status === "done",
            projectBacked: !!t.project_id,
            projectName: t.project_id ? taskProject?.(t) ?? null : null,
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
      // Hidden events drop off the board entirely — unless "show hidden" is on,
      // when they return dimmed (and dashed) so you can bring one back.
      .filter((e) => !hidden.has(e.calendar_id) && (showHidden || !isHidden(e)))
      .map((e) => {
        const account = accountById.get(e.account_id);
        const eventHidden = isHidden(e);
        const isGoogle = account?.provider === "google";
        const isIcs = account?.provider === "ics";
        const isIcloud = account?.provider === "icloud";
        // Writable events (Google or iCloud two-way) can be dragged / resized.
        // The calendar itself must be writable too — a Family iCloud import
        // on a two-way Google account used to drag, then snap back. A create
        // still on the wire has no row to write to yet: drawn as itself, held
        // still until the real row replaces it (lib/eventWriteback).
        const writable = isWritableCalendar(account, e.calendar_id) && !isPendingEventCreate(e.id);
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
          // An all-day row is a pair of dates, not two instants (see allDayDates).
          ...(e.all_day ? allDayDates(e.start_at, e.end_at) : { start: e.start_at, end: e.end_at }),
          allDay: e.all_day,
          // Same gestures as Google / Fantastical / Apple Calendar: drag the
          // chip to another day, or pull the left/right handles to grow or
          // shrink the span. Read-only calendars stay locked. Timed → all-day
          // conversion is refused in `eventAllow` / `onDrop` so a slip onto
          // the anytime row cannot turn a meeting into a day chip.
          editable: writable,
          durationEditable: writable,
          classNames: [
            isGoogle || isIcloud ? "evt-google" : isIcs ? "evt-ics" : "evt-m365",
            ...(e.all_day ? ["evt-allday"] : []),
            // Quantises this calendar onto the terminal skin's syntax ramp, so
            // each calendar keeps a distinct ink drawn from the active editor
            // theme instead of every block collapsing to one accent. Inert on
            // every other skin (see src/lib/syntax.ts).
            synClass(e.calendar_id),
            ...(rsvpClass ? [rsvpClass] : []),
            ...(eventHidden ? ["evt-hidden"] : []),
          ],
          // Google / iCloud / ICS render as quiet tinted blocks (the "given"
          // calendar, so bolder tasks read on top); only M365 keeps the hatch.
          ...(isGoogle || isIcs || isIcloud ? blockColors(calColor, 13) : {}),
          extendedProps: {
            kind: isGoogle ? ("google" as const) : isIcloud ? ("icloud" as const) : isIcs ? ("ics" as const) : ("m365" as const),
            refId: e.id,
            calColor,
            barColor: calColor,
            selfRsvp: rsvp,
            // Prefer the DB-derived field (post-migration); fall back to
            // detecting the Google instance ID pattern: base_YYYYMMDDTHHMMSSZ
            recurringEventId: resolveRecurringEventId(e, { provider: isGoogle ? "google" : isIcloud ? "icloud" : isIcs ? "ics" : "m365" }),
            recurring: isExternalEventRecurring(e, { provider: isGoogle ? "google" : isIcloud ? "icloud" : isIcs ? "ics" : "m365" }),
          },
        };
      });

    const slotEvents = slots.map((s) => {
      const end = new Date(new Date(s.start_time).getTime() + s.duration_minutes * 60_000);
      // The container reads as a slot (teal) regardless of domain; the thin bar
      // still carries the project/domain thread when one is set — including the
      // project's own domain hue, which the bar used to drop on the floor
      // (every unpainted slot came out teal, project or not).
      const project = s.project_id ? slotProject?.(s) ?? null : null;
      const barColor = s.color ?? project?.color ?? "var(--slot)";
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
        // A plain slot is a clearly teal container — `--slot` means open /
        // unclaimed time. A project's sitting is CLAIMED time, so it wears its
        // project's domain hue instead (the bar already did, D-109); the dashed
        // border still says "container".
        ...(project?.color
          ? {
              backgroundColor: `color-mix(in srgb, ${project.color} 24%, var(--surface))`,
              borderColor: `color-mix(in srgb, ${project.color} 62%, var(--line))`,
            }
          : {
              backgroundColor: "color-mix(in srgb, var(--slot) 32%, var(--surface))",
              borderColor: "color-mix(in srgb, var(--slot) 68%, var(--line))",
            }),
        extendedProps: {
          kind: "slot" as const,
          refId: s.id,
          calColor: "var(--slot)",
          barColor,
          recurring: Boolean(s.recurrence_id),
          projectBacked: !!s.project_id,
          // Only when the block's own title isn't already the project's name —
          // `PROJECT · Frontier Site` over a block titled "Frontier Site" is the
          // same word twice.
          projectName:
            project && project.name !== slotTitle(s) ? project.name : null,
          slotDone: done,
          slotTotal: children.length,
          slotChildren: children,
        },
      };
    });

    return [...taskEvents, ...plannedTaskEvents, ...externalEvents, ...slotEvents];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, events, slots, slotTasks, hidden, hiddenKeys, showHidden, accountById, overdueIds, taskAccent, slotTitle, slotProject, taskProject]);

  // Ghost block shown while dragging an all-day range (allDayDragRange, live)
  // or while the DraftComposer popover is open (draft, on release/click) — for
  // an all-day drag this is the only visual (dayGrid's own selection highlight
  // is a flat cell tint, not an event-shaped bar); for a timed drag it layers
  // over FC's own selectMirror/highlight. `end` is the INCLUSIVE last day for
  // all-day ranges (see onSelect/onDateClick/allDayDragRange), so it needs
  // bumping to FC's exclusive convention to span the full multi-day range.
  const previewRange = draft
    ? { start: draft.start, end: draft.end, allDay: Boolean(draft.allDay) }
    : allDayDragRange
      ? { start: allDayDragRange.start, end: allDayDragRange.end, allDay: true }
      : null;
  // A timed draft's ghost is adjustable (#33): drag it, pull its edges — the
  // composer's time follows (onDrop / onResize), and ↑↓ / ⇧↑↓ nudge it from the
  // card. The all-day ghosts stay put: one is a live drag, the other a day.
  const draftPreviewEvent = previewRange
    ? {
        id: DRAFT_PREVIEW_ID,
        title: "",
        start: previewRange.start.toISOString(),
        end: (previewRange.allDay ? addDays(previewRange.end, 1) : previewRange.end).toISOString(),
        allDay: previewRange.allDay,
        editable: Boolean(draft) && !previewRange.allDay,
        durationEditable: Boolean(draft) && !previewRange.allDay,
        classNames: ["evt-task", "evt-draft-preview"],
        ...blockColors("var(--accent)"),
        extendedProps: { kind: "task" as const, refId: "", barColor: "var(--accent)", recurring: false },
      }
    : null;

  const gridEvents = useMemo(
    () => (draftPreviewEvent ? [...fcEvents, draftPreviewEvent] : fcEvents),
    [fcEvents, draftPreviewEvent],
  );

  // FullCalendar treats a new `events` array as a new source and re-parses
  // every block. Keep the option stable, then reconcile only the blocks whose
  // cache-backed inputs changed. The event FullCalendar already moved stays
  // exactly under the pointer while its task/event write persists.
  const eventsOptionRef = useRef<EventInput[] | null>(null);
  if (eventsOptionRef.current === null) eventsOptionRef.current = gridEvents as EventInput[];

  useLayoutEffect(() => {
    const api = calRef.current?.getApi();
    if (!api) return;
    const plan = gridSyncPlan(gridSyncPausedRef.current, gridEvents as CalendarBlockInput[]);
    if (!plan.run) {
      pendingGridSyncRef.current = plan.stash;
      return;
    }
    pendingGridSyncRef.current = null;
    syncCalendarEvents(api, gridEvents as CalendarBlockInput[]);
  }, [gridEvents]);

  const findTask = (id: string) => tasksRef.current.find((t) => t.id === id);
  const findEvent = (id: string) => eventsRef.current.find((e) => e.id === id);
  const findSlot = (id: string) => slotsRef.current.find((s) => s.id === id);

  /** Instant check, then the write. The paint is the click; the mutation is
   *  scheduled as a macrotask so React/FullCalendar cannot take this frame. */
  const toggleCalendarTaskDone = (clicked: Task, el?: HTMLElement | null) => {
    const goingDone = clicked.status !== "done";
    // A series can put this Thursday and next Thursday on the grid as two
    // rows. Checking the chip a week ahead (easy: the rail still says "this
    // week") used to complete that future row while Today kept today's.
    const task = goingDone
      ? resolveCompleteTarget(clicked, tasksRef.current, todayISO(now))
      : clicked;
    const redirected = task.id !== clicked.id;
    if (redirected) pageToday();
    else if (el) paintCalendarTaskDone(el, goingDone);
    const nextStatus = goingDone ? "done" : restingStatus(task);
    tasksRef.current = tasksRef.current.map((t) =>
      t.id === task.id
        ? { ...t, status: nextStatus, completed_at: goingDone ? new Date().toISOString() : null }
        : t,
    );
    window.setTimeout(() => {
      goingDone ? mutations.complete(task) : mutations.uncomplete(task);
    }, 0);
  };

  // ── Hide / show (Fantastical "hide", not delete) ─────────────────────────
  const hideEvent = (event: ExternalEvent, scope: RecurrenceScope) => {
    hide(event, scope);
    setEventMenu(null);
  };
  const showEvent = (event: ExternalEvent) => {
    const key = hiddenKeyFor(event);
    if (key) unhide(key);
    setEventMenu(null);
  };
  // Hard delete — writable calendars only (Google + iCloud two-way). M365/ICS stay read-only.
  const deleteEventNow = (
    event: ExternalEvent,
    scope: RecurrenceScope,
    notifyGuests?: boolean,
  ) => {
    eventMutations.deleteEvent({
      id: event.id,
      scope,
      ...(notifyGuests === undefined ? {} : { notifyGuests }),
    });
    setEventDeleteConfirm(null);
    setEventMenu(null);
  };

  // Right-click a calendar event → the hide/show menu (events only — tasks and
  // slots have their own editing paths). The listener is attached per element as
  // FullCalendar mounts it.
  const handleEventDidMount = useCallback((arg: EventMountArg) => {
    const { kind, refId } = arg.event.extendedProps as ExtendedProps;
    // The selection's handle (D-158): which element(s) draw this block — a
    // multi-day chip is several. Never on a drag mirror, which isn't the block.
    if (!arg.isMirror) arg.el.setAttribute("data-block-id", arg.event.id);
    // A right-click is pointing at this block: the menu acts on what's lit.
    const pointAt = () => {
      if (!arg.isMirror && arg.event.id !== DRAFT_PREVIEW_ID) selectBlock(arg.event.id);
    };
    if (kind === "task") {
      // The id, for the pointer-level drag watch (where the block would go
      // back to if it's let go over the rail). Ids never change under a block.
      if (refId) arg.el.setAttribute("data-task-id", refId);
      arg.el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const task = findTask(refId);
        if (!task) return;
        pointAt();
        setTaskMenu({ x: e.clientX, y: e.clientY, task, el: arg.el });
      });
      return;
    }
    if (kind === "slot") {
      // Only a REAL slot gets the handle. The drag preview for a project mounts
      // through here too (it is drawn as the sitting it will become) with no id
      // of its own — stamping an empty one made the drop hit-test find the
      // ghost, which then offered to drop the project into itself.
      if (refId) arg.el.setAttribute("data-slot-id", refId);
      arg.el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const slot = findSlot(refId);
        if (!slot) return;
        pointAt();
        setSlotMenu({ x: e.clientX, y: e.clientY, slot, el: arg.el });
      });
      return;
    }
    arg.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const evt = findEvent(refId);
      if (!evt) return;
      pointAt();
      setEventMenu({ x: e.clientX, y: e.clientY, event: evt, el: arg.el });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** `eventClassNames` — the selection survives any render FullCalendar does of
   *  its own (see `gridSelRef`). Reads a ref, so the element memo never moves. */
  const blockClassNames = useCallback((arg: { event: EventApi; isMirror: boolean }) => {
    if (arg.isMirror) return [];
    const { cursor, ids } = gridSelRef.current;
    const id = arg.event.id;
    return id === cursor ? ["evt-focused"] : ids.has(id) ? ["evt-selected"] : [];
  }, []);

  // Dismiss the menu on any outside interaction or Escape (a press inside the
  // menu is a selection, not a dismissal).
  const eventMenuRef = useRef<HTMLDivElement | null>(null);
  const eventMenuPos = useOnScreen(
    eventMenuRef,
    eventMenu?.x ?? 0,
    eventMenu?.y ?? 0,
    `${eventMenu?.event.id}:${eventDeleteConfirm}:${eventMoveMode}:${Boolean(eventMoveConfirm)}:${eventMenuOtherGuests.length}`,
  );
  // ⌫ on a one-off event opens straight on its confirm — the step that says
  // who gets told. A series opens on its scope (rendered below).
  const [eventDeleteLit, setEventDeleteLit] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    setEventDeleteConfirm(
      eventMenu?.intent === "delete" && !eventSeriesKey(eventMenu.event) ? "THIS" : null,
    );
    setEventDeleteLit(0);
    setEventMoveMode(false);
    setEventMoveConfirm(null);
  }, [eventMenu]);
  // The delete step answers the keyboard that opened it: ↑↓ pick the scope,
  // ↵ runs the lit one — or the confirm's primary. (The rest of this menu
  // waits for the one menu primitive; this is the part ⌫ lands on.)
  const eventDeleteKeysRef = useRef<{ confirm?: () => void; pick?: boolean }>({});
  useEffect(() => {
    if (!eventMenu) return;
    const onKey = (e: KeyboardEvent) => {
      const k = eventDeleteKeysRef.current;
      if (e.key === "Enter" && k.confirm) {
        e.preventDefault();
        e.stopImmediatePropagation();
        k.confirm();
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && k.pick) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const step = e.key === "ArrowDown" ? 1 : 2;
        setEventDeleteLit((l) => ((l + step) % 3) as 0 | 1 | 2);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [eventMenu]);
  useEffect(() => {
    if (!eventMenu) return;
    const onDown = (e: PointerEvent) => {
      if (eventMenuRef.current?.contains(e.target as Node)) return;
      setEventMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEventMenu(null);
    const onBlur = () => setEventMenu(null);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [eventMenu]);

  // The calendar picker for Task → Event closes like every floating thing here.
  const taskEventPickRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!taskEventPick) return;
    const onDown = (e: PointerEvent) => {
      if (taskEventPickRef.current?.contains(e.target as Node)) return;
      setTaskEventPick(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTaskEventPick(null);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [taskEventPick]);

  const [deferOffer, setDeferOffer] = useState<{ x: number; y: number; slot: Slot } | null>(null);
  const closeDeferOffer = useCallback(() => setDeferOffer(null), []);
  const slotMenuRef = useRef<HTMLDivElement | null>(null);
  const slotMenuPos = useOnScreen(slotMenuRef, slotMenu?.x ?? 0, slotMenu?.y ?? 0, slotMenu?.slot.id ?? "");
  useEffect(() => {
    if (!slotMenu) return;
    const onDown = (e: PointerEvent) => {
      if (slotMenuRef.current?.contains(e.target as Node)) return;
      setSlotMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSlotMenu(null);
    const onBlur = () => setSlotMenu(null);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [slotMenu]);

  // The gather offer closes like every other floating thing on this pane —
  // Escape, or a press anywhere else. Declining is silence, not a second button
  // to hunt for: what it offered is still true, and the sitting is already there.
  const gatherOfferRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!gatherOffer) return;
    const onDown = (e: PointerEvent) => {
      if (gatherOfferRef.current?.contains(e.target as Node)) return;
      setGatherOffer(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setGatherOffer(null);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [gatherOffer]);

  // If the event is part of a recurring series, revert immediately and
  // surface the scope dialog. On confirm the caller gets scope + executes.
  const withRecurrenceScope = (
    extProps: ExtendedProps,
    revert: () => void,
    action: (scope: RecurrenceScope) => void,
  ) => {
    const recurring = Boolean(extProps.recurringEventId || extProps.recurring);
    if ((extProps.kind !== "google" && extProps.kind !== "icloud") || !recurring) {
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


  // ── Block keys (D-158) ─────────────────────────────────────────────────────
  // The grid speaks the rail's grammar — the SAME hook (`useTaskListKeys`), over
  // the grid's blocks in time order, so `e` on a block and `e` on a row are one
  // act and can't drift (the D-111 lesson, a third time). What only a grid has
  // rides in through `extra`: ⌥↑/⌥↓ a quarter hour, ⌥←/⌥→ a day, ⌥⇧↑/⌥⇧↓ the
  // length, and the ⌫ cases that have to ask first (a series' scope, an event's
  // guests). Every move records undo, as a drag does.
  const qc = useQueryClient();
  const setPriority = usePriorityAct(mutations);
  const renameTask = useRenameAct(mutations);
  const gridRows = useMemo(() => gridBlocks(fcEvents as CalendarBlockInput[]), [fcEvents]);
  const homeId = useMemo(
    () => homeBlockId(gridRows, visibleSpan.start, visibleSpan.end, now.getTime()),
    [gridRows, visibleSpan, now],
  );
  const blockById = (id: string) => gridRows.find((b) => b.id === id);
  const blockEl = (id: string) =>
    wrapRef.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`) ?? null;
  const blockRect = (id: string): DOMRect => {
    const el = blockEl(id);
    if (el) return el.getBoundingClientRect();
    const r = wrapRef.current?.getBoundingClientRect();
    return r ? new DOMRect(r.left + r.width / 2, r.top + r.height / 3, 0, 0) : new DOMRect(480, 240, 0, 0);
  };
  const taskOf = (b: GridBlock) => (b.kind === "task" ? findTask(b.refId) : undefined);
  const tasksOf = (bs: readonly GridBlock[]) => bs.map(taskOf).filter((t): t is Task => Boolean(t));
  const eventWritable = (ev: ExternalEvent) => isWritableCalendar(accountById.get(ev.account_id), ev.calendar_id);
  const extPropsOf = (b: GridBlock): ExtendedProps =>
    (calRef.current?.getApi().getEventById(b.id)?.extendedProps as ExtendedProps | undefined) ?? {
      kind: "google",
      refId: b.refId,
    };

  /** On screen: j past the week's last block pages to the next week. */
  const revealAt = (id: string, start: number, end: number) => {
    const api = calRef.current?.getApi();
    if (!api) return;
    const { activeStart, activeEnd } = api.view;
    if (start >= activeEnd.getTime() || end <= activeStart.getTime()) api.gotoDate(new Date(start));
    requestAnimationFrame(() => blockEl(id)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };
  const revealBlock = (id: string) => {
    const b = blockById(id);
    if (b) revealAt(id, b.start, b.end);
  };

  const openBlock = (b: GridBlock) => {
    const el = blockEl(b.id);
    const rect = blockRect(b.id);
    if (b.kind === "task") {
      const task = findTask(b.refId);
      if (task) onOpenTask(task, rect, el);
    } else if (b.kind === "slot") {
      const slot = findSlot(b.refId);
      if (slot) onOpenSlot(slot, rect, el);
    } else {
      const ev = findEvent(b.refId);
      if (ev) onOpenEvent(ev, rect, el);
    }
  };

  /** `.` — the block's own right-click menu, at the block. */
  const openBlockMenu = (b: GridBlock, intent?: "delete") => {
    const el = blockEl(b.id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(24, r.width / 2);
    const y = r.top + Math.min(r.height, 28);
    if (b.kind === "task") {
      const task = findTask(b.refId);
      if (task) setTaskMenu({ x, y, task, el, startInDelete: intent === "delete" });
    } else if (b.kind === "slot") {
      const slot = findSlot(b.refId);
      if (slot) setSlotMenu({ x, y, slot, el });
    } else {
      const event = findEvent(b.refId);
      if (event) setEventMenu({ x, y, event, el, intent });
    }
  };

  // ── duplicate — the menu's Duplicate and ⌘D are one act, and both select the copy
  const duplicateTask = (task: Task): string => {
    const clientId = crypto.randomUUID();
    void mutations.create(
      {
        clientId,
        title: task.title,
        notes: task.notes || undefined,
        do_date: task.do_date,
        start_time: task.start_time,
        duration_minutes: task.duration_minutes,
        priority: task.priority !== "none" ? task.priority : undefined,
        domain_id: task.domain_id,
        project_id: task.project_id,
        labelIds: task.task_labels?.map((l) => l.label_id),
      },
      {
        // The copy lands exactly on the original, so without a word it
        // looks like nothing happened. Say it, and make it one ⌘Z away.
        undo: "toast",
        label: `Duplicated — ${task.title}`,
      },
    );
    return `task:${clientId}`;
  };
  const duplicateSlot = (slot: Slot): string => {
    const made = slotMutations.createSlot({
      title: slot.title,
      do_date: slot.do_date,
      start_time: slot.start_time,
      duration_minutes: slot.duration_minutes,
      project_id: slot.project_id,
      domain_id: slot.domain_id,
      color: slot.color,
    });
    recordUndo({
      label: `Duplicated — ${slotTitle(slot)}`,
      shortLabel: "Duplicated",
      tier: "toast",
      undo: () => slotMutations.removeSlot(made),
    });
    return `slot:${made.id}`;
  };
  /** Guests and recurrence deliberately do NOT carry: a copy that silently
   *  re-invited eight people would be the app mailing on the user's behalf, and
   *  a copied series is two series. Resolves to the copy's block id. */
  const duplicateEvent = async (ev: ExternalEvent): Promise<string | null> => {
    const data = await eventMutations.createEvent({
      title: `${ev.title} (copy)`,
      start_at: ev.start_at,
      end_at: ev.end_at,
      all_day: ev.all_day,
      location: ev.location ?? undefined,
      accountId: ev.account_id,
      calendarId: ev.calendar_id,
      notifyGuests: false,
    });
    const id = (data as { event?: { id?: string } } | null)?.event?.id ?? (data as { id?: string } | null)?.id;
    return id ? `evt:${id}` : null;
  };
  const duplicateBlocks = (targets: readonly GridBlock[]) => {
    const copies: string[] = [];
    for (const b of targets) {
      if (b.kind === "task") {
        const task = findTask(b.refId);
        if (task) copies.push(duplicateTask(task));
      } else if (b.kind === "slot") {
        const slot = findSlot(b.refId);
        if (slot) copies.push(duplicateSlot(slot));
      } else {
        const ev = findEvent(b.refId);
        if (!ev || !eventWritable(ev)) continue;
        // An event's copy is named by the server; select it when it lands.
        void duplicateEvent(ev)
          .then((id) => id && targets.length === 1 && selectBlock(id))
          .catch(() => toast.error(`Couldn't copy ${ev.title || "the event"}`));
      }
    }
    if (copies.length === 1) selectBlock(copies[0]);
    else if (copies.length > 1) {
      setGridCursor(copies[copies.length - 1]);
      setGridSelected(new Set(copies));
    }
  };

  // ── delete — ⌫ on what needs no question goes now; the rest asks, as the menu does
  /** Guests on an event, if we know: an invite (self RSVP) means someone else
   *  is on it; otherwise only the details payload says, and it's null until
   *  fetched — unknown counts as "ask". */
  const knownGuests = (ev: ExternalEvent): number | null => {
    if (ev.self_rsvp) return 1;
    const details = qc.getQueryData<{ attendees?: { self?: boolean }[] } | null>(["event_details", ev.id]);
    if (details === undefined) return null;
    return (details?.attendees ?? []).filter((a) => !a.self).length;
  };
  type DeletePlan = "now" | "ask" | "locked";
  const deletePlan = (b: GridBlock): DeletePlan => {
    if (b.kind === "task") return taskOf(b)?.recurrence_id ? "ask" : "now";
    if (b.kind === "slot") {
      const slot = findSlot(b.refId);
      if (!slot) return "locked";
      return slot.recurrence_id || (slotTasks[slot.id]?.length ?? 0) > 0 ? "ask" : "now";
    }
    const ev = findEvent(b.refId);
    if (!ev || !eventWritable(ev)) return "locked";
    return eventSeriesKey(ev) || knownGuests(ev) !== 0 ? "ask" : "now";
  };
  const deleteNow = (b: GridBlock) => {
    if (b.kind === "task") {
      const task = taskOf(b);
      if (task) mutations.trash(task);
    } else if (b.kind === "slot") {
      const slot = findSlot(b.refId);
      if (!slot) return;
      slotMutations.removeSlot(slot);
      // An empty one-off — so putting it back IS the same block (new id).
      recordUndo({
        label: `Deleted — ${slotTitle(slot)}`,
        shortLabel: "Deleted",
        tier: "toast",
        undo: () => {
          const back = slotMutations.createSlot({
            title: slot.title,
            do_date: slot.do_date,
            start_time: slot.start_time,
            duration_minutes: slot.duration_minutes,
            project_id: slot.project_id,
            domain_id: slot.domain_id,
            color: slot.color,
          });
          selectBlock(`slot:${back.id}`);
        },
      });
    } else {
      const ev = findEvent(b.refId);
      if (ev) deleteEventNow(ev, "THIS");
    }
  };
  /** The question, asked where the menu asks it. A slot with work in it (or a
   *  series) opens its detail, whose delete picker says what happens to the
   *  work — the same route the slot's menu takes. */
  const askToDelete = (b: GridBlock) => {
    if (b.kind === "slot") {
      const slot = findSlot(b.refId);
      if (slot) onOpenSlot(slot, blockRect(b.id), blockEl(b.id));
      return;
    }
    openBlockMenu(b, "delete");
  };
  /** ⌫ through `extra`: true when handled here (a question was asked, or a mixed
   *  selection was split); false hands a plain delete to the hook, which trashes
   *  and steps the cursor to the next block. */
  const deleteKey = (targets: readonly GridBlock[]): boolean => {
    if (!targets.length) return false;
    const plans = targets.map((b) => ({ b, plan: deletePlan(b) }));
    if (plans.every((p) => p.plan === "now")) return false;
    if (targets.length === 1) {
      if (plans[0].plan === "locked") announce("This calendar is read-only");
      else askToDelete(targets[0]);
      return true;
    }
    // A mixed selection: what needs no question goes now; what does stays lit,
    // to be asked one at a time — never a scope or a guest notice decided in bulk.
    const now = plans.filter((p) => p.plan === "now").map((p) => p.b);
    const left = plans.filter((p) => p.plan === "ask").map((p) => p.b);
    now.forEach(deleteNow);
    if (left.length) {
      setGridCursor(left[0].id);
      setGridSelected(left.length > 1 ? new Set(left.map((b) => b.id)) : new Set());
      toast(`${left.length} still selected — a series or an invite asks first. Press ⌫ on each.`);
    } else {
      selectBlock(null);
    }
    return true;
  };

  // ── ⌘E — the title, edited where it's drawn
  const [renaming, setRenaming] = useState<{ block: GridBlock; title: string; rect: DOMRect } | null>(null);
  const startRename = (b: GridBlock) => {
    const title =
      b.kind === "task"
        ? findTask(b.refId)?.title
        : b.kind === "slot"
          ? findSlot(b.refId)?.title
          : (() => {
              const ev = findEvent(b.refId);
              if (ev && !eventWritable(ev)) {
                announce("This calendar is read-only");
                return undefined;
              }
              return ev?.title;
            })();
    if (title === undefined) return;
    setRenaming({ block: b, title, rect: blockRect(b.id) });
  };
  const commitRename = (b: GridBlock, title: string | null) => {
    setRenaming(null);
    const next = title?.trim();
    if (!next) return;
    if (b.kind === "task") {
      const task = findTask(b.refId);
      if (task && task.title !== next) renameTask(task, next);
    } else if (b.kind === "slot") {
      const slot = findSlot(b.refId);
      if (!slot || slot.title === next) return;
      const before = slot.title;
      slotMutations.updateSlot({ id: slot.id, patch: { title: next } });
      recordUndo({
        label: `Renamed — ${next}`,
        shortLabel: "Renamed",
        tier: "silent",
        undo: () => slotMutations.updateSlot({ id: slot.id, patch: { title: before } }),
      });
    } else {
      const ev = findEvent(b.refId);
      if (!ev || ev.title === next) return;
      withRecurrenceScope(extPropsOf(b), () => {}, (scope) => {
        eventMutations.updateEvent({ id: ev.id, patch: { title: next }, scope });
        if (scope === "THIS") {
          recordUndo({
            label: `Renamed — ${next}`,
            shortLabel: "Renamed",
            tier: "silent",
            undo: () => eventMutations.updateEvent({ id: ev.id, patch: { title: ev.title }, scope: "THIS" }),
          });
        }
      });
    }
  };

  // ── ⌥ arrows — a quarter hour, a day, the length
  /** One block, one press. Null = nothing to do; "locked" = a read-only calendar. */
  const shiftBlock = (b: GridBlock, how: BlockShift): { start: Date; end: Date } | "locked" | null => {
    const span = shiftSpan({ start: new Date(b.start), end: new Date(b.end), allDay: b.allDay }, how);
    if (!span) return null;
    const resize = how === "shorter" || how === "longer";
    const verb = resize ? "Resized" : "Moved";
    const mins = Math.max(15, Math.round((span.end.getTime() - span.start.getTime()) / 60_000));
    if (b.kind === "task") {
      const task = findTask(b.refId);
      if (!task) return null;
      if (b.allDay) {
        // An anytime chip has a day and no clock — it moves days, and stays anytime.
        mutations.planFor(task, toDateISO(span.start), {
          undo: "silent",
          coalesceKey: "move",
          label: `${verb} — ${task.title}`,
        });
        return span;
      }
      // A patch, not `block`: `block` re-plans the row, which would reopen a
      // finished task for being nudged.
      mutations.patchTask(
        task.id,
        {
          start_time: span.start.toISOString(),
          do_date: toDateISO(span.start),
          duration_minutes: mins,
          ...(task.recurrence_id && !task.recurrence_overridden ? { recurrence_overridden: true } : {}),
        },
        {
          undo: "silent",
          before: {
            start_time: task.start_time,
            do_date: task.do_date,
            duration_minutes: task.duration_minutes,
            recurrence_overridden: task.recurrence_overridden,
          },
          title: task.title,
          label: `${verb} — ${task.title}`,
          coalesceKey: "move",
        },
      );
      return span;
    }
    if (b.kind === "slot") {
      const slot = findSlot(b.refId);
      if (!slot) return null;
      const before = {
        start_time: slot.start_time,
        do_date: slot.do_date,
        duration_minutes: slot.duration_minutes,
        recurrence_overridden: slot.recurrence_overridden,
      };
      slotMutations.updateSlot({
        id: slot.id,
        patch: {
          start_time: span.start.toISOString(),
          do_date: toDateISO(span.start),
          duration_minutes: mins,
          ...(slot.recurrence_id ? { recurrence_overridden: true } : {}),
        },
      });
      recordUndo({
        label: `${verb} — ${slotTitle(slot)}`,
        shortLabel: verb,
        tier: "silent",
        coalesceKey: "move",
        undo: () => slotMutations.updateSlot({ id: slot.id, patch: before }),
      });
      return span;
    }
    const ev = findEvent(b.refId);
    if (!ev) return null;
    if (!eventWritable(ev)) return "locked";
    const patch = spanFromCalendarDrop(span.start, span.end, b.allDay);
    if (!patch) return null;
    // A series asks which occurrences, from the keyboard exactly as from a drag.
    withRecurrenceScope(extPropsOf(b), () => {}, (scope) => {
      const before = { start_at: ev.start_at, end_at: ev.end_at };
      eventMutations.updateEvent({ id: ev.id, patch, scope });
      if (scope === "THIS") {
        recordUndo({
          label: `${verb} — ${ev.title || "event"}`,
          shortLabel: verb,
          tier: "silent",
          coalesceKey: "move",
          undo: () => eventMutations.updateEvent({ id: ev.id, patch: before, scope: "THIS" }),
        });
      }
    });
    return span;
  };
  const shiftBlocks = (targets: readonly GridBlock[], how: BlockShift) => {
    let moved: { id: string; start: Date; end: Date } | null = null;
    let locked = 0;
    for (const b of targets) {
      const r = shiftBlock(b, how);
      if (r === "locked") locked++;
      else if (r) moved = { id: b.id, ...r };
    }
    if (locked && !moved) announce("This calendar is read-only");
    // The cursor follows its block across a week edge (⌥→ on Sunday).
    if (moved && targets.length === 1) revealAt(moved.id, moved.start.getTime(), moved.end.getTime());
  };

  // Gates: only a FullCalendar view, nothing floating over the grid (a popover
  // covering it turns `hotkeysEnabled` off), and only while the grid is the pane
  // last pressed in — asked at keystroke time (`keyOwner`).
  const gridKeysOn =
    hotkeysEnabled &&
    isFcView(view) &&
    !draft &&
    !taskMenu &&
    !taskRowMenu &&
    !eventMenu &&
    !slotMenu &&
    !renaming &&
    !recurrencePrompt &&
    !gatherOffer &&
    !taskEventPick;
  const onlyTasks = (targets: readonly GridBlock[], act: string): boolean => {
    if (targets.some((b) => b.kind === "task")) return false;
    announce(`${act} is for tasks — this block is ${targets[0]?.kind === "slot" ? "a slot" : "an event"}`);
    return true;
  };
  useTaskListKeys<GridBlock>({
    enabled: () => gridKeysOn && keyOwner() === "grid",
    rows: gridRows,
    handOff: false,
    cursor: {
      cursorId: gridCursor,
      homeId,
      setCursorId: (id) => {
        setGridCursor(id);
        if (id) revealBlock(id);
      },
      selectedIds: gridSelected,
      setSelectedIds: setGridSelected,
    },
    acts: {
      open: openBlock,
      complete: (targets) =>
        tasksOf(targets).forEach((t) => toggleCalendarTaskDone(t, blockEl(`task:${t.id}`))),
      trash: (targets) => targets.forEach(deleteNow),
      date: (targets) => {
        const tasks = tasksOf(targets);
        if (tasks.length) setTaskRowMenu({ kind: "date", targets: tasks, anchor: blockRect(`task:${tasks[0].id}`) });
      },
      move: (targets) => {
        const tasks = tasksOf(targets);
        if (tasks.length) setTaskRowMenu({ kind: "move", targets: tasks, anchor: blockRect(`task:${tasks[0].id}`) });
      },
      priority: (targets, p) => setPriority(tasksOf(targets), p),
      rename: startRename,
      menu: (b) => openBlockMenu(b),
      duplicate: duplicateBlocks,
      extra: (e, targets) => {
        const how = shiftForKey(e);
        if (how) {
          if (!targets.length) return false;
          shiftBlocks(targets, how);
          return true;
        }
        if (e.metaKey || e.ctrlKey || e.altKey || !targets.length) return false;
        switch (e.key) {
          // Task acts on a selection with no task in it: say so, rather than
          // letting `e` step the cursor past an event it can't finish.
          case "e":
            return onlyTasks(targets, "Done");
          case "t":
            return onlyTasks(targets, "When…");
          case "v":
            return onlyTasks(targets, "Move to…");
          case "1":
          case "2":
          case "3":
          case "4":
            return onlyTasks(targets, "Priority");
          case "Backspace":
          case "Delete":
            return deleteKey(targets);
        }
        return false;
      },
    },
  });

  /**
   * **A project, dropped on the grid** — the sitting, and what goes in it.
   *
   * The crown could already place a project's pieces one at a time; the row
   * above them is the push itself, so it places as one act: a block *typed* as
   * this project's time, holding the work that had none.
   *
   * Three rules it holds to, all of them learned:
   *  - **The week gate (P2).** Loose work joins the sprint in the same gesture
   *    that gives it a time, or the placement writes a `do_date` with no week
   *    behind it and the Sunday number stops meaning anything (D-084).
   *  - **One sitting per project, topped up in place.** Dropped onto a sitting
   *    that already exists, it grows that one rather than standing a second
   *    block with the same name beside it (D-084 again — the same defect, once
   *    from a re-plan, now from a hand).
   *  - **Nothing that already has a time moves on its own.** What was blocked
   *    elsewhere is *offered*, and waits for a press (P3).
   */
  const receiveProject = (
    el: HTMLElement,
    projectId: string,
    start: Date,
    allDay: boolean,
  ) => {
    // A fresh placement replaces whatever the last one was still offering — an
    // offer pointing at the previous sitting is worse than no offer.
    setGatherOffer(null);
    const name = el.getAttribute("data-project-title")?.trim() || "this project";
    const domainId = el.getAttribute("data-project-domain") || null;
    const idsOf = (attr: string) =>
      (el.getAttribute(attr) ?? "").split(",").filter(Boolean);
    const loose = idsOf("data-project-tasks")
      .map(resolveDroppedTask)
      .filter((t): t is Task => Boolean(t));
    const placed = idsOf("data-project-placed")
      .map(resolveDroppedTask)
      .filter((t): t is Task => Boolean(t));

    if (loose.length) onWeekWorkPlaced?.(loose.map((t) => t.id));

    // The all-day row holds no clock, so it can hold no sitting. Dropping a
    // project there is the weaker, real act it can carry: its loose work is
    // planned for that day, time still to come.
    if (allDay) {
      const date = toDateISO(start);
      if (!loose.length) {
        toast(`Every piece of ${name} already has a time this week`);
        return;
      }
      loose.forEach((t) => mutations.planFor(t, date));
      return;
    }

    const point = { ...dropPointRef.current };
    const offer = (slot: Slot) => {
      if (!placed.length) return;
      setGatherOffer({ point, slot, name, tasks: placed });
    };

    // Prefer the sitting the pointer was over (highlighted zone) to time-range
    // math, which breaks when FC snaps the ghost clear of an overlap.
    const intent = takeSlotDropIntent();
    // "Before a slot" lands the block's END on the slot's start, so it needs
    // the block's real length — the default put a 2h sitting half on top of it.
    const sittingMins = loose.length
      ? sizeSlotToContents(loose.map((t) => t.duration_minutes))
      : defaultDurationMins;
    const resolved = resolveSlotDrop(start, intent, slotsRef.current, sittingMins);

    if (resolved?.kind === "adjacent") {
      void slotMutations
        .createSlotWith(loose, resolved.start, taskDomain, {
          projectId,
          domainId,
          label: `Sat ${name} on the week`,
        })
        .then((made) => made && offer(made))
        .catch((e) => {
          console.warn("[nuvo] project sitting failed:", e);
          toast.error("Couldn't hold that sitting — the project is unchanged");
        });
      return;
    }

    if (resolved?.kind === "join") {
      slotMutations.gatherIntoSlot(resolved.slot, loose, slotTasks[resolved.slot.id] ?? []);
      offer(resolved.slot);
      return;
    }

    void slotMutations
      .createSlotWith(loose, start, taskDomain, {
        projectId,
        domainId,
        label: `Sat ${name} on the week`,
      })
      .then((made) => made && offer(made))
      .catch((e) => {
        console.warn("[nuvo] project sitting failed:", e);
        toast.error("Couldn't hold that sitting — the project is unchanged");
      });
  };

  const onReceive = useStableHandler((info: EventReceiveArg) => {
    const el = info.draggedEl;
    const start = info.event.start;
    const allDay = info.event.allDay;

    // Esc'd mid-drag: FullCalendar has already made its copy — take it away and
    // write nothing. The group was decided at pickup and dies with this drop.
    if (gestureRef.current?.take()) {
      dragGroupRef.current = null;
      info.event.remove();
      return;
    }

    // A project drags as itself — its own payload, its own drop. The phantom FC
    // made is always dropped: what renders is the sitting, out of the slots
    // cache, which the optimistic write has already put there.
    const projectId = el.getAttribute("data-project-drag");
    if (projectId) {
      info.event.remove();
      if (start) receiveProject(el, projectId, start, Boolean(allDay));
      return;
    }

    // A multi-selection drags as a group, captured at drag start (dragGroupRef);
    // a single row is just its own id. The DOM attribute is only a fallback —
    // by drop time the rail may already have re-rendered without it.
    const group = dragGroupRef.current ?? el.getAttribute("data-task-drag-group")?.split(",") ?? null;
    dragGroupRef.current = null;
    const ids = group ?? [el.getAttribute("data-task-drag") ?? ""];
    const tasks = ids.map(resolveDroppedTask).filter((t): t is Task => Boolean(t));
    // A partial placement must never look like a whole one — say what didn't
    // land rather than quietly dropping it.
    if (tasks.length < ids.filter(Boolean).length) {
      const missing = ids.filter(Boolean).length - tasks.length;
      toast.error(`${missing} of these couldn't be placed — reopen the Schedule and try again`);
    }
    if (!tasks.length || !start) {
      // Unknown item — revert as a safety fallback.
      info.revert();
      return;
    }
    // Single-task drop: the FC event already has id "task:<id>" (set in eventData),
    // which matches what fcEvents will generate. Don't revert — let FC keep the
    // event at the drop position so fcEvents reconciles it in-place without any
    // snap-back flash.
    // Multi-task drop: FC created a single phantom event we can't map to a task id.
    // Silently remove it (no snap-back animation) and let each task appear via
    // fcEvents once the optimistic cache patches land.
    if (group) info.event.remove();

    // The Week gate (P2): a `do_date` written on something with no `sprint_id`
    // walks work past the week you committed to, and the Sunday number stops
    // meaning anything. Rows dragged out of the week crown are project work
    // being deliberately placed — not reactive same-day capture — so they join
    // the week in the same gesture that gives them a time.
    if (el.getAttribute("data-task-week")) onWeekWorkPlaced?.(tasks.map((t) => t.id));

    // Dropped on the all-day row → planned for that day, time TBD (no block).
    if (allDay) {
      const date = toDateISO(start);
      tasks.forEach((t) => mutations.planFor(t, date));
      return;
    }
    // Dropped onto a slot → join it, or beside it when the pointer was on an edge.
    // Prefer the visually-highlighted target (slotDropIntentRef) over time-range
    // math, which breaks when FC snaps the ghost adjacent to avoid overlap.
    const intent = takeSlotDropIntent();
    // What actually lands: one task's own length, or the slot a group becomes.
    const landingMins =
      tasks.length > 1
        ? sizeSlotToContents(tasks.map((t) => t.duration_minutes))
        : tasks[0].duration_minutes ?? defaultDurationMins;
    const resolved = resolveSlotDrop(start, intent, slotsRef.current, landingMins);

    if (resolved?.kind === "adjacent") {
      const fromProject = el.getAttribute("data-task-project") || null;
      if (tasks.length > 1 || fromProject) {
        const { x, y } = dropPointRef.current;
        const point = new DOMRect(x, y, 0, 0);
        if (fromProject && !group) info.event.remove();
        void slotMutations
          .createSlotWith(
            tasks,
            resolved.start,
            taskDomain,
            fromProject ? { projectId: fromProject, label: "Sat it on the week" } : undefined,
          )
          .then((made) => made && !fromProject && onOpenSlot(made, point, null, { focusTitle: true }))
          .catch((e) => {
            console.warn("[nuvo] block-together failed:", e);
            toast.error("Couldn't hold that block — the tasks are unchanged");
          });
      } else {
        let cursor = resolved.start;
        tasks.forEach((t) => {
          mutations.block(t, cursor);
          cursor = new Date(cursor.getTime() + (t.duration_minutes ?? defaultDurationMins) * 60_000);
        });
        if (!group && tasks.length === 1) info.event.remove();
      }
      return;
    }

    if (resolved?.kind === "join") {
      const slot = resolved.slot;
      // If every dropped task is already in this slot, they're being dragged to
      // reschedule (from the Today rail), not re-slotted. Block them at the drop time.
      if (tasks.every((t) => t.slot_id === slot.id)) {
        let cursor = new Date(start);
        tasks.forEach((t) => {
          mutations.block(t, cursor);
          cursor = new Date(cursor.getTime() + (t.duration_minutes ?? defaultDurationMins) * 60_000);
        });
      } else {
        tasks.forEach((t) => mutations.assignToSlot(t, slot));
        // Single-task external drop: the phantom event id matches fcEvents, but
        // the task is joining a slot — drop the ghost so it doesn't snap back.
        if (!group && tasks.length === 1) info.event.remove();
      }
      return;
    }
    // Project work placed by hand becomes the project's SITTING, even when it's
    // one piece. The crown stamps `data-task-project` on the rows it offers, so
    // this is the deliberate act "give this project time" — not the everyday
    // "put this task at 9am", which still lands as its own block. Without it the
    // same project's work wore two different shapes on one grid depending on
    // which row you happened to drag.
    const fromProject = el.getAttribute("data-task-project") || null;

    // Several things dropped on open time are ONE block that holds them all —
    // a slot, sized to its contents and named from what's inside. Tiling them
    // back-to-back gave four anonymous blocks for one decision; the block is
    // the decision, and its contents are its detail. The popover opens on the
    // name so it can be yours in the same gesture — unless the project already
    // names it, in which case asking would be asking twice.
    if (tasks.length > 1 || fromProject) {
      const { x, y } = dropPointRef.current;
      const point = new DOMRect(x, y, 0, 0);
      // A single row's phantom carries the id fcEvents would generate for a
      // *task* block. It's becoming a slot child instead, so that id will never
      // be regenerated — drop the ghost rather than leave it standing.
      if (fromProject && !group) info.event.remove();
      void slotMutations
        .createSlotWith(
          tasks,
          start,
          taskDomain,
          fromProject ? { projectId: fromProject, label: "Sat it on the week" } : undefined,
        )
        .then((made) => made && !fromProject && onOpenSlot(made, point, null, { focusTitle: true }))
        .catch((e) => {
          console.warn("[nuvo] block-together failed:", e);
          toast.error("Couldn't hold that block — the tasks are unchanged");
        });
      return;
    }
    // A single task is its own block.
    tasks.forEach((t) => mutations.block(t, start));
  });

  const onDrop = useStableHandler((info: EventDropArg) => {
    const extProps = info.event.extendedProps as ExtendedProps;
    const { kind, refId } = extProps;

    // Esc'd mid-drag (#32): put it back, write nothing.
    if (gestureRef.current?.take()) {
      info.revert();
      return;
    }
    // The draft's ghost, moved: the draft moves with it — nothing is written
    // until the composer creates (#33).
    if (info.event.id === DRAFT_PREVIEW_ID) {
      const { start, end } = info.event;
      if (start && end && !info.event.allDay) setDraft((d) => (d ? { ...d, start, end } : d));
      else info.revert();
      return;
    }

    // Timed events/slots cannot become all-day by landing on the anytime row.
    // Existing all-day events may move along it (or drop onto a time).
    if (!allowAnytimeLanding({ nextAllDay: info.event.allDay, wasAllDay: info.oldEvent.allDay, kind })) {
      info.revert();
      return;
    }

    if (kind === "task") {
      const task = findTask(refId);
      if (task && info.event.start) {
        if (info.event.allDay) {
          mutations.planFor(task, toDateISO(info.event.start));
        } else {
          const intent = takeSlotDropIntent();
          const resolved = resolveSlotDrop(
            info.event.start,
            intent,
            slotsRef.current,
            task.duration_minutes ?? defaultDurationMins,
          );
          if (resolved?.kind === "adjacent") {
            mutations.block(task, resolved.start);
            info.event.remove();
          } else if (resolved?.kind === "join") {
            mutations.assignToSlot(task, resolved.slot);
            // Remove the FC ghost silently — the task rides the slot now, not its
            // own block. Revert() animates snap-back before the cache patch lands.
            info.event.remove();
          } else {
            mutations.block(task, info.event.start);
          }
        }
        if (task.recurrence_id && !task.recurrence_overridden)
          mutations.patchTask(task.id, { recurrence_overridden: true });
      }
      return;
    }

    if (kind === "slot") {
      const ns = info.event.start;
      const ne = info.event.end;
      if (ns) {
        const slot = findSlot(refId);
        const before = slot
          ? {
              start_time: slot.start_time,
              do_date: slot.do_date,
              duration_minutes: slot.duration_minutes,
              recurrence_overridden: slot.recurrence_overridden,
            }
          : null;
        const patch = {
          start_time: ns.toISOString(),
          do_date: toDateISO(ns),
          ...(ne
            ? { duration_minutes: Math.max(15, Math.round((ne.getTime() - ns.getTime()) / 60_000)) }
            : {}),
          ...(slot?.recurrence_id ? { recurrence_overridden: true } : {}),
        };
        slotMutations.updateSlot({ id: refId, patch });
        if (before) {
          recordUndo({
            label: `Moved — ${slot?.title ?? "slot"}`,
            shortLabel: "Moved",
            tier: "silent",
            coalesceKey: "move",
            undo: () => slotMutations.updateSlot({ id: refId, patch: before }),
          });
        }
      }
      return;
    }

    if (kind === "google" || kind === "icloud") {
      // Snapshot ISO strings before revert() — FullCalendar may recycle the
      // Date objects on the event, and the confirm callback runs after the
      // dialog, long after the drag. All-day spans go through exclusive-end
      // midnight so a Thu–Fri chip does not write as a timed instant.
      const allDay = info.event.allDay;
      const span = spanFromCalendarDrop(info.event.start, info.event.end, allDay);
      if (!span) { info.revert(); return; }
      const flipped = info.oldEvent.allDay !== allDay;
      const patch = flipped ? { ...span, all_day: allDay } : span;

      withRecurrenceScope(extProps, () => info.revert(), (scope) => {
        const ev = eventsRef.current.find((e) => e.id === refId);
        const before = ev
          ? { start_at: ev.start_at, end_at: ev.end_at, ...(flipped ? { all_day: ev.all_day } : {}) }
          : null;
        eventMutations.updateEvent({
          id: refId,
          patch,
          scope,
        });
        if (before && scope === "THIS") {
          recordUndo({
            label: `Moved — ${ev?.title ?? "event"}`,
            shortLabel: "Moved",
            tier: "silent",
            coalesceKey: "move",
            undo: () => eventMutations.updateEvent({ id: refId, patch: before, scope: "THIS" }),
          });
        }
      });
      return;
    }

    info.revert(); // m365 / ICS are read-only
  });

  const onResize = useStableHandler((info: EventResizeDoneArg) => {
    const extProps = info.event.extendedProps as ExtendedProps;
    const { kind, refId } = extProps;

    if (gestureRef.current?.take()) {
      info.revert();
      return;
    }
    if (info.event.id === DRAFT_PREVIEW_ID) {
      const { start, end } = info.event;
      if (start && end) setDraft((d) => (d ? { ...d, start, end } : d));
      else info.revert();
      return;
    }

    if (kind === "task") {
      const task = findTask(refId);
      if (task && info.event.start && info.event.end) {
        const ns = info.event.start;
        const mins = Math.round((info.event.end.getTime() - ns.getTime()) / 60_000);
        // A drag from the top edge moves `start` and leaves `end` fixed — only
        // patching duration would snap the block back to its old start and
        // grow it from the bottom instead. Carry the new start along whenever
        // it actually moved (bottom-edge drags leave it untouched).
        const startMoved = ns.toISOString() !== task.start_time;
        mutations.patchTask(
          task.id,
          {
            duration_minutes: Math.max(15, mins),
            ...(startMoved ? { start_time: ns.toISOString(), do_date: toDateISO(ns) } : {}),
            ...(task.recurrence_id && !task.recurrence_overridden ? { recurrence_overridden: true } : {}),
          },
          {
            undo: "silent",
            before: {
              duration_minutes: task.duration_minutes,
              ...(startMoved ? { start_time: task.start_time, do_date: task.do_date } : {}),
              recurrence_overridden: task.recurrence_overridden,
            },
            title: task.title,
            label: `Resized — ${task.title}`,
            coalesceKey: "move",
          },
        );
      }
      return;
    }

    if (kind === "slot") {
      const ns = info.event.start;
      const ne = info.event.end;
      if (ns && ne) {
        const slot = findSlot(refId);
        const before = slot
          ? {
              start_time: slot.start_time,
              do_date: slot.do_date,
              duration_minutes: slot.duration_minutes,
              recurrence_overridden: slot.recurrence_overridden,
            }
          : null;
        const patch = {
          start_time: ns.toISOString(),
          do_date: toDateISO(ns),
          duration_minutes: Math.max(15, Math.round((ne.getTime() - ns.getTime()) / 60_000)),
          ...(slot?.recurrence_id ? { recurrence_overridden: true } : {}),
        };
        slotMutations.updateSlot({ id: refId, patch });
        if (before) {
          recordUndo({
            label: `Resized — ${slot?.title ?? "slot"}`,
            shortLabel: "Resized",
            tier: "silent",
            coalesceKey: "move",
            undo: () => slotMutations.updateSlot({ id: refId, patch: before }),
          });
        }
      }
      return;
    }

    if (kind === "google" || kind === "icloud") {
      const allDay = info.event.allDay;
      const span = spanFromCalendarDrop(info.event.start, info.event.end, allDay);
      if (!span) { info.revert(); return; }

      withRecurrenceScope(extProps, () => info.revert(), (scope) => {
        const ev = eventsRef.current.find((e) => e.id === refId);
        const before = ev ? { start_at: ev.start_at, end_at: ev.end_at } : null;
        eventMutations.updateEvent({
          id: refId,
          patch: span,
          scope,
        });
        if (before && scope === "THIS") {
          recordUndo({
            label: `Resized — ${ev?.title ?? "event"}`,
            shortLabel: "Resized",
            tier: "silent",
            coalesceKey: "move",
            undo: () => eventMutations.updateEvent({ id: refId, patch: before, scope: "THIS" }),
          });
        }
      });
      return;
    }

    info.revert();
  });

  // Drag a block (or "anytime" chip) back onto the left rail → return it to the
  // Inbox. (To just drop the time but keep the day, drag it to the anytime row.)
  //
  // FullCalendar fires this only AFTER its revert animation — a drop outside the
  // grid is a "failed" drop to it — so with the default `dragRevertDuration`
  // (500ms) the block flew back to its old time for half a second before the
  // Inbox took it. The calendar sets that to 0, and the block is removed from
  // the grid here in the same tick as the write: the optimistic cache patch
  // agrees, and a failed write's rollback re-adds it through the grid sync.
  const onDragStop = useStableHandler((info: EventDragStopArg) => {
    // FullCalendar runs this BEFORE eventDrop, so it only peeks at the cancel —
    // `onDrop` consumes it (and a release off the grid fires no drop at all).
    if (gestureRef.current?.cancelled) {
      resumeGridSync();
      return;
    }
    const rail = railRef.current;
    if (rail) {
      const r = rail.getBoundingClientRect();
      const { clientX, clientY } = info.jsEvent;
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        const { kind, refId } = info.event.extendedProps as ExtendedProps;
        if (kind === "task") {
          const task = findTask(refId);
          if (task) {
            // Resume first (its stash still holds this block), then remove —
            // one batched render, so the block can't be re-added in between.
            const api = calRef.current?.getApi();
            const drop = () => {
              resumeGridSync();
              api?.getEventById(info.event.id)?.remove();
            };
            // On the implementation, not the exported type (see syncCalendarEvents).
            const batch = (api as unknown as { batchRendering?: (fn: () => void) => void } | undefined)?.batchRendering;
            if (api && batch) batch.call(api, drop);
            else drop();
            mutations.backToInbox(task, backHomeUndo(task));
            return;
          }
        }
      }
    }
    resumeGridSync();
  });

  // Every block drag or resize is a gesture Esc can call off — events and slots
  // too, which the pointer watch above doesn't arm for.
  const onFcDragStart = useCallback(() => {
    gestureRef.current?.begin();
    pauseGridSync();
  }, [pauseGridSync]);

  const onFcResizeStart = useCallback(() => {
    gestureRef.current?.begin();
    pauseGridSync();
  }, [pauseGridSync]);

  const onFcResizeStop = useCallback(() => {
    gestureRef.current?.end();
    resumeGridSync();
  }, [resumeGridSync]);

  const selectAllow = useCallback(
    (arg: { allDay: boolean; start: Date; end: Date }) =>
      !arg.allDay || canCreateEvents || toDateISO(addDays(arg.end, -1)) === toDateISO(arg.start),
    [canCreateEvents],
  );

  // Refuse a timed event/slot sliding onto the anytime row *during* the drag
  // (not only on drop) so the chip never pretends it can land there.
  const eventAllow = useCallback((dropInfo: { allDay: boolean }, dragged: EventApi | null) => {
    if (!dragged) return true;
    // A timed draft stays timed — the anytime row is a different draft.
    if (dragged.id === DRAFT_PREVIEW_ID) return !dropInfo.allDay;
    const kind = (dragged.extendedProps as ExtendedProps).kind;
    return allowAnytimeLanding({ nextAllDay: dropInfo.allDay, wasAllDay: dragged.allDay, kind });
  }, []);

  // Any all-day range — the month grid, or the anytime row in week/day view:
  // plain click/drag → all-day event (⌥ task, ⌘/Ctrl slot); a multi-day drag
  // always resolves to an event since tasks/slots can't span days.
  // `selectAllow` below already keeps a drag to one day when there's no
  // writable calendar to put a multi-day event on.
  const allDayKindFromModifiers = (je: MouseEvent | null | undefined): CreateKind => {
    let kind: CreateKind = canCreateEvents ? "event" : "task";
    if (je?.altKey) kind = canCreateEvents ? "task" : "event";
    else if (je?.metaKey || je?.ctrlKey) kind = "slot";
    return kind;
  };

  // Click-drag on empty grid → open the quick-create card. Modifiers pick the
  // type up front (⌥ event, ⌘/Ctrl slot); otherwise the toolbar create mode.
  // A drag is create intent even if the pointerdown closed a popover — the
  // dismiss guard belongs on dateClick (a tap), not here. Skipping select
  // without unselect() left FullCalendar's select-mirror stuck on the grid
  // (`unselectAuto` is false so the composer can own the ghost).
  const onSelect = useStableHandler((arg: DateSelectArg) => {
    if (isMonth || arg.allDay) {
      const je = arg.jsEvent;
      const start = new Date(arg.start);
      start.setHours(0, 0, 0, 0);
      const end = new Date(arg.end);
      end.setHours(0, 0, 0, 0);
      const inclusiveEnd = addDays(end, -1);
      const multiDay = toDateISO(inclusiveEnd) !== toDateISO(start);
      let kind = allDayKindFromModifiers(je);
      if (multiDay) kind = "event";
      setDraft({ start, end: inclusiveEnd, kind, point: { x: je?.clientX ?? 0, y: je?.clientY ?? 0 }, allDay: true });
    } else {
      clearGridSelection();
      const je = arg.jsEvent;
      let kind: CreateKind = createMode;
      if (je?.altKey) kind = "event";
      else if (je?.metaKey || je?.ctrlKey) kind = "slot";
      if (kind === "event" && !canCreateEvents) kind = "task";
      setDraft({
        start: arg.start,
        end: arg.end,
        kind,
        point: { x: je?.clientX ?? 0, y: je?.clientY ?? 0 },
      });
    }
    // React's draft preview is the ghost now. Drop FC's own mirror so it
    // can't outlive the composer if the leftover mouseup click dismisses it.
    queueMicrotask(() => calRef.current?.getApi().unselect());
  });

  const onDateClick = useStableHandler((arg: DateClickArg) => {
    // This same click may have just dismissed an open event/task/slot popover
    // (a separate system reacting to the same physical click) — that click
    // was a dismiss, not a request to also start a new draft.
    if (consumeCalendarClickHandled()) return;
    clearGridSelection(); // clicking empty space moves on from the selection
    if (draft) return;
    if (isMonth || arg.allDay) {
      const day = arg.date;
      day.setHours(0, 0, 0, 0);
      const je = arg.jsEvent;
      const kind = allDayKindFromModifiers(je);
      setDraft({ start: day, end: day, kind, point: { x: je.clientX, y: je.clientY }, allDay: true });
      return;
    }
    const start = arg.date;
    const end = new Date(start.getTime() + defaultDurationMins * 60_000);
    const je = arg.jsEvent;
    let kind: CreateKind = createMode;
    if (je?.altKey) kind = "event";
    else if (je?.metaKey || je?.ctrlKey) kind = "slot";
    if (kind === "event" && !canCreateEvents) kind = "task";
    setDraft({ start, end, kind, point: { x: je.clientX, y: je.clientY } });
  });

  const domainColor = (id: string | null) => (id ? domains.find((d) => d.id === id)?.color ?? null : null);

  const handleCreate = async ({
    kind,
    title,
    recurrence,
    attendees,
    calendar,
    domainId,
    notifyGuests,
    addMeet,
    allDay: eventAllDay,
  }: CreateDraft) => {
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
          await mutations.create(
            {
              title,
              do_date: doDate,
              ...(draftAllDay ? {} : { start_time: start.toISOString(), duration_minutes: duration }),
            },
            { undo: "silent" },
          );
        }
      } else if (kind === "event") {
        const range = eventAllDay
          ? allDayRangeFromStart(start, end)
          : { start_at: start.toISOString(), end_at: end.toISOString() };
        const target = pickCreateTarget(accounts, {
          ...createDefaults(settings),
          accountId: calendar?.accountId,
          calendarId: calendar?.calendarId,
        });
        if (!target) {
          throw new Error(
            "No visible calendar to create on. Unhide a calendar you own in Settings → Calendars.",
          );
        }
        await eventMutations.createEvent({
          title,
          ...range,
          all_day: eventAllDay,
          ...(recurrence ? { recurrence: eventRRule(recurrence, eventAllDay) } : {}),
          ...(attendees.length ? { attendees, notifyGuests } : {}),
          accountId: target.accountId,
          calendarId: target.calendarId,
          addMeet,
        });
      } else if (recurrence) {
        await recurrenceMutations.createSeries({
          kind: "slot",
          rule: recurrence,
          anchorISO: doDate,
          template: { title, duration_minutes: duration, time_of_day_minutes: minutes, domain_id: domainId, color: domainColor(domainId) },
        });
        revealFirstOccurrence();
      } else {
        const slot = await slotMutations.createSlot({
          title,
          do_date: doDate,
          start_time: start.toISOString(),
          duration_minutes: duration,
          domain_id: domainId,
          color: domainColor(domainId),
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

  const onClick = useStableHandler((info: EventClickArg) => {
    // The draft's ghost is part of the composer, not a block.
    if (info.event.id === DRAFT_PREVIEW_ID) return;
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
        // The same 5px the button's hit area reaches past its drawn box.
        return Array.from(info.el.querySelectorAll("[data-done-toggle]")).some(btn => {
          const r = btn.getBoundingClientRect();
          return x >= r.left - 5 && x <= r.right + 5 && y >= r.top - 5 && y <= r.bottom + 5;
        });
      })();
      if (onCheckbox) {
        const task = findTask(refId);
        if (task) toggleCalendarTaskDone(task, info.el);
        return;
      }
    }
    // ⇧/⌘-click grows the selection — a pick, not a request to read the block,
    // so nothing opens (the rail's modifier-click rule).
    const je = info.jsEvent;
    if (je && (je.shiftKey || je.metaKey || je.ctrlKey)) {
      toggleBlock(info.event.id);
      return;
    }
    // A plain click selects the block — to the front of any overlap, full width,
    // lifted this frame — and opens its detail. Closing the detail (Esc) leaves
    // it selected for the keys; the next Esc lets it go.
    selectBlock(info.event.id);
    if (kind === "task") {
      const task = findTask(refId);
      if (task) onOpenTask(task, info.el.getBoundingClientRect(), info.el);
    } else if (kind === "slot") {
      const slot = findSlot(refId);
      if (slot) onOpenSlot(slot, info.el.getBoundingClientRect(), info.el);
    } else {
      const evt = findEvent(refId);
      if (evt) onOpenEvent(evt, info.el.getBoundingClientRect(), info.el);
    }
  });

  // Hovering a block warms its detail payload, so the popover opens complete
  // rather than filling in a beat later (see usePrefetchEventDetails). Only a
  // *resting* pointer counts: a sweep across a dense week would otherwise fire
  // one row read per block it crossed.
  const hoverWarmRef = useRef<number | null>(null);
  const onEventHover = useStableHandler((info: { event: { extendedProps: unknown } }) => {
    const { kind, refId } = info.event.extendedProps as ExtendedProps;
    if (kind === "task" || kind === "slot") return;
    if (hoverWarmRef.current) window.clearTimeout(hoverWarmRef.current);
    hoverWarmRef.current = window.setTimeout(() => prefetchEventDetails(findEvent(refId)), 120);
  });
  const onEventUnhover = useStableHandler(() => {
    if (hoverWarmRef.current) window.clearTimeout(hoverWarmRef.current);
    hoverWarmRef.current = null;
  });
  useEffect(() => () => { if (hoverWarmRef.current) window.clearTimeout(hoverWarmRef.current); }, []);

  const renderEvent = useCallback((arg: EventContentArg) => {
    const { kind, calColor, recurring, done: doneProp } = arg.event.extendedProps as ExtendedProps;
    const inMonth = arg.view.type === "dayGridMonth";

    // ── Month view: compact dot + title pill ──────────────────────────────
    if (inMonth) {
      const dotColor = kind === "task" ? "var(--accent)" : (calColor ?? "var(--muted)");
      return (
        <div className="flex min-w-0 items-center gap-1 px-1.5 py-[2px]">
          <span
            data-evt-bar=""
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ backgroundColor: dotColor, opacity: kind === "m365" ? 0.55 : 1 }}
          />
          <span data-evt-title="" className="truncate text-label font-medium leading-none">
            {arg.event.title}
          </span>
        </div>
      );
    }

    // ── All-day task chip: "planned for the day, time TBD" — a compact pill ─
    // Same check-off as a timed block: a decorative dot made the row look like
    // work you couldn't finish from here. `onClick` already routes
    // `[data-done-toggle]` for every task kind; done anytime tasks drop off the
    // row on the next rebuild (they're filtered out of plannedTaskEvents).
    if (arg.event.allDay && kind === "task") {
      const checkColor = (arg.event.extendedProps as ExtendedProps).barColor ?? "var(--accent)";
      return (
        <div className="flex h-full min-w-0 items-center gap-1.5 overflow-hidden px-1.5">
          <button
            aria-label="toggle done"
            aria-pressed={doneProp ?? false}
            data-done-toggle
            className="relative flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border before:absolute before:-inset-[5px] before:content-['']"
            style={{ ["--evt-check-border" as string]: checkColor }}
            onMouseDown={(e) => {
              // Don't let a press on the checkbox begin an event drag.
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
          >
            <Icon name="check" size={8} className="evt-check" />
          </button>
          <span data-evt-title="" className="truncate text-label font-medium leading-none">
            {arg.event.title}
          </span>
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
    // A project-backed task — or a standing slot tied to one — reads as
    // significant work: a thicker, doubled edge, not just the domain/slot
    // tint. Without this a project slot and an empty one looked identical
    // apart from the bar color, which for most slots IS the teal already.
    const isProject =
      (kind === "task" || kind === "slot") && (arg.event.extendedProps as ExtendedProps).projectBacked === true;

    const Bar = (
      <span
        // data-evt-bar: the skin hook. This colour is inline (a domain/provider
        // hex), which no stylesheet can override without a handle — see
        // terminal.css, where a mono material repaints it from the syntax ramp.
        data-evt-bar=""
        className="shrink-0 self-stretch rounded-l-[5px]"
        style={{
          width: isProject ? 4 : 3,
          background: bar,
          opacity: kind === "m365" ? 0.5 : 1,
          boxShadow: isProject ? `inset 2px 0 0 color-mix(in srgb, ${bar} 45%, transparent)` : undefined,
        }}
      />
    );
    // One spelling for a time (D-122): `9–9:30am`, the same `span` the phone and
    // the gutter use — FullCalendar's own `9:00am - 9:30am` was a second format
    // on the same screen. A project's piece also says whose it is.
    const projectName = kind === "task" ? (arg.event.extendedProps as ExtendedProps).projectName : null;
    // An all-day span has dates, not a clock — `12–12am` is a midnight artefact.
    const when = arg.event.allDay
      ? null
      : arg.event.start && arg.event.end
        ? span(arg.event.start, arg.event.end)
        : arg.timeText;
    const Recur = recurring ? <RecurMark className="shrink-0 opacity-45" /> : null;
    // How many lines this block can really show. A 90-minute block used to
    // print one truncated title over ~50px of empty tint. The title takes the
    // lines; the time line — which the block's position already says — is the
    // first thing shed, and appears only once the title still gets two lines.
    // The repeat mark rides on that line, so it never costs the title room
    // (in a narrow week column it was eating what was left of it).
    const lines = Math.max(1, Math.floor((heightPx - 6) / 13.2)); // text-label · leading 1.2
    // A block that's MOVING is the exception: its position is exactly what's in
    // question, so a drag or resize ghost always says the time it would land on.
    const moving = arg.isMirror;
    const showTime = !compact && (moving || lines >= 3);
    // A short ghost has one row: the time goes in front of the title.
    const InlineWhen =
      moving && compact && when ? <span className="mono shrink-0 text-micro text-muted">{when}</span> : null;
    const titleLines = compact || moving ? 1 : showTime ? lines - 1 : lines;
    const titleCls =
      titleLines > 1
        ? "text-label font-semibold leading-[1.2] [overflow-wrap:anywhere]"
        : "truncate text-label font-semibold leading-[1.2]";
    const titleStyle: React.CSSProperties | undefined =
      titleLines > 1
        ? { display: "-webkit-box", WebkitLineClamp: titleLines, WebkitBoxOrient: "vertical", overflow: "hidden" }
        : undefined;
    const TimeLine = showTime && (when || projectName || recurring) ? (
      <div className="mt-px flex min-w-0 items-center gap-1 text-micro leading-none text-muted">
        <span className="min-w-0 truncate">
          {when ? <span className="mono">{when}</span> : null}
          {projectName ? <span>{when ? " · " : ""}{projectName}</span> : null}
        </span>
        {Recur}
      </div>
    ) : null;

    // ── Slot: container with a progress badge + child task peek ────────────
    if (kind === "slot") {
      const showChildren = heightPx > 64;
      // What this block IS, in words — the same designation Plan the week prints
      // over every sitting it places (`blockDesignation`), so protected project
      // time reads identically in the ritual that proposes it and on the grid
      // that holds it. The count stays in the progress badge; the eyebrow says
      // the kind, and the project's name only when the title doesn't. A block
      // sheds the least recoverable thing last, so below the height that fits an
      // eyebrow the designation moves inline ahead of the title rather than
      // reverting to a `▸` you'd have to learn.
      const designation = isProject
        ? blockDesignation({
            kind: "project",
            name: (arg.event.extendedProps as ExtendedProps).projectName ?? null,
          })
        : null;
      const showEyebrow = Boolean(designation) && !compact;
      return (
        <div className="flex h-full min-w-0 overflow-hidden">
          {Bar}
          <div className={`flex min-w-0 flex-1 flex-col overflow-hidden px-1.5 ${padY} ${compact ? "justify-center" : "justify-start"}`}>
            {showEyebrow && (
              <div
                className="truncate text-micro font-semibold uppercase leading-none"
                style={{ color: bar, letterSpacing: "0.06em" }}
              >
                {designation}
              </div>
            )}
            <div className={`flex min-w-0 items-center gap-1 ${showEyebrow ? "mt-[3px]" : ""}`}>
              <span className="truncate text-label font-semibold leading-[1.2]">
                {designation && !showEyebrow && (
                  <span className="uppercase" style={{ color: bar, letterSpacing: "0.06em" }}>
                    {/* No room for the project's name on a block this short —
                        the kind is the part that can't be recovered from the
                        title, so it's the part that survives. */}
                    {blockDesignation({ kind: "project" })} ·{" "}
                  </span>
                )}
                {arg.event.title}
              </span>
              {Recur}
              {slotTotal > 0 && (
                <span className="mono ml-auto shrink-0 rounded-full bg-bg px-1 text-micro leading-snug text-muted">
                  {slotDone}/{slotTotal}
                </span>
              )}
            </div>
            {moving && when && !compact ? <div className="mono mt-px truncate text-micro leading-none text-muted">{when}</div> : null}
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
              {InlineWhen}
              <span className={`${titleCls} ${kind === "m365" ? "text-muted" : ""}`} style={titleStyle}>
                {(arg.event.extendedProps as ExtendedProps).selfRsvp === "tentative" ? "? " : ""}
                {arg.event.title || <span className="font-normal italic text-muted">(No title)</span>}
              </span>
            </div>
            {TimeLine}
          </div>
        </div>
      );
    }

    // ── Task: checkbox tinted to its own color ─────────────────────────────
    // Done styling lives on `.fc-event.evt-done` (index.css), not on these
    // nodes — a click paints the harness class this frame, and this markup
    // must already be able to show the check without a React rerender.
    return (
      <div className="flex h-full min-w-0 overflow-hidden">
        {Bar}
        <div className={`flex min-w-0 flex-1 gap-1.5 overflow-hidden px-1.5 ${padY} ${compact ? "items-center" : "items-start"}`}>
          <button
            aria-label="toggle done"
            aria-pressed={doneProp ?? false}
            data-done-toggle
            // 14px drawn, 24px to hit: a 13×13 target on the act you do most was the
            // smallest thing on the screen (the rail's check is 15 / 24).
            className="relative mt-[1px] flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border before:absolute before:-inset-[5px] before:content-['']"
            style={{ ["--evt-check-border" as string]: bar }}
            onMouseDown={(e) => {
              // Don't let a press on the checkbox begin an event drag.
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
          >
            <Icon name="check" size={8} className="evt-check" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              {InlineWhen}
              <span data-evt-title="" className={titleCls} style={titleStyle}>
                {arg.event.title}
              </span>
            </div>
            {TimeLine}
          </div>
        </div>
      </div>
    );
  }, []);

  const isMonth = view === "dayGridMonth";
  const isYear = view === "year";

  const timeGridOptions = useMemo(
    () => ({
      slotMinTime: `${String(viewStart).padStart(2, "0")}:00:00`,
      slotMaxTime: `${String(viewEnd).padStart(2, "0")}:00:00`,
      // The anytime row is capped (D-141 sends every rolled task there, and an
      // unbounded row pushed the whole day down on a bad morning) — "+N" past
      // three rows, as Month does past four.
      dayMaxEventRows: 3,
      slotDuration: "00:15:00",
      snapDuration: "00:15:00",
      // Cascaded overlap draws a later-starting event's card over the tail of
      // an earlier one — which also covers its resize handles, making them
      // ungrabbable. Side-by-side columns keep every overlapping event fully
      // visible *and* independently resizable.
      slotEventOverlap: false,
      slotLabelInterval: "01:00",
      slotLabelFormat: { hour: "numeric" as const, hour12: true, meridiem: "short" as const },
      eventTimeFormat: { hour: "numeric" as const, minute: "2-digit" as const, hour12: true, meridiem: "short" as const },
      scrollTime: `${String(Math.max(viewStart, Math.min(fcNowRef.current.getHours() - 1, viewEnd - 1))).padStart(2, "0")}:00:00`,
    }),
    // fcNowRef, not fcNow: `scrollTime` is only read when a view mounts, and a
    // new options object on the 30s tick re-rendered — and so re-measured — the
    // whole grid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewStart, viewEnd],
  );

  // What differs between the time grid and the month, said once per view type
  // so the calendar element doesn't have to change when the view does.
  const viewOptions = useMemo(
    () => ({
      timeGrid: timeGridOptions,
      dayGridMonth: { allDaySlot: false, nowIndicator: false, expandRows: false, dayMaxEvents: 4 },
    }),
    [timeGridOptions],
  );

  // Stable identity, live value: FullCalendar's own NowTimer re-renders the
  // indicator every minute, so it still reads a fresh clock without this
  // callback — and therefore the whole calendar element — being re-created.
  const nowIndicatorContent = useCallback(
    (arg: { isAxis: boolean }) =>
      arg.isAxis ? (
        <span className="whitespace-nowrap pr-1 text-micro font-semibold leading-none tabular-nums text-signal">
          {at(fcNowRef.current)}
        </span>
      ) : null,
    [],
  );

  const dayHeaderContent = useCallback(
    (arg: { view: { type: string }; dow: number; isToday: boolean; date: Date }) => {
      const headerIsMonth = arg.view.type === "dayGridMonth";
      if (headerIsMonth) {
        return (
          <div className="flex items-center justify-center py-1.5">
            <span className="text-caption font-semibold tracking-widest text-muted">
              {DOW_LABELS[arg.dow]}
            </span>
          </div>
        );
      }
      const isToday = arg.isToday;
      const weekday = arg.date.toLocaleDateString([], { weekday: "short" }).toUpperCase();
      const dateNum = arg.date.getDate();
      const dateStr = arg.date.toLocaleDateString("en-CA");
      const wx = showWeather ? weatherIndex.get(dateStr) : undefined;
      const todayChip = isToday;
      return (
        <div className="flex flex-col items-center gap-0.5 py-1">
          <span className="text-micro font-semibold tracking-widest text-muted">
            {weekday}
          </span>
          <span
            className="masthead tabular-nums leading-none"
            style={
              todayChip
                ? {
                    fontSize: "18px",
                    color: "var(--on-signal)",
                    background: "var(--signal)",
                    borderRadius: "999px",
                    width: 28,
                    height: 28,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }
                : {
                    fontSize: "20px",
                    color: isToday ? "var(--signal)" : "var(--text)",
                  }
            }
          >
            {dateNum}
          </span>
          {wx && (
            <button
              className="fast flex items-center gap-0.5 mt-0.5 rounded px-1 hover:bg-surface-2"
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setWxPopover({ day: wx, anchor: { x: rect.left + rect.width / 2, y: rect.bottom } });
              }}
            >
              <WeatherIcon wmo={wx.wmo} size={14} />
              <span
                className="mono tabular-nums leading-none"
                style={{ fontSize: "10px", color: "var(--muted)" }}
              >
                {wx.tempHigh}°
              </span>
            </button>
          )}
        </div>
      );
    },
    [showWeather, weatherIndex],
  );

  const dayCellContent = useCallback((arg: DayCellContentArg) => {
    if (arg.view.type !== "dayGridMonth") return true;
    return (
      <span
        className="masthead tabular-nums leading-none"
        style={
          arg.isToday
            ? {
                fontSize: "13px",
                color: "var(--on-signal)",
                background: "var(--signal)",
                borderRadius: "999px",
                width: 22,
                height: 22,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }
            : {
                fontSize: "16px",
                color: arg.isOther ? "var(--muted)" : "var(--text)",
              }
        }
      >
        {arg.dayNumberText}
      </span>
    );
  }, []);

  // "Take me to that day" — search landing on a calendar event. The grid owns
  // its date, so the intent arrives on the reveal bus rather than as a prop
  // (lib/calendarReveal.ts explains why). Also drains a reveal published just
  // before this pane mounted, which is the ⌘K-from-a-floor path.
  useEffect(() => {
    const go = (r: { dateISO: string; scrollToTime?: string }) => {
      const api = calRef.current?.getApi();
      if (!api) return;
      api.gotoDate(`${r.dateISO}T12:00:00`);
      // Landing on the day is only half of "show me that": in the week view the
      // day is usually already on screen, so without this the reveal is silent.
      // Deferred a frame — `gotoDate` may swap the rendered range, and scrolling
      // the range you just left does nothing.
      if (r.scrollToTime) requestAnimationFrame(() => api.scrollToTime(r.scrollToTime!));
    };
    const pending = pendingCalendarReveal();
    if (pending) {
      go(pending);
      clearCalendarReveal();
    }
    return onCalendarReveal((r) => {
      go(r);
      clearCalendarReveal();
    });
  }, []);

  // Drilling out of the Year. FullCalendar is unmounted while the Year is up
  // (it isn't an FC view), so it remounts on `initialDate` — parking the target
  // in `remountCache` before the view flips is what lands the grid on the day
  // you clicked rather than on today. Same door the reveal bus uses when FC is
  // already alive; this is the version for when it isn't.
  const openYearDate = (d: Date, next: CalView) => {
    remountCache.dateISO = startOfDay(d).toISOString();
    onViewChange?.(next);
  };
  // The Year's props, stable across the pane's renders: it marks only which
  // DAY is today, so it hears the clock once a day rather than every 30s.
  const pickYearDay = useStableHandler((d: Date) => openYearDate(d, "timeGridDay"));
  const pickYearMonth = useStableHandler((d: Date) => openYearDate(d, "dayGridMonth"));
  const todayKey = todayISO(now);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yearNow = useMemo(() => now, [todayKey]);

  const handleDatesSet = useStableHandler((arg: DatesSetArg) => {
    // currentStart, not start: the month grid's `start` is the previous month's
    // tail, and reopening on it would show the wrong month.
    remountCache.dateISO = arg.view.currentStart.toISOString();
    onRangeChange(arg.start.toISOString(), arg.end.toISOString());
    setMonthTitle(rangeTitleFor(arg.view.type, arg.view.currentStart, arg.view.currentEnd, arg.view.title));
    setVisibleSpan({ start: arg.view.activeStart.getTime(), end: arg.view.activeEnd.getTime() });
  });

  // ── The most expensive thing on this screen ───────────────────────────────
  // `@fullcalendar/react` does NO prop diffing: its componentDidUpdate calls
  // `calendar.resetOptions(this.props)` unconditionally, which dispatches an
  // internal action and re-runs the whole sizing pass (SimpleScrollGrid
  // .handleSizing -> computeShrinkWidth, TimeColsSlats.updateSizing,
  // TableRow.querySegHeights). On a normal week that measured ~11,000
  // getBoundingClientRect() calls and ~500ms of long tasks — paid on EVERY
  // React re-render of this pane, including one caused by merely opening a
  // popover, and on every frame of a drag.
  //
  // So the element is memoized and the grid is driven imperatively instead:
  // events via `syncCalendarEvents`, the view via `changeView`, the date via
  // the API. These deps may only contain things that genuinely require
  // FullCalendar to be reconfigured; everything else is a ref or a stable
  // handler. Adding a live value here silently restores the whole regression —
  // `tests/calendar-element-stability.test.ts` guards it.
  const calendarElement = useMemo(
    () => (
          <FullCalendar
            ref={calRef}
            plugins={FC_PLUGINS}
            // Only read at mount. The pane can now mount while a non-FC view is
            // active (a reload straight into the Year), and "year" is not a
            // FullCalendar view name — it would throw. The changeView effect
            // above puts it right the moment an FC view is selected.
            initialView={isFcView(viewRef.current) ? viewRef.current : "timeGridWeek"}
            initialDate={remountCache.dateISO ?? undefined}
            headerToolbar={false}
            allDaySlot
            allDayText="anytime"
            dayMaxEventRows={5}
            firstDay={fcFirstDay}
            nowIndicator
            fixedMirrorParent={typeof document !== "undefined" ? document.body : undefined}
            // A block released off the grid used to glide back for 500ms before
            // anything happened — including a drop on the rail, which *is* a
            // decision (back to the Inbox) and waited behind the animation.
            dragRevertDuration={0}
            // An anytime chip pulled onto an hour: FullCalendar sizes its ghost
            // by this (default 1h), then the task lands at its own length — a
            // visible jump on drop. The default task length is the honest guess.
            defaultTimedEventDuration={minutesToDuration(defaultDurationMins)}
            nowIndicatorContent={nowIndicatorContent}
            // Per-view settings live in `views`, not in props keyed off the current
            // view: a prop that changes with Week ↔ Month re-created this element,
            // and FullCalendar answered with a full options reset and re-measure
            // on top of the changeView (5,492 forced layouts per switch).
            views={viewOptions}
            dayHeaderContent={dayHeaderContent}
            dayCellContent={dayCellContent}
            height="100%"
            expandRows
            dayMaxEvents={false}
            // Always keep the draft ghost out of the "+N more" overflow — a
            // packed month day would otherwise bury it behind real events.
            eventOrder={draftPreviewFirst}
            events={eventsOptionRef.current ?? []}
            editable
            eventResizableFromStart
            droppable
            selectable
            selectMirror
            unselectAuto={false}
            selectMinDistance={5}
            selectAllow={selectAllow}
            eventAllow={eventAllow}
            select={onSelect}
            dateClick={onDateClick}
            eventReceive={onReceive}
            eventDrop={onDrop}
            eventResize={onResize}
            eventDragStart={onFcDragStart}
            eventDragStop={onDragStop}
            eventResizeStart={onFcResizeStart}
            eventResizeStop={onFcResizeStop}
            eventClick={onClick}
            eventMouseEnter={onEventHover}
            eventMouseLeave={onEventUnhover}
            eventContent={renderEvent}
            eventClassNames={blockClassNames}
              eventDidMount={handleEventDidMount}
              datesSet={handleDatesSet}
            />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      fcFirstDay,
      defaultDurationMins,
      viewOptions,
      nowIndicatorContent,
      dayHeaderContent,
      dayCellContent,
      renderEvent,
      blockClassNames,
      handleEventDidMount,
      selectAllow,
      eventAllow,
      onSelect,
      onDateClick,
      onReceive,
      onDrop,
      onResize,
      onFcDragStart,
      onDragStop,
      onFcResizeStart,
      onFcResizeStop,
      onClick,
      onEventHover,
      onEventUnhover,
      handleDatesSet,
    ],
  );

  return (
    // Transparent so the single .atmosphere canvas (laid down by AppShellInner)
    // reads continuously across the spine, the rail, and the calendar grid —
    // the grid IS the paper. A solid surface here is the frost seam that made
    // the calendar a boxed widget with a gap around it.
    // `data-calendar-pane`: a press in here hands the keyboard to the grid — the
    // rail drops its cursor (LeftRail) so ⌫ in a block's menu can't also trash
    // the row the rail was pointing at.
    <div data-calendar-pane="" className="relative flex h-full min-w-0 flex-1 flex-col">
      {createError && (
        <div className="flex shrink-0 items-start gap-2 border-b border-signal bg-signal-soft px-3 py-2 text-caption text-signal">
          <span className="mt-px shrink-0">⚠</span>
          <span className="min-w-0 flex-1 break-words">{createError}</span>
          <button
            onClick={() => setCreateError(null)}
            className="fast shrink-0 rounded p-0.5 hover:opacity-70"
            aria-label="Dismiss"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {recurrencePrompt && (
        <RecurrenceDialog
          onConfirm={recurrencePrompt.onConfirm}
          onCancel={() => setRecurrencePrompt(null)}
        />
      )}

      {eventMenu && (() => {
        const ev = eventMenu.event;
        const hiddenNow = isHidden(ev);
        const series = Boolean(eventSeriesKey(ev));
        const account = accountById.get(ev.account_id);
        const writable = isWritableCalendar(account, ev.calendar_id) && !isPendingEventCreate(ev.id);
        const moveGroups = writable ? writableCalendarTargets(accounts, ev.calendar_id) : [];
        const moveCount = moveGroups.reduce((n, g) => n + g.calendars.length, 0);
        const requestDelete = (scope: RecurrenceScope) => {
          if (eventMenuHasInvitees) setEventDeleteConfirm(scope);
          else deleteEventNow(ev, scope);
        };
        const { top, left } = eventMenuPos;
        const scopeOnly = eventMenu.intent === "delete" && series && !eventDeleteConfirm;
        eventDeleteKeysRef.current = eventDeleteConfirm
          ? { confirm: () => deleteEventNow(ev, eventDeleteConfirm) }
          : scopeOnly
            ? { confirm: () => requestDelete(DELETE_SCOPES[eventDeleteLit]), pick: true }
            : {};
        if (scopeOnly) {
          return (
            <div
              ref={eventMenuRef}
              data-nested-surface=""
              role="menu"
              aria-label={`Delete ${ev.title || "event"}`}
              className="pop-in fixed z-[60] min-w-[190px] overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1"
              style={{ top, left, boxShadow: "var(--shadow-3)" }}
            >
              <div className="truncate border-b border-line px-3 py-1.5 text-meta text-muted">
                {ev.title || "Event"}
              </div>
              <div className="mono px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-widest text-muted">
                Delete
              </div>
              <EventMenuItem lit={eventDeleteLit === 0} onClick={() => requestDelete("THIS")}>
                This event
              </EventMenuItem>
              <EventMenuItem lit={eventDeleteLit === 1} onClick={() => requestDelete("FOLLOWING")}>
                This and following events
              </EventMenuItem>
              <EventMenuItem lit={eventDeleteLit === 2} onClick={() => requestDelete("ALL")}>
                All events in series
              </EventMenuItem>
            </div>
          );
        }
        return (
          <div
            ref={eventMenuRef}
            data-nested-surface=""
            className="rise elev-3 fixed z-[60] w-[224px] overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1"
            style={{ top, left }}
          >
            <div className="truncate border-b border-line px-3 py-1.5 text-meta text-muted">
              {ev.title || "Event"}
            </div>
            {/* Open leads, as it does on a task's and a slot's menu. */}
            <EventMenuItem onClick={() => {
              const el = eventMenu.el;
              setEventMenu(null);
              onOpenEvent(ev, el.getBoundingClientRect(), el);
            }}>
              Open
            </EventMenuItem>
            <div className="my-1 border-t border-line" />
            {hiddenNow ? (
              <EventMenuItem onClick={() => showEvent(ev)}>Show event</EventMenuItem>
            ) : series ? (
              <>
                <EventMenuItem onClick={() => hideEvent(ev, "THIS")}>Hide this event</EventMenuItem>
                <EventMenuItem onClick={() => hideEvent(ev, "ALL")}>Hide all events in series</EventMenuItem>
              </>
            ) : (
              <EventMenuItem onClick={() => hideEvent(ev, "THIS")}>Hide event</EventMenuItem>
            )}
            {/* Move to another calendar / account */}
            {writable && moveCount > 1 && (
              <>
                <div className="my-1 border-t border-line" />
                {eventMoveConfirm ? (
                  <div className="px-3 py-2">
                    <p className="text-caption text-ink">
                      Move a copy to <span className="font-medium">{eventMoveConfirm.name}</span>?
                    </p>
                    <p className="mt-0.5 text-meta text-muted">Repeats and guests won't carry over.</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          eventMutations.moveEventToCalendar({
                            id: ev.id,
                            targetAccountId: eventMoveConfirm.accountId,
                            targetCalendarId: eventMoveConfirm.calendarId,
                          });
                          setEventMenu(null);
                        }}
                        className="fast flex-1 rounded-[var(--radius-sm)] bg-accent px-2 py-1 text-center text-caption font-medium text-on-accent hover:opacity-90"
                      >
                        Move
                      </button>
                      <button
                        onClick={() => setEventMoveConfirm(null)}
                        className="fast flex-1 rounded-[var(--radius-sm)] border border-line px-2 py-1 text-center text-caption text-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : eventMoveMode ? (
                  <div className="max-h-[220px] overflow-y-auto py-0.5">
                    {moveGroups.map((g) => (
                      <div key={g.accountId}>
                        <div className="truncate px-3 pb-0.5 pt-1 text-micro uppercase tracking-wide text-muted/70">
                          {g.accountLabel} · {providerLabel(g.provider)}
                        </div>
                        {g.calendars.map((c) => {
                          const isCurrent = g.accountId === ev.account_id && c.id === ev.calendar_id;
                          return (
                            <EventMenuItem
                              key={c.id}
                              onClick={() => {
                                if (isCurrent) { setEventMenu(null); return; }
                                const lossy = g.accountId !== ev.account_id && (series || Boolean(ev.self_rsvp));
                                if (lossy) {
                                  setEventMoveConfirm({ accountId: g.accountId, calendarId: c.id, name: c.summary });
                                  return;
                                }
                                eventMutations.moveEventToCalendar({
                                  id: ev.id,
                                  targetAccountId: g.accountId,
                                  targetCalendarId: c.id,
                                });
                                setEventMenu(null);
                              }}
                            >
                              <span className="flex items-center gap-2">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color ?? "var(--muted)" }} />
                                <span className="min-w-0 flex-1 truncate">{c.summary}</span>
                                {isCurrent && <span className="shrink-0 text-accent">✓</span>}
                              </span>
                            </EventMenuItem>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EventMenuItem onClick={() => setEventMoveMode(true)}>Move to…</EventMenuItem>
                )}
              </>
            )}
            {/* Duplicate — tasks and slots have had it all along; an external
                event was the one thing on this grid you had to retype. Guests
                and recurrence deliberately do NOT carry: a copy that silently
                re-invited eight people would be the app mailing on the user's
                behalf, and a copied series is two series. */}
            {writable && (
              <EventMenuItem onClick={() => {
                setEventMenu(null);
                void duplicateEvent(ev)
                  .then((id) => id && selectBlock(id))
                  .catch(() => toast.error(`Couldn't copy ${ev.title || "the event"}`));
              }}>
                Duplicate
              </EventMenuItem>
            )}
            {account?.provider === "google" && ev.provider_event_id && ev.calendar_id && (
              <EventMenuItem onClick={() => {
                setEventMenu(null);
                window.open(googleEventUrl(ev.provider_event_id, ev.calendar_id), "_blank", "noopener,noreferrer");
              }}>
                Open in Google Calendar
              </EventMenuItem>
            )}
            {onConvertEventToTask && !ev.all_day && (
              <>
                <div className="my-1 border-t border-line" />
                <EventMenuItem onClick={() => { setEventMenu(null); onConvertEventToTask(ev); }}>
                  → Task
                </EventMenuItem>
              </>
            )}
            {writable && (
              <>
                <div className="my-1 border-t border-line" />
                {eventDeleteConfirm ? (
                  <div className="px-3 py-2">
                    <p className="text-caption text-ink">
                      {eventMenuCancelNotifies
                        ? series
                          ? `Cancel — ${eventMenuOtherGuests.length} ${eventMenuOtherGuests.length === 1 ? "guest is" : "guests are"} told…`
                          : `Cancel for ${eventMenuOtherGuests.length} ${eventMenuOtherGuests.length === 1 ? "guest" : "guests"}?`
                        : `Delete ${
                          eventDeleteConfirm === "ALL"
                            ? "all events in this series"
                            : eventDeleteConfirm === "FOLLOWING"
                              ? "this and following events"
                              : "this event"
                        }?`}
                    </p>
                    {/* The copy has to track what's true. A single occurrence
                        now records an undo (useCalendar's `del`), so saying
                        otherwise would be a lie that costs the user a decision.
                        A whole series still can't be put back from one row, and
                        a guest who has already been mailed stays mailed. */}
                    <p className="mt-0.5 text-meta text-muted">
                      {eventDeleteConfirm !== "THIS"
                        ? "This can't be undone."
                        : eventMenuCancelNotifies
                          ? "Undoable — but the cancellation notice can't be recalled."
                          : "You can undo this."}
                    </p>
                    <div className={`mt-2.5 flex gap-1.5 ${eventMenuCancelNotifies && !series ? "flex-col" : "items-center"}`}>
                      {eventMenuCancelNotifies && !series ? (
                        <>
                          <button
                            onClick={() => deleteEventNow(ev, eventDeleteConfirm)}
                            className="fast rounded-[var(--radius-sm)] bg-danger px-2 py-1.5 text-center text-caption font-medium text-on-danger"
                          >
                            Cancel & notify
                          </button>
                          <button
                            onClick={() => deleteEventNow(ev, eventDeleteConfirm, false)}
                            className="fast rounded-[var(--radius-sm)] border border-line px-2 py-1.5 text-center text-caption text-muted hover:text-ink"
                          >
                            Cancel quietly
                          </button>
                          <button
                            onClick={() => setEventDeleteConfirm(null)}
                            className="fast rounded-[var(--radius-sm)] border border-line px-2 py-1.5 text-center text-caption text-muted hover:text-ink"
                          >
                            Back
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => deleteEventNow(ev, eventDeleteConfirm)}
                            className="fast flex-1 rounded-[var(--radius-sm)] bg-danger px-2 py-1 text-center text-caption font-medium text-on-danger"
                          >
                            {eventMenuCancelNotifies ? "Cancel & notify" : "Delete"}
                          </button>
                          <button
                            onClick={() => setEventDeleteConfirm(null)}
                            className="fast flex-1 rounded-[var(--radius-sm)] border border-line px-2 py-1 text-center text-caption text-muted hover:text-ink"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : series ? (
                  <>
                    <EventMenuItem danger onClick={() => requestDelete("THIS")}>
                      Delete this event
                    </EventMenuItem>
                    <EventMenuItem danger onClick={() => requestDelete("ALL")}>
                      Delete all events in series
                    </EventMenuItem>
                  </>
                ) : (
                  <EventMenuItem danger onClick={() => requestDelete("THIS")}>
                    Delete event
                  </EventMenuItem>
                )}
              </>
            )}
          </div>
        );
      })()}

      {taskMenu && (
        <TaskActionsMenu
          task={taskMenu.task}
          x={taskMenu.x}
          y={taskMenu.y}
          startInDelete={taskMenu.startInDelete}
          mutations={mutations}
          onClose={closeTaskMenu}
          onOpen={() => {
            const { el, task } = taskMenu;
            setTaskMenu(null);
            onOpenTask(task, el.getBoundingClientRect(), el);
          }}
          // The block's own check: painted this frame, and a future occurrence
          // of a series redirects to today's (resolveCompleteTarget).
          onToggleDone={() => toggleCalendarTaskDone(taskMenu.task, taskMenu.el)}
          onDate={() => setTaskRowMenu({ kind: "date", targets: [taskMenu.task], anchor: taskMenu.el.getBoundingClientRect() })}
          onMove={() => setTaskRowMenu({ kind: "move", targets: [taskMenu.task], anchor: taskMenu.el.getBoundingClientRect() })}
          // ⌘D's act: the copy, selected.
          onDuplicate={() => selectBlock(duplicateTask(taskMenu.task))}
          onToEvent={
            onConvertTaskToEvent && taskMenu.task.start_time
              ? {
                  label: createTargets.choosable ? "→ Event…" : "→ Event",
                  action: () => {
                    const { task, x, y } = taskMenu;
                    setTaskMenu(null);
                    if (createTargets.choosable) setTaskEventPick({ x, y, task });
                    else onConvertTaskToEvent(task);
                  },
                }
              : undefined
          }
        />
      )}
      {taskRowMenu?.kind === "date" && (
        <TaskDateMenu anchor={taskRowMenu.anchor} targets={taskRowMenu.targets} mutations={mutations} onClose={closeTaskRowMenu} />
      )}
      {taskRowMenu?.kind === "move" && (
        <TaskMoveMenu anchor={taskRowMenu.anchor} targets={taskRowMenu.targets} mutations={mutations} onClose={closeTaskRowMenu} />
      )}
      {taskEventPick && onConvertTaskToEvent && (
        <div
          ref={taskEventPickRef}
          data-nested-surface=""
          className="rise elev-3 fixed z-[60] w-[224px] overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1"
          style={{
            top: fixedCssPx(Math.min(taskEventPick.y, window.innerHeight - 300)),
            left: fixedCssPx(Math.min(taskEventPick.x, window.innerWidth - 210)),
          }}
        >
          <div className="mono px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-widest text-muted">
            Event on
          </div>
          <CalendarTargetList
            variant="menu"
            label="Convert to an event on"
            groups={createTargets.groups}
            value={null}
            defaultTarget={createTargets.defaultTarget}
            onPick={(target) => {
              const { task } = taskEventPick;
              setTaskEventPick(null);
              onConvertTaskToEvent(task, target);
            }}
          />
        </div>
      )}

      {renaming && (
        <BlockRenameField
          key={renaming.block.id}
          rect={renaming.rect}
          locate={() => blockEl(renaming.block.id)?.getBoundingClientRect() ?? null}
          initial={renaming.title}
          onDone={(title) => commitRename(renaming.block, title)}
        />
      )}

      {slotMenu && (() => {
        const slot = slotMenu.slot;
        const childCount = slotTasks[slot.id]?.length ?? 0;
        const recurring = Boolean(slot.recurrence_id);
        const { top, left } = slotMenuPos;
        return (
          <div
            ref={slotMenuRef}
            data-nested-surface=""
            className="rise elev-3 fixed z-[60] w-[224px] overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1"
            style={{ top, left }}
          >
            <div className="truncate border-b border-line px-3 py-1.5 text-meta text-muted">
              {slotTitle(slot)}
            </div>
            <EventMenuItem onClick={() => {
              const el = slotMenu.el;
              const rect = el.getBoundingClientRect();
              setSlotMenu(null);
              onOpenSlot(slot, rect, el);
            }}>
              Open
            </EventMenuItem>
            <EventMenuItem onClick={() => {
              setSlotMenu(null);
              selectBlock(duplicateSlot(slot));
            }}>
              Duplicate
            </EventMenuItem>
            {/* Project time has a fourth act, and it isn't Delete: deleting the
                block left the project on the week and its work stranded on the
                day. The card says what each way out clears before you press. */}
            {slot.project_id && (
              <EventMenuItem onClick={() => {
                setDeferOffer({ x: slotMenu.x, y: slotMenu.y, slot });
                setSlotMenu(null);
              }}>
                Can’t get to this…
              </EventMenuItem>
            )}
            <div className="my-1 border-t border-line" />
            <EventMenuItem danger onClick={() => {
              const el = slotMenu.el;
              const rect = el.getBoundingClientRect();
              setSlotMenu(null);
              // A plain, empty, non-recurring slot deletes outright. Anything with
              // occurrence scope or tasks inside needs the full picker in the slot
              // detail panel (SlotDeleteButton) — don't reimplement that choice here.
              if (!recurring && childCount === 0) slotMutations.removeSlot(slot);
              else onOpenSlot(slot, rect, el);
            }}>
              {!recurring && childCount === 0 ? "Delete slot" : "Delete slot…"}
            </EventMenuItem>
          </div>
        );
      })()}

      {deferOffer && (
        <DeferCard slot={deferOffer.slot} point={deferOffer} onClose={closeDeferOffer} />
      )}

      {/* ── the reconcile card ───────────────────────────────────────────────
          A project's sitting is placed, and some of its work already had a time
          elsewhere this week. It says WHERE that work is — a count alone would
          make "move them in" a decision you can't check — and moves nothing
          until you press. One press, one undo. */}
      {gatherOffer && (() => {
        const { point, slot, name, tasks: waiting } = gatherOffer;
        const left = fixedCssPx(Math.min(point.x + 12, window.innerWidth - 280));
        const top = fixedCssPx(Math.min(point.y + 12, window.innerHeight - 190));
        const when = (t: Task) => {
          const iso = t.start_time;
          if (!iso) return "in a sitting";
          const d = new Date(iso);
          const h = d.getHours();
          const m = d.getMinutes();
          const hh = ((h + 11) % 12) + 1;
          return `${format(d, "EEE")} ${m === 0 ? hh : `${hh}:${String(m).padStart(2, "0")}`}${h >= 12 ? "pm" : "am"}`;
        };
        return (
          <div
            ref={gatherOfferRef}
            data-nested-surface=""
            // Opaque, like every other menu on this pane: it sits ON the block it
            // just made, and a translucent card over a tinted sitting is two
            // things you have to read through each other.
            className="pop-in fixed z-[60] w-[264px] rounded-[var(--radius)] border border-line bg-surface p-3"
            style={{ top, left, boxShadow: "var(--shadow-3)" }}
          >
            <div className="section-label !px-0 !pb-0 truncate" style={{ color: "var(--accent)" }}>
              {name}
            </div>
            <p className="mt-1.5 text-caption text-ink">
              Sitting placed. {waiting.length} piece{waiting.length === 1 ? "" : "s"} already{" "}
              {waiting.length === 1 ? "has" : "have"} a time this week.
            </p>
            <div className="mt-1.5 border-t border-line">
              {waiting.slice(0, 3).map((t) => (
                <div key={t.id} className="flex items-baseline gap-2 border-b border-line py-1">
                  <span className="mono shrink-0 text-micro text-muted">{when(t)}</span>
                  <span className="min-w-0 flex-1 truncate text-meta text-muted" title={t.title}>
                    {t.title}
                  </span>
                </div>
              ))}
              {waiting.length > 3 && (
                <div className="pt-1 text-micro text-muted">+{waiting.length - 3} more</div>
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                onClick={() => {
                  slotMutations.gatherIntoSlot(slot, waiting, slotTasks[slot.id] ?? []);
                  setGatherOffer(null);
                }}
                title="Move them out of their own blocks and into this sitting"
                className="tap fast flex-1 rounded-md px-2.5 py-1.5 text-caption text-accent hover:brightness-105"
                style={{ background: "var(--accent-soft)" }}
              >
                Move them in
              </button>
              <button
                onClick={() => setGatherOffer(null)}
                className="fast shrink-0 px-1.5 py-1.5 text-caption text-muted hover:text-ink"
              >
                Leave them
              </button>
            </div>
          </div>
        );
      })()}

      {draft && (
        <DraftComposer
          start={draft.start}
          end={draft.end}
          point={draft.point}
          initialKind={draft.kind}
          allDay={draft.allDay}
          googleAvailable={canCreateEvents}
          domains={domains}
          meetPreference={settings?.auto_add_meet}
          onCreate={handleCreate}
          onCancel={() => {
            setDraft(null);
            calRef.current?.getApi().unselect();
          }}
          onNudge={
            draft.allDay
              ? undefined
              : (edge, minutes) =>
                  setDraft((d) => {
                    if (!d) return d;
                    const how: BlockShift =
                      edge === "end" ? (minutes < 0 ? "shorter" : "longer") : minutes < 0 ? "earlier" : "later";
                    const next = shiftSpan({ start: d.start, end: d.end }, how);
                    return next ? { ...d, ...next } : d;
                  })
          }
        />
      )}

      {/* ── Navigation bar — two clusters (nav · altitude/door) with a flexible
            drag-region gap between. Also fills the macOS titlebar zone (titlebar-pad). */}
      <div
        data-tauri-drag-region="deep"
        // `pb-2`, not `py-2`: `.titlebar-pad` owns the top (its own 0.5rem base
        // plus the macOS titlebar inset), and declaring padding-top here too
        // just re-creates the collision that flattened it — see index.css.
        className="titlebar-pad grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-4 pb-2"
      >
        {/* Left — Show panels (focus exit only) + period nav */}
        <div className="flex min-w-0 items-center gap-1">
          {onToggleFocus && focusMode && (
            <button
              onClick={onToggleFocus}
              className="fast mr-0.5 flex h-6 shrink-0 items-center gap-1.5 rounded-full border py-0.5 pl-1.5 pr-2.5 text-label font-medium"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-soft)" }}
              title="Show panels (⌘.)"
              aria-pressed={true}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" strokeWidth="1.3" />
                <line x1="6" y1="2.75" x2="6" y2="13.25" strokeWidth="1.3" />
                <path d="M8.75 6 10.75 8l-2 2" strokeWidth="1.2" />
              </svg>
              <span className="leading-none">Show panels</span>
            </button>
          )}

          {view !== "board" && (
            <>
              <button
                onClick={() => pageBy(-1)}
                className="fast flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
                title="Previous (⌘← or −)"
              >
                <Icon name="chevron-left" size={14} />
              </button>
              <button
                onClick={() => pageBy(1)}
                className="fast flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
                title="Next (⌘→ or =)"
              >
                <Icon name="chevron-right" size={14} />
              </button>
              <button
                onClick={pageToday}
                className="fast shrink-0 rounded border border-line px-2 py-0.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
                title="Go to today (⌘T)"
              >
                Today
              </button>
            </>
          )}
          <div data-tauri-drag-region className="min-w-2 flex-1 self-stretch" />
        </div>

        {/* Center — what span you're looking at, for every view. Week and Day
              used to lean on the rail's "THIS WEEK" label, but that names the
              week you PLANNED (the sprint), not the one on screen: page forward
              and nothing said which week this was, and in focus mode there was
              no label at all. The Year's numeral sits in this seat so the pane
              itself does not repeat it (D-129). */}
        {view !== "board" ? (
          <div
            data-tauri-drag-region
            className="pointer-events-none flex max-w-[220px] select-none justify-center truncate leading-none"
          >
            <span className="masthead truncate text-lead leading-none text-text">
              {isYear ? yearCursor : monthTitle}
            </span>
          </div>
        ) : (
          <div className="w-0" data-tauri-drag-region />
        )}

        {/* Right — quiet clock · week door · altitude · overflow. No overflow-hidden
            here — the ··· menu drops below and must be allowed to paint. */}
        <div className="flex min-w-0 items-center justify-end gap-1">
          <div data-tauri-drag-region className="min-w-2 flex-1 self-stretch" />
          {/* Only while you're away from home — at home it said "you are where
              you live" in the busiest strip on screen (the phone hides it too). */}
          <TimeZoneChip now={now} hideAtHome />

          {onOpenWeekPlan && weekGlyph && (
            <button
              onClick={onOpenWeekPlan}
              className={`fast relative flex shrink-0 items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-1.5 text-label font-medium ${
                weekButtonGlow ? "text-ink" : "border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
              style={weekButtonGlow ? { borderColor: "var(--signal)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--signal) 18%, transparent)" } : undefined}
              title={weekButtonTitle ?? weekButtonLabel}
            >
              <WeekEmblem spec={weekGlyph} state="forming" size={18} hideAmbient />
              <span className="leading-none">{weekButtonLabel}</span>
              {weekButtonGlow && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ background: "var(--signal)" }} />}
            </button>
          )}

          {onViewChange && (
            <div data-tabs="views" className="inline-flex shrink-0 items-center gap-0 rounded-full border border-line bg-surface-2 p-0.5">
              {(["board", "timeGridDay", "timeGridWeek", "dayGridMonth", "year"] as const).map((v) => {
                const on = view === v;
                return (
                  <button
                    key={v}
                    data-on={on}
                    onClick={() => onViewChange(v)}
                    // The whole switcher measured 15px tall — half the WCAG
                    // 2.5.8 floor on the control that changes what the primary
                    // surface even shows. The pill grows to the 24px floor via
                    // the hit box, not the type: `tap-desk-h` plus centring, so
                    // the segmented control looks identical and is twice the
                    // target.
                    className="tap-desk-h fast inline-flex items-center justify-center rounded-full px-2 py-0.5 text-label leading-none"
                    style={{
                      background: on ? "var(--surface)" : "transparent",
                      color: on ? "var(--accent)" : "var(--muted)",
                      fontWeight: on ? 600 : 500,
                      boxShadow: on ? "var(--shadow-1)" : "none",
                    }}
                  >
                    {v === "board"
                      ? "Spread"
                      : v === "timeGridDay"
                        ? "Day"
                        : v === "timeGridWeek"
                          ? "Week"
                          : v === "dayGridMonth"
                            ? "Month"
                            : "Year"}
                  </button>
                );
              })}
            </div>
          )}

          {/* Overflow — refresh, show-hidden, recurring upkeep. */}
          <div className="relative shrink-0">
            <button
              onClick={() => setUtilsOpen((o) => !o)}
              className="fast flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
              title="More calendar tools"
              aria-expanded={utilsOpen}
              aria-haspopup="menu"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
                <circle cx="3" cy="7" r="1.15" />
                <circle cx="7" cy="7" r="1.15" />
                <circle cx="11" cy="7" r="1.15" />
              </svg>
            </button>
            {utilsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUtilsOpen(false)} />
                <div
                  role="menu"
                  className="rise elev-2 absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-[var(--radius)] border border-line bg-surface py-1"
                >
                  {onOpenUpkeep && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        onOpenUpkeep();
                        setUtilsOpen(false);
                      }}
                      className="fast flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-label text-ink hover:bg-accent-soft"
                    >
                      <span className="mono text-micro">↻</span>
                      <span>Recurring upkeep</span>
                    </button>
                  )}
                  {onRefreshCalendars && (
                      <button
                        role="menuitem"
                        disabled={refreshingCalendars}
                        onClick={(e) => {
                          if (e.shiftKey && onFullRefreshCalendars) onFullRefreshCalendars();
                          else onRefreshCalendars();
                          setUtilsOpen(false);
                        }}
                        className="fast flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-label text-ink hover:bg-accent-soft disabled:opacity-40"
                      >
                        <Icon name="refresh" size={14} className={refreshingCalendars ? "animate-spin" : undefined} />
                        <span className="flex-1">Refresh calendars</span>
                        <span className="text-micro text-muted">⇧ full</span>
                      </button>
                    )}
                    {hiddenKeys.size > 0 && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setShowHidden((v) => !v);
                          setUtilsOpen(false);
                        }}
                        className="fast flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-label hover:bg-accent-soft"
                        style={showHidden ? { color: "var(--accent)" } : undefined}
                      >
                        {showHidden ? (
                          <Icon name="eye" size={14} />
                        ) : (
                          <Icon name="eye-off" size={14} />
                        )}
                        <span>
                          {showHidden
                            ? `Hide ${hiddenKeys.size} again`
                            : `Show ${hiddenKeys.size} hidden`}
                        </span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
        </div>
      </div>

      {/* ── The Week Board — "which day" altitude, a toggle away from the grid ── */}
      {view === "board" && (
        <WeekBoard
          now={now}
          settings={settings}
          taskAccent={taskAccent}
          mutations={mutations}
          onOpenTask={onOpenTask}
          resolveDropTask={resolveDropTask}
        />
      )}

      {/* ── The grid stack ────────────────────────────────────────────────
            The Year and FullCalendar share one relative box and are BOTH
            absolutely positioned inside it, both always at the pane's real
            size. That is what makes switching between them free:

            · Neither is unmounted, so neither is rebuilt. FullCalendar cost
              **111ms of blocking main thread** to construct, and the Year costs
              ~150ms to mount 365 cells — paid once each, not per click.
            · Neither ever loses its box. `display:none` measures as zero, so a
              revealed FullCalendar had to re-measure its whole grid before it
              could be drawn; `invisible` over a stable `inset-0` keeps the
              geometry it already had, and the reveal is a paint.

            The Year mounts LAZILY and then stays (`yearEverOpened`) — always
            mounting it would move its cost onto app boot, which is the one
            place nobody is waiting for a year.

            The Spread (`board`) is a different animal: it replaces the pane
            rather than sharing it, so the whole stack stands down for it. */}
      <div className={`relative min-h-0 flex-1 ${view === "board" ? "hidden" : ""}`}>
        {yearEverOpened && (
          <div
            className={`absolute inset-0 flex flex-col ${view === "year" ? "" : "invisible pointer-events-none"}`}
            aria-hidden={view !== "year"}
          >
            <CalendarYear
              year={yearCursor}
              now={yearNow}
              weekStartsOn={firstDayOfWeek(settings)}
              onPickDay={pickYearDay}
              onPickMonth={pickYearMonth}
            />
          </div>
        )}

        {/* FullCalendar — the other half of the stack. See the box above. */}
        <div
          ref={wrapRef}
          className={`nuvo-cal-host absolute inset-0 p-2 ${isFcView(view) ? "" : "invisible pointer-events-none"}`}
          aria-hidden={!isFcView(view)}
        style={
          {
            "--nuvo-hour": `${pxPerHour}px`,
            // Counter document CSS zoom so FC's getBoundingClientRect ↔ pageX
            // math agrees (otherwise select/create/drag land on the wrong slot).
            // Nested zoom keeps the host filling the pane visually — see
            // docs in useUiScale / index.css `.fc-event-dragging`.
            zoom: uiScale === 1 ? undefined : 1 / uiScale,
          } as React.CSSProperties
        }
      >
        {calendarElement}
        </div>
      </div>

      {wxPopover && (
        <WeatherPopover
          day={wxPopover.day}
          city={weatherData?.city}
          anchor={wxPopover.anchor}
          onClose={() => setWxPopover(null)}
        />
      )}
    </div>
  );
}

export default memo(CalendarPane, skipWhenAsleep);

/** A block let go over the rail leaves the calendar for its resting place.
 *  Say which, with an undo — the same courtesy a drop on a rail tab gets
 *  (D-063a). Project work rests in its project, never the Inbox. */
function backHomeUndo(task: Task) {
  const where = task.project_id ? "Back to its project" : "Back to Inbox";
  return { undo: "toast" as const, label: `${where} — ${task.title}` };
}

/** The toolbar's one line about the span on screen — the phone's hero in the
 *  same words: `Oct 12 – 18` (`Sep 28 – Oct 4` across months), `Thu, Oct 15`,
 *  `October 2026`. */
function rangeTitleFor(type: string, start: Date, endExclusive: Date, fcTitle: string): string {
  if (type === "timeGridDay") return format(start, "EEE, MMM d");
  if (type === "timeGridWeek") {
    const end = addDays(endExclusive, -1);
    return `${format(start, "MMM d")} – ${format(end, format(start, "MMM") === format(end, "MMM") ? "d" : "MMM d")}`;
  }
  return fcTitle;
}

function minutesToDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** One row in a calendar menu — the same row TaskActionsMenu draws: one
 *  height, one hover (`bg-bg`), and destructive items in ink at rest that turn
 *  `--danger` under the pointer (D-101), not `--signal` (which means "now").
 *  `lit` = the keyboard's choice. */
function EventMenuItem({
  children,
  onClick,
  danger = false,
  lit = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  lit?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`fast block min-h-7 w-full truncate px-3 py-1.5 text-left text-caption hover:bg-bg ${
        lit ? "bg-bg" : ""
      } ${danger ? (lit ? "text-danger" : "text-ink hover:text-danger") : "text-ink"}`}
    >
      {children}
    </button>
  );
}

/**
 * ⌘E on a block: its title, edited where it's drawn (D-158) — the rail's rename
 * in place, on the grid. ↵ or a click away keeps it, Esc puts it back. A plain
 * text input, so dictation works (low-data-entry).
 */
function BlockRenameField({
  rect: at,
  locate,
  initial,
  onDone,
}: {
  rect: DOMRect;
  /** Where the block is now — the field rides it when the grid scrolls. */
  locate: () => DOMRect | null;
  initial: string;
  onDone: (title: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const [rect, setRect] = useState(at);
  const locateRef = useRef(locate);
  locateRef.current = locate;
  useEffect(() => {
    const follow = () => {
      const next = locateRef.current();
      if (next) setRect(next);
    };
    document.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
    };
  }, []);
  const done = useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  const width = Math.max(rect.width, 200);
  const left = Math.min(rect.left, window.innerWidth - width - 8);
  return (
    <div
      data-nested-surface=""
      className="fixed z-[70] rounded-[var(--radius-sm)] border border-line bg-surface p-0.5"
      style={{
        top: fixedCssPx(Math.max(8, rect.top - 2)),
        left: fixedCssPx(Math.max(8, left)),
        width: fixedCssPx(width),
        boxShadow: "var(--shadow-lift)",
      }}
    >
      <input
        autoFocus
        aria-label="Rename"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(value);
          } else if (e.key === "Escape") {
            // Only the field: the block stays selected under it.
            e.preventDefault();
            e.nativeEvent.stopImmediatePropagation();
            finish(null);
          }
        }}
        onBlur={() => finish(value)}
        className="w-full rounded-[var(--radius-sm)] bg-transparent px-1.5 py-1 text-label font-semibold text-ink outline-none"
      />
    </div>
  );
}
