import { format } from "date-fns";
import { Icon } from "./Icon";
import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import type { DatesSetArg, DateSelectArg, DayCellContentArg, EventClickArg, EventContentArg, EventDropArg, EventMountArg } from "@fullcalendar/core";
import type { DateClickArg, EventReceiveArg, EventResizeDoneArg, EventDragStopArg } from "@fullcalendar/interaction";
import type { CalendarAccount, ExternalEvent, RecurrenceScope, Slot, Task, UserSettings } from "../lib/types";
import { DEFAULT_DURATION_MINUTES } from "../lib/types";
import { firstDayOfWeek } from "../hooks/useSettings";
import { allDayRangeFromStart, endOf, isOverdue, parseDateISO, toDateISO } from "../lib/dates";
import { addDays } from "date-fns";
import { expandRule, toGoogleRRULE } from "../lib/recurrence";
import type { useTaskMutations } from "../hooks/useTasks";
import { useEventDetails, useHiddenEvents, type useExternalEventMutations } from "../hooks/useCalendar";
import { eventSeriesKey } from "../lib/now";
import { synClass } from "../lib/syntax";
import { isReadOnlyCalendarId, isWritableAccount, providerLabel, writableCalendarTargets } from "../lib/calendarWrite";
import type { useSlotMutations } from "../hooks/useSlots";
import { HORIZON_DAYS, useRecurrences, type useRecurrenceMutations } from "../hooks/useRecurrence";
import DraftComposer, { type CreateDraft, type CreateKind } from "./DraftComposer";
import { RecurMark } from "./ui";
import WeekEmblem from "./floors/WeekEmblem";
import WeekBoard from "./floors/WeekBoard";
import type { EmblemSpec } from "../lib/weekEmblem";
import { useWeather, indexWeather, type WeatherDay } from "../hooks/useWeather";
import WeatherIcon from "./WeatherIcon";
import WeatherPopover from "./WeatherPopover";
import TimeZoneChip from "./TimeZoneChip";
import { fixedCssPx, useUiScale } from "../hooks/useUiScale";
import { useOptionalUndoStack } from "../hooks/useUndoStack";
import { consumeCalendarClickHandled } from "../lib/calendarDismissGuard";

export type CalView = "timeGridWeek" | "timeGridDay" | "dayGridMonth" | "board";

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
  onConvertTaskToEvent?: (task: Task) => void;
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
  // Tracks the slot id the pointer is hovering over during a task drag.
  // onReceive reads this to prefer the visually-highlighted slot over time-range math,
  // which breaks when FC snaps the ghost adjacent to the slot to avoid overlap.
  const overSlotIdRef = useRef<string | null>(null);
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;

  // Hidden events (Fantastical-style): kept off the board + out of the busy math.
  // `showHidden` reveals them dimmed so you can bring one back. The context menu /
  // popover toggle the per-event hidden state.
  const { keys: hiddenKeys, isHidden, hiddenKeyFor, hide, unhide } = useHiddenEvents();
  const [showHidden, setShowHidden] = useState(false);
  const [eventMenu, setEventMenu] = useState<{ x: number; y: number; event: ExternalEvent } | null>(null);
  const { data: eventMenuDetails } = useEventDetails(eventMenu?.event.id ?? null);
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
  const [taskMenu, setTaskMenu] = useState<{ x: number; y: number; task: Task; el: HTMLElement } | null>(null);
  // Recurring-task trash expands in place (this / following / series) — same
  // scopes as RecurrenceDeleteButton in the task popover.
  const [taskDeleteMode, setTaskDeleteMode] = useState(false);
  const [slotMenu, setSlotMenu] = useState<{ x: number; y: number; slot: Slot; el: HTMLElement } | null>(null);
  const { data: recurrences = [] } = useRecurrences();
  const recurrenceById = useMemo(
    () => new Map(recurrences.map((r) => [r.id, r])),
    [recurrences],
  );

  // Can the user create real calendar events? True when any writable account
  // (Google or iCloud two-way) is connected.
  const canCreateEvents = useMemo(
    () => accounts.some((a) => isWritableAccount(a)),
    [accounts],
  );

  const writableAccounts = useMemo(
    () =>
      accounts
        .filter((a) => isWritableAccount(a))
        .map((a) => ({ id: a.id, email: a.email, provider: a.provider })),
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

  // Trackpad horizontal swipe pages the period (Fantastical/Google Calendar
  // convention) — a mostly-horizontal wheel gesture goes to next/prev instead
  // of doing nothing (the grid has no native horizontal scroll to hijack).
  // Fires once per gesture: crossing the threshold locks further paging until
  // the gesture pauses (deltaX events stop for a beat), so one swipe = one page.
  useEffect(() => {
    if (view === "board") return; // WeekBoard has no FC api to page
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
        const taskId = el.getAttribute("data-task-drag");
        const groupAttr = el.getAttribute("data-task-drag-group");
        const groupCount = groupAttr?.split(",").length ?? 1;
        return {
          // For single-task drops, give the FC event the same id that fcEvents
          // will generate ("task:<id>"). That way FC keeps the event exactly where
          // the user dropped it and fcEvents reconciles it in-place — no snap-back.
          ...(!groupAttr && taskId ? { id: `task:${taskId}` } : {}),
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
    let moved = false;
    let startX = 0;
    let startY = 0;
    let overSlot: HTMLElement | null = null;
    let dragId: string | null = null; // external [data-task-drag] id (rail / slot popover row)
    let fromRail = false; // did this drag start inside the rail itself?
    let calTask = false; // calendar block being dragged (inbox via eventDragStop, not here)
    let overRail = false; // is the pointer currently over the rail?
    // Rail-origin drags (reorder, and the tab strip's take-it-off-the-day /
    // put-it-on-the-day acts) belong to the rail — `LeftRail`'s `useListReorder`
    // owns them, chip and Undo included. This effect keeps only what it alone
    // can know: a CALENDAR item dragged over the rail, where the whole rail is
    // the zone.
    // A cursor-following label that names the slot you're about to drop into. The
    // ghost fades to ~10% over a slot, so this is what tells you the target — and it
    // shows the full slot title even when a narrow/inset slot truncates its own.
    const chip = document.createElement("div");
    chip.className = "slot-drop-chip";
    chip.setAttribute("aria-hidden", "true");
    document.body.appendChild(chip);
    const reset = () => {
      document.body.classList.remove("cal-dragging", "over-slot");
      overSlot?.classList.remove("slot-drop-target");
      overSlot = null;
      chip.classList.remove("is-visible");
      railRef.current?.classList.remove("rail-drop-active", "rail-return-armed");
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      armed = Boolean(el?.closest?.("[data-task-drag], .evt-task"));
      const dragEl = el?.closest?.("[data-task-drag]") as HTMLElement | null;
      dragId = dragEl?.getAttribute("data-task-drag") ?? null;
      fromRail = Boolean(dragEl && railRef.current?.contains(dragEl));
      calTask = Boolean(el?.closest?.(".evt-task"));
      startX = e.clientX;
      startY = e.clientY;
      moved = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!armed) return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
      if (!moved) {
        moved = true;
        active = true;
        document.body.classList.add("cal-dragging");
      }
      // Hit-test slots by geometry, not elementFromPoint: FullCalendar stacks the
      // .fc-highlight selection box and the drag mirror *above* the slot event, so
      // elementFromPoint+closest never sees the slot and the drop lands beside it.
      // Instead walk the slot rects and accept the pointer anywhere in the slot's
      // full-width time band (the whole column row, not just the rendered block) —
      // so the entire slot reads as one generous drop zone.
      let slotEl: HTMLElement | null = null;
      for (const el of document.querySelectorAll<HTMLElement>(".fc-event.evt-slot")) {
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom) continue;
        const col = el.closest<HTMLElement>(".fc-timegrid-col");
        const cr = col?.getBoundingClientRect() ?? r;
        if (e.clientX >= cr.left && e.clientX <= cr.right) { slotEl = el; break; }
      }
      if (slotEl !== overSlot) {
        overSlot?.classList.remove("slot-drop-target");
        slotEl?.classList.add("slot-drop-target");
        overSlot = slotEl;
        overSlotIdRef.current = slotEl?.getAttribute("data-slot-id") ?? null;
        // Slots use a custom renderer (no .fc-event-title); .fc-event-main holds
        // just the slot title, no time text.
        const title = slotEl?.querySelector(".fc-event-main")?.textContent?.trim();
        chip.textContent = `↳ Drop into ${title || "this slot"}`;
      }
      document.body.classList.toggle("over-slot", Boolean(slotEl));
      if (slotEl) {
        // clientX/Y are post-zoom; fixed left/top are pre-zoom under CSS zoom.
        chip.style.left = `${fixedCssPx(e.clientX + 14)}px`;
        chip.style.top = `${fixedCssPx(e.clientY + 16)}px`;
        chip.classList.add("is-visible");
      } else {
        chip.classList.remove("is-visible");
      }
      const rail = railRef.current;
      if (rail) {
        const rr = rail.getBoundingClientRect();
        const onRail =
          e.clientX >= rr.left && e.clientX <= rr.right && e.clientY >= rr.top && e.clientY <= rr.bottom;
        overRail = onRail && !slotEl;
        // Calendar → rail only: the WHOLE rail is the inbox zone, so the whole
        // rail takes the wash. A drag that started *inside* the rail is the
        // rail's own business — tinting it there said "drop anywhere here",
        // which was never true.
        rail.classList.toggle(
          "rail-drop-active",
          !fromRail && overRail && (Boolean(dragId) || calTask),
        );
      }
    };
    const onUp = () => {
      // Capture drag state before resetting — needed to suppress the phantom
      // click the browser fires on the original element after any drag gesture.
      const swallowClick = moved && fromRail;
      armed = false;
      if (active && moved) {
        active = false;
        const dropInbox = Boolean(dragId) && !fromRail && overRail;
        if (dropInbox) {
          const dragEl = document.querySelector<HTMLElement>(`[data-task-drag="${dragId}"]`);
          const group = dragEl?.getAttribute("data-task-drag-group");
          const ids = group ? group.split(",") : [dragId];
          ids.forEach((id) => {
            const task = tasksRef.current.find((t) => t.id === id);
            if (task) mutationsRef.current.backToInbox(task);
          });
        }
        // onReceive fires after onUp in the same task. Clear overSlotIdRef after a
        // microtask so onReceive can read it; if no drop occurred it clears itself.
        Promise.resolve().then(() => { overSlotIdRef.current = null; });
        reset();
      } else if (!moved) {
        reset();
      }
      dragId = null;
      fromRail = false;
      calTask = false;
      moved = false;
      overRail = false;
      // After dragging from the rail (whether dropped, cancelled, or returned),
      // the browser fires a click on the original TaskRow. Eat it once so the
      // task popover doesn't open when the user changes their mind mid-drag.
      if (swallowClick) {
        document.addEventListener("click", (e) => { e.stopPropagation(); }, { capture: true, once: true });
      }
    };
    // Abandoning a drag must clear the glow too. Without these, Escape (which
    // the rail's reorder honours) or a cancelled pointer left `cal-dragging` on
    // the body — every day cell still lit for a drag that had already ended.
    const onAbort = () => {
      armed = false;
      active = false;
      moved = false;
      dragId = null;
      fromRail = false;
      calTask = false;
      overRail = false;
      overSlotIdRef.current = null;
      reset();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAbort();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onAbort, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onAbort, true);
      window.removeEventListener("keydown", onKey);
      reset();
      chip.remove();
    };
  }, [railRef]);

  useEffect(() => {
    if (view === "board") return; // the board isn't a FullCalendar view
    const api = calRef.current?.getApi();
    if (api && api.view.type !== view) api.changeView(view);
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
            projectBacked: !!t.project_id,
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
        const writable = isWritableAccount(account);
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
          allDay: e.all_day,
          editable: writable && !e.all_day,
          durationEditable: writable && !e.all_day,
          classNames: [
            isGoogle || isIcloud ? "evt-google" : isIcs ? "evt-ics" : "evt-m365",
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
            recurringEventId:
              e.recurring_event_id ??
              (isGoogle && /_.{8}T\d{6}Z?$/.test(e.provider_event_id)
                ? e.provider_event_id
                : undefined),
            // iCloud occurrences carry a `uid::<recurrence-id>` provider id.
            recurring: Boolean(
              e.recurring_event_id ||
                (isGoogle && /_.{8}T\d{6}Z?$/.test(e.provider_event_id)) ||
                (isIcloud && e.provider_event_id.includes("::")),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, events, slots, slotTasks, hidden, hiddenKeys, showHidden, accountById, now, taskAccent, slotTitle]);

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
  const handleEventDidMount = (arg: EventMountArg) => {
    const { kind, refId } = arg.event.extendedProps as ExtendedProps;
    if (kind === "task") {
      arg.el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const task = findTask(refId);
        if (task) setTaskMenu({ x: e.clientX, y: e.clientY, task, el: arg.el });
      });
      return;
    }
    if (kind === "slot") {
      arg.el.setAttribute("data-slot-id", refId);
      arg.el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const slot = findSlot(refId);
        if (slot) setSlotMenu({ x: e.clientX, y: e.clientY, slot, el: arg.el });
      });
      return;
    }
    arg.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const evt = findEvent(refId);
      if (evt) setEventMenu({ x: e.clientX, y: e.clientY, event: evt });
    });
  };

  // Dismiss the menu on any outside interaction or Escape (a press inside the
  // menu is a selection, not a dismissal).
  const eventMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setEventDeleteConfirm(null);
    setEventMoveMode(false);
    setEventMoveConfirm(null);
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

  const taskMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setTaskDeleteMode(false);
  }, [taskMenu]);
  useEffect(() => {
    if (!taskMenu) return;
    const onDown = (e: PointerEvent) => {
      if (taskMenuRef.current?.contains(e.target as Node)) return;
      setTaskMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTaskMenu(null);
    const onBlur = () => setTaskMenu(null);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [taskMenu]);

  const slotMenuRef = useRef<HTMLDivElement | null>(null);
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
    // A multi-selection drags as a group (data-task-drag-group); a single row is
    // just its own id. Resolve to the list of tasks being dropped.
    const group = el.getAttribute("data-task-drag-group");
    const ids = group ? group.split(",") : [el.getAttribute("data-task-drag") ?? ""];
    // Fall back to the resolver for rows outside the render set — project
    // backlog work dragged out of the week crown lives in none of the six task
    // queries this pane is given.
    const tasks = ids
      .map((id) => findTask(id) ?? resolveDropTask?.(id))
      .filter((t): t is Task => Boolean(t));
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
    // Dropped onto a slot → join it. Prefer the visually-highlighted slot (the
    // one the pointer was over at drop time, stored in overSlotIdRef) over time-range
    // math, which breaks when FC snaps the ghost adjacent to avoid overlap.
    const hoveredSlotId = overSlotIdRef.current;
    overSlotIdRef.current = null; // consume it — onUp intentionally left it for us
    const hoveredSlot = hoveredSlotId
      ? slotsRef.current.find((s) => s.id === hoveredSlotId)
      : null;

    const t0 = start.getTime();
    const timeSlot = slotsRef.current.find((s) => {
      const ss = new Date(s.start_time).getTime();
      return t0 >= ss && t0 < ss + s.duration_minutes * 60_000;
    });
    const slot = hoveredSlot ?? timeSlot;
    if (slot) {
      // If every dropped task is already in this slot, they're being dragged to
      // reschedule (from the Today rail), not re-slotted. Block them at the drop time.
      if (tasks.every((t) => t.slot_id === slot.id)) {
        let cursor = new Date(start);
        tasks.forEach((t) => {
          mutations.block(t, cursor);
          cursor = new Date(cursor.getTime() + (t.duration_minutes ?? DEFAULT_DURATION_MINUTES) * 60_000);
        });
      } else {
        tasks.forEach((t) => mutations.assignToSlot(t, slot));
      }
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
        if (info.event.allDay) {
          mutations.planFor(task, toDateISO(info.event.start));
        } else {
          // Check if the task was dropped onto a slot (visually highlighted or by time overlap).
          const hoveredSlotId = overSlotIdRef.current;
          overSlotIdRef.current = null;
          const hoveredSlot = hoveredSlotId
            ? slotsRef.current.find((s) => s.id === hoveredSlotId)
            : null;
          const t0 = info.event.start.getTime();
          const timeSlot = slotsRef.current.find((s) => {
            const ss = new Date(s.start_time).getTime();
            return t0 >= ss && t0 < ss + s.duration_minutes * 60_000;
          });
          const slot = hoveredSlot ?? timeSlot;
          if (slot) {
            info.revert(); // undo FC's move — the task joins the slot, not a time block
            mutations.assignToSlot(task, slot);
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
      // Capture new times before any revert call.
      const newStart = info.event.start;
      const newEnd = info.event.end;
      if (!newStart || !newEnd) { info.revert(); return; }

      withRecurrenceScope(extProps, () => info.revert(), (scope) => {
        const ev = eventsRef.current.find((e) => e.id === refId);
        const before = ev ? { start_at: ev.start_at, end_at: ev.end_at } : null;
        eventMutations.updateEvent({
          id: refId,
          patch: { start_at: newStart.toISOString(), end_at: newEnd.toISOString() },
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
  };

  const onResize = (info: EventResizeDoneArg) => {
    const extProps = info.event.extendedProps as ExtendedProps;
    const { kind, refId } = extProps;

    if (kind === "task") {
      const task = findTask(refId);
      if (task && info.event.start && info.event.end) {
        const mins = Math.round((info.event.end.getTime() - info.event.start.getTime()) / 60_000);
        mutations.patchTask(
          task.id,
          {
            duration_minutes: Math.max(15, mins),
            ...(task.recurrence_id && !task.recurrence_overridden ? { recurrence_overridden: true } : {}),
          },
          {
            undo: "silent",
            before: {
              duration_minutes: task.duration_minutes,
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
      const newStart = info.event.start;
      const newEnd = info.event.end;
      if (!newStart || !newEnd) { info.revert(); return; }

      withRecurrenceScope(extProps, () => info.revert(), (scope) => {
        const ev = eventsRef.current.find((e) => e.id === refId);
        const before = ev ? { start_at: ev.start_at, end_at: ev.end_at } : null;
        eventMutations.updateEvent({
          id: refId,
          patch: { start_at: newStart.toISOString(), end_at: newEnd.toISOString() },
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
    // This same click may have just dismissed an open event/task/slot popover
    // (a separate system reacting to the same physical click) — that click
    // was a dismiss, not a request to also start a new draft.
    if (consumeCalendarClickHandled()) return;
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
    if (kind === "event" && !canCreateEvents) kind = "task";
    setDraft({
      start: arg.start,
      end: arg.end,
      kind,
      point: { x: je?.clientX ?? 0, y: je?.clientY ?? 0 },
    });
  };

  const onDateClick = (arg: DateClickArg) => {
    // This same click may have just dismissed an open event/task/slot popover
    // (a separate system reacting to the same physical click) — that click
    // was a dismiss, not a request to also start a new draft.
    if (consumeCalendarClickHandled()) return;
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
    if (kind === "event" && !canCreateEvents) kind = "task";
    setDraft({ start, end, kind, point: { x: je.clientX, y: je.clientY } });
  };

  const domainColor = (id: string | null) => (id ? domains.find((d) => d.id === id)?.color ?? null : null);

  const handleCreate = async ({
    kind,
    title,
    recurrence,
    attendees,
    calendarAccountId,
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
          await mutations.create({
            title,
            do_date: doDate,
            ...(draftAllDay ? {} : { start_time: start.toISOString(), duration_minutes: duration }),
          });
        }
      } else if (kind === "event") {
        const range = eventAllDay
          ? allDayRangeFromStart(start)
          : { start_at: start.toISOString(), end_at: end.toISOString() };
        await eventMutations.createEvent({
          title,
          ...range,
          all_day: eventAllDay,
          ...(recurrence ? { recurrence: toGoogleRRULE(recurrence) } : {}),
          ...(attendees.length ? { attendees, notifyGuests } : {}),
          ...(calendarAccountId ? { accountId: calendarAccountId } : {}),
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
    // a project-backed task reads as a "project slot" — a thicker, doubled edge
    const isProject = kind === "task" && (arg.event.extendedProps as ExtendedProps).projectBacked === true;

    const Bar = (
      <span
        className="shrink-0 self-stretch rounded-l-[5px]"
        style={{
          width: isProject ? 4 : 3,
          background: bar,
          opacity: kind === "m365" ? 0.5 : 1,
          boxShadow: isProject ? `inset 2px 0 0 color-mix(in srgb, ${bar} 45%, transparent)` : undefined,
        }}
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
              done ? "border-accent bg-accent text-on-accent" : "bg-surface"
            }`}
            style={done ? undefined : { borderColor: bar }}
            onMouseDown={(e) => {
              // Don't let a press on the checkbox begin an event drag.
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
          >
            {done && (
              <Icon name="check" size={8} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <span className={`${titleCls} ${done ? "line-through opacity-55" : ""}`}>
                {isProject ? `▸ ${arg.event.title}` : arg.event.title}
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
  };

  return (
    // Transparent so the single .atmosphere canvas (laid down by AppShellInner)
    // reads continuously across the spine, the rail, and the calendar grid —
    // the grid IS the paper. A solid surface here is the "frost" seam that made
    // the calendar read lighter than the rail.
    // `cal-sheet` is the FLAT skin's hook: that material has no gradient to run
    // across the window, so it separates ground from work instead — grey chrome
    // and pools, a white sheet under the grid. Inert on every other material.
    <div className="cal-sheet relative flex h-full min-w-0 flex-1 flex-col">
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
        const writable = isWritableAccount(account) && !isReadOnlyCalendarId(ev.calendar_id);
        const moveGroups = writable ? writableCalendarTargets(accounts, ev.calendar_id) : [];
        const moveCount = moveGroups.reduce((n, g) => n + g.calendars.length, 0);
        const requestDelete = (scope: RecurrenceScope) => {
          if (eventMenuHasInvitees) setEventDeleteConfirm(scope);
          else deleteEventNow(ev, scope);
        };
        const left = fixedCssPx(Math.min(eventMenu.x, window.innerWidth - 210));
        const menuReserve = eventDeleteConfirm
          ? (eventMenuCancelNotifies && !series ? 190 : 130)
          : eventMoveMode
            ? 240
            : writable
              ? (onConvertEventToTask && !ev.all_day ? 250 : 210)
              : 160;
        const top = fixedCssPx(Math.min(eventMenu.y, window.innerHeight - menuReserve));
        return (
          <div
            ref={eventMenuRef}
            className="pop-in fixed z-[60] min-w-[190px] overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1"
            style={{ top, left, boxShadow: "var(--shadow-3)" }}
          >
            <div className="truncate border-b border-line px-3 py-1.5 text-meta text-muted">
              {ev.title || "Event"}
            </div>
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
                        : `Delete ${eventDeleteConfirm === "ALL" ? "all events in this series" : "this event"}?`}
                    </p>
                    <p className="mt-0.5 text-meta text-muted">This can't be undone.</p>
                    <div className={`mt-2.5 flex gap-1.5 ${eventMenuCancelNotifies && !series ? "flex-col" : "items-center"}`}>
                      {eventMenuCancelNotifies && !series ? (
                        <>
                          <button
                            onClick={() => deleteEventNow(ev, eventDeleteConfirm)}
                            className="fast rounded-[var(--radius-sm)] px-2 py-1.5 text-center text-caption font-medium text-white"
                            style={{ background: "var(--signal)" }}
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
                            className="fast flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-center text-caption font-medium text-white"
                            style={{ background: "var(--signal)" }}
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
                    <EventMenuItem onClick={() => requestDelete("THIS")}>
                      <span style={{ color: "var(--signal)" }}>Delete this event</span>
                    </EventMenuItem>
                    <EventMenuItem onClick={() => requestDelete("ALL")}>
                      <span style={{ color: "var(--signal)" }}>Delete all events in series</span>
                    </EventMenuItem>
                  </>
                ) : (
                  <EventMenuItem onClick={() => requestDelete("THIS")}>
                    <span style={{ color: "var(--signal)" }}>Delete event</span>
                  </EventMenuItem>
                )}
              </>
            )}
          </div>
        );
      })()}

      {taskMenu && (() => {
        const task = taskMenu.task;
        const recurrence = task.recurrence_id ? recurrenceById.get(task.recurrence_id) ?? null : null;
        const recurring = Boolean(task.recurrence_id && recurrence);
        const left = fixedCssPx(Math.min(taskMenu.x, window.innerWidth - 210));
        const top = fixedCssPx(Math.min(taskMenu.y, window.innerHeight - (taskDeleteMode ? 260 : 200)));
        const trashThis = () => {
          if (recurrence && task.recurrence_date) recurrenceMutations.skipOccurrence(recurrence, task.recurrence_date);
          mutations.trash(task);
          setTaskMenu(null);
        };
        const trashFollowing = () => {
          if (recurrence && task.do_date) recurrenceMutations.deleteFollowing(recurrence, task.do_date);
          setTaskMenu(null);
        };
        const trashSeries = () => {
          if (recurrence) recurrenceMutations.deleteSeries(recurrence);
          setTaskMenu(null);
        };
        return (
          <div
            ref={taskMenuRef}
            className="pop-in fixed z-[60] min-w-[190px] overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1"
            style={{ top, left, boxShadow: "var(--shadow-3)" }}
          >
            <div className="truncate border-b border-line px-3 py-1.5 text-meta text-muted">
              {task.title}
            </div>
            {taskDeleteMode && recurring ? (
              <>
                <div className="mono px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-widest text-muted">
                  Delete
                </div>
                <EventMenuItem onClick={trashThis}>This occurrence</EventMenuItem>
                <EventMenuItem onClick={trashFollowing}>This & following</EventMenuItem>
                <EventMenuItem onClick={trashSeries}>Whole series</EventMenuItem>
                <div className="my-1 border-t border-line" />
                <EventMenuItem onClick={() => setTaskDeleteMode(false)}>Cancel</EventMenuItem>
              </>
            ) : (
              <>
                <EventMenuItem onClick={() => {
                  const rect = taskMenu.el.getBoundingClientRect();
                  setTaskMenu(null);
                  onOpenTask(task, rect);
                }}>
                  Open
                </EventMenuItem>
                <EventMenuItem onClick={() => {
                  setTaskMenu(null);
                  task.status === "done" ? mutations.uncomplete(task) : mutations.complete(task);
                }}>
                  {task.status === "done" ? "Reopen" : "Mark done"}
                </EventMenuItem>
                <EventMenuItem onClick={() => {
                  setTaskMenu(null);
                  mutations.create({
                    title: task.title,
                    notes: task.notes || undefined,
                    do_date: task.do_date,
                    start_time: task.start_time,
                    duration_minutes: task.duration_minutes,
                    priority: task.priority !== "none" ? task.priority : undefined,
                    domain_id: task.domain_id,
                    project_id: task.project_id,
                    labelIds: task.task_labels?.map((l) => l.label_id),
                  });
                }}>
                  Duplicate
                </EventMenuItem>
                {onConvertTaskToEvent && task.start_time && (
                  <>
                    <div className="my-1 border-t border-line" />
                    <EventMenuItem onClick={() => {
                      setTaskMenu(null);
                      onConvertTaskToEvent(task);
                    }}>
                      → Event
                    </EventMenuItem>
                  </>
                )}
                <div className="my-1 border-t border-line" />
                {recurring ? (
                  <EventMenuItem onClick={() => setTaskDeleteMode(true)}>
                    <span style={{ color: "var(--signal)" }}>Trash…</span>
                  </EventMenuItem>
                ) : (
                  <EventMenuItem onClick={() => {
                    setTaskMenu(null);
                    mutations.trash(task);
                  }}>
                    <span style={{ color: "var(--signal)" }}>Trash</span>
                  </EventMenuItem>
                )}
              </>
            )}
          </div>
        );
      })()}

      {slotMenu && (() => {
        const slot = slotMenu.slot;
        const childCount = slotTasks[slot.id]?.length ?? 0;
        const recurring = Boolean(slot.recurrence_id);
        const left = fixedCssPx(Math.min(slotMenu.x, window.innerWidth - 210));
        const top = fixedCssPx(Math.min(slotMenu.y, window.innerHeight - 160));
        return (
          <div
            ref={slotMenuRef}
            className="pop-in fixed z-[60] min-w-[190px] overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1"
            style={{ top, left, boxShadow: "var(--shadow-3)" }}
          >
            <div className="truncate border-b border-line px-3 py-1.5 text-meta text-muted">
              {slotTitle(slot)}
            </div>
            <EventMenuItem onClick={() => {
              const rect = slotMenu.el.getBoundingClientRect();
              setSlotMenu(null);
              onOpenSlot(slot, rect);
            }}>
              Open
            </EventMenuItem>
            <EventMenuItem onClick={() => {
              setSlotMenu(null);
              slotMutations.createSlot({
                title: slot.title,
                do_date: slot.do_date,
                start_time: slot.start_time,
                duration_minutes: slot.duration_minutes,
                project_id: slot.project_id,
                domain_id: slot.domain_id,
                color: slot.color,
              });
            }}>
              Duplicate
            </EventMenuItem>
            <div className="my-1 border-t border-line" />
            <EventMenuItem onClick={() => {
              const rect = slotMenu.el.getBoundingClientRect();
              setSlotMenu(null);
              // A plain, empty, non-recurring slot deletes outright. Anything with
              // occurrence scope or tasks inside needs the full picker in the slot
              // detail panel (SlotDeleteButton) — don't reimplement that choice here.
              if (!recurring && childCount === 0) slotMutations.removeSlot(slot);
              else onOpenSlot(slot, rect);
            }}>
              <span style={{ color: "var(--signal)" }}>
                {!recurring && childCount === 0 ? "Delete slot" : "Delete slot…"}
              </span>
            </EventMenuItem>
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
          writableAccounts={writableAccounts}
          domains={domains}
          meetPreference={settings?.auto_add_meet}
          onCreate={handleCreate}
          onCancel={() => {
            setDraft(null);
            calRef.current?.getApi().unselect();
          }}
        />
      )}

      {/* ── Navigation bar — two clusters (nav · altitude/door) with a flexible
            drag-region gap between. Also fills the macOS titlebar zone (titlebar-pad). */}
      <div
        data-tauri-drag-region="deep"
        className="titlebar-pad grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5"
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
                onClick={() => calRef.current?.getApi().prev()}
                className="fast flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
                title="Previous (Alt+←)"
              >
                <Icon name="chevron-left" size={14} />
              </button>
              <button
                onClick={() => calRef.current?.getApi().next()}
                className="fast flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
                title="Next (Alt+→)"
              >
                <Icon name="chevron-right" size={14} />
              </button>
              <button
                onClick={() => calRef.current?.getApi().today()}
                className="fast shrink-0 rounded border border-line px-2 py-0.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
                title="Go to today (Alt+T)"
              >
                Today
              </button>
            </>
          )}
          <div data-tauri-drag-region className="min-w-2 flex-1 self-stretch" />
        </div>

        {/* Center — flexible drag region between the two control clusters. */}
        <div className="w-0" data-tauri-drag-region />

        {/* Right — quiet clock · week door · altitude · overflow. No overflow-hidden
            here — the ··· menu drops below and must be allowed to paint. */}
        <div className="flex min-w-0 items-center justify-end gap-1">
          <div data-tauri-drag-region className="min-w-2 flex-1 self-stretch" />
          <TimeZoneChip now={now} />

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
              {(["board", "timeGridDay", "timeGridWeek", "dayGridMonth"] as const).map((v) => {
                const on = view === v;
                return (
                  <button
                    key={v}
                    data-on={on}
                    onClick={() => onViewChange(v)}
                    className="fast rounded-full px-1.5 py-0.5 text-label leading-none"
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

      {/* ── FullCalendar ────────────────────────────────────────────────── */}
      {view !== "board" && (
      <div
        ref={wrapRef}
        className="nuvo-cal-host min-h-0 flex-1 p-2"
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
        <FullCalendar
          ref={calRef}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView={view}
          headerToolbar={false}
          allDaySlot={!isMonth}
          allDayText="anytime"
          dayMaxEventRows={5}
          firstDay={firstDayOfWeek(settings)}
          nowIndicator={!isMonth}
          fixedMirrorParent={typeof document !== "undefined" ? document.body : undefined}
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
            // Month view hands header dates in as UTC-midnight markers — reading
            // them with local getters shifts the label back a day for anyone
            // west of UTC. Week/Day headers are already local, so only Month
            // needs the UTC read.
            const weekday = isMonth
              ? arg.date.toLocaleDateString([], { weekday: "short", timeZone: "UTC" }).toUpperCase()
              : arg.date.toLocaleDateString([], { weekday: "short" }).toUpperCase();
            const dateNum = isMonth ? arg.date.getUTCDate() : arg.date.getDate();
            // en-CA locale reliably produces YYYY-MM-DD in local time
            const dateStr = arg.date.toLocaleDateString("en-CA");
            const wx = showWeather && !isMonth ? weatherIndex.get(dateStr) : undefined;
            // Week/Day: today is a signal disc (the "now" colour — theme-aware).
            // Month headers stay plain; the day *cell* carries the landmark.
            const todayChip = isToday && !isMonth;
            return (
              <div className="flex flex-col items-center gap-0.5 py-1">
                <span
                  className={`text-micro font-semibold tracking-widest ${
                    todayChip ? "text-signal" : "text-muted"
                  }`}
                >
                  {weekday}
                </span>
                <span
                  className="masthead tabular-nums leading-none"
                  style={
                    todayChip
                      ? {
                          fontSize: "18px",
                          color: "#fff",
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
          }}
          dayCellContent={(arg: DayCellContentArg) => {
            // Only month cells need custom numerals — Week/Day put the date in
            // the header, and injecting numbers into the anytime row is noise.
            if (arg.view.type !== "dayGridMonth") return true;
            return (
              <span
                className="masthead tabular-nums leading-none"
                style={
                  arg.isToday
                    ? {
                        fontSize: "13px",
                        color: "#fff",
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
          eventDidMount={handleEventDidMount}
          datesSet={handleDatesSet}
        />
      </div>
      )}

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

function minutesToDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** One row in the right-click event menu. */
function EventMenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fast block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-2"
    >
      {children}
    </button>
  );
}
