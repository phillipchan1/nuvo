import { format } from "date-fns";
import { Icon } from "./Icon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import type { DatesSetArg, DateSelectArg, DayCellContentArg, EventApi, EventClickArg, EventContentArg, EventDropArg, EventMountArg } from "@fullcalendar/core";
import type { DateClickArg, EventReceiveArg, EventResizeDoneArg, EventDragStopArg } from "@fullcalendar/interaction";
import { restingStatus, type CalendarAccount, type ExternalEvent, type RecurrenceScope, type Slot, type Task, type UserSettings } from "../lib/types";
import { DEFAULT_DURATION_MINUTES } from "../lib/types";
import { firstDayOfWeek } from "../hooks/useSettings";
import { allDayRangeFromStart, endOf, isOverdue, parseDateISO, toDateISO } from "../lib/dates";
import { addDays, startOfDay } from "date-fns";
import { expandRule, toGoogleRRULE } from "../lib/recurrence";
import type { useTaskMutations } from "../hooks/useTasks";
import { useEventDetails, useHiddenEvents, usePrefetchEventDetails, type useExternalEventMutations } from "../hooks/useCalendar";
import { eventSeriesKey, isExternalEventRecurring, resolveRecurringEventId } from "../lib/now";
import { clearCalendarReveal, onCalendarReveal, pendingCalendarReveal } from "../lib/calendarReveal";
import { synClass } from "../lib/syntax";
import { isReadOnlyCalendarId, isWritableAccount, providerLabel, writableCalendarTargets } from "../lib/calendarWrite";
import type { useSlotMutations } from "../hooks/useSlots";
import { HORIZON_DAYS, useRecurrences, type useRecurrenceMutations } from "../hooks/useRecurrence";
import DraftComposer, { type CreateDraft, type CreateKind } from "./DraftComposer";
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
import { toast } from "sonner";
// One rule for "how big is this block", shared with the chat's `create_slot`.
import { sizeSlotToContents } from "../../supabase/functions/_shared/slotSizing.ts";
// One spelling for what a block IS — shared with Plan the week's grid.
import {
  adjacentPreviewRect,
  blockDesignation,
  resolveSlotDrop,
  slotDropZoneFromPointer,
  type SlotDropIntent,
  type SlotDropZone,
} from "../lib/slots";

export type CalView = "timeGridWeek" | "timeGridDay" | "dayGridMonth" | "board" | "year";

/** Views that aren't FullCalendar at all — they own their own canvas, so every
 *  `calRef.getApi()` path (paging, today, resize, drag wiring) has to stand
 *  down for them. Named once so a third one can't half-join the family. */
const NON_FC_VIEWS: CalView[] = ["board", "year"];
const isFcView = (v: CalView) => !NON_FC_VIEWS.includes(v);

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

// The Schedule unmounts while a floor is open — keeping a live FullCalendar
// under every surface taxed every interaction in the app — so the anchor date
// and the time-grid scroll offset survive at module scope, and the remount
// reopens where the user left rather than at today, scrolled to now. One
// CalendarPane per shell, so a single slot is enough.
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
  taskDomain,
  slotTitle,
  slotProject,
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
  /** The project a slot is reserved for, and the hue it inherits — so a project
   *  sitting can name its kind on the grid instead of wearing a bare `▸`. */
  slotProject?: (s: Slot) => { name: string; color: string | null } | null;
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

  // Month view has no other orientation cue (Week/Day are covered by the
  // "THIS WEEK" rail label) — without a title, paging ‹ › leaves no way to
  // tell which month you're looking at.
  const [monthTitle, setMonthTitle] = useState("");

  // Hidden events (Fantastical-style): kept off the board + out of the busy math.
  // `showHidden` reveals them dimmed so you can bring one back. The context menu /
  // popover toggle the per-event hidden state.
  const { keys: hiddenKeys, isHidden, hiddenKeyFor, hide, unhide } = useHiddenEvents();
  const prefetchEventDetails = usePrefetchEventDetails();
  const [showHidden, setShowHidden] = useState(false);
  const [eventMenu, setEventMenu] = useState<{ x: number; y: number; event: ExternalEvent } | null>(null);
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
      // The block's own popover counts as still being "on" it. Dropping focus
      // here un-expanded and un-lifted the block mid-inspection, and since the
      // popover is anchored to that block, its ~3px lift and full-column width
      // vanishing shifted the popover under the cursor.
      if (t?.closest("[data-block-popover]")) return;
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
      let current = anchor;
      let lastKey = "";
      const onMove = (ev: MouseEvent) => {
        const date = cellAt(ev.clientX, ev.clientY);
        if (date) current = date;
        const startISO = anchor <= current ? anchor : current;
        // A drag with no writable calendar can only land as a single-day task
        // (selectAllow enforces the same cap on the real selection) — keep the
        // live ghost from promising a multi-day span it can't deliver.
        const endISO = !canCreateEvents ? startISO : anchor <= current ? current : anchor;
        const key = `${startISO}:${endISO}`;
        if (key === lastKey) return;
        lastKey = key;
        setAllDayDragRange({ start: parseDateISO(startISO), end: parseDateISO(endISO) });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setAllDayDragRange(null);
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
  const pxPerHour =
    availH > 160 ? Math.max(26, Math.min(190, (availH - 16 - 52) / fitClamped)) : 52;
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
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;

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
            backgroundColor: "color-mix(in srgb, var(--slot) 32%, var(--surface))",
            borderColor: "color-mix(in srgb, var(--slot) 68%, var(--line))",
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
        };
      },
    });
    return () => draggable.destroy();
  }, [railRef, view]);

  // Live drop-target feedback while a task is being dragged. Classes are toggled
  // imperatively (no React state) so a drag never re-renders CalendarPane
  // mid-gesture (which could disturb FullCalendar's own drag/drop):
  //   body.cal-dragging           → drag is live (cells can arm as targets)
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

    const reset = () => {
      document.body.classList.remove("cal-dragging", "over-slot", "slot-adjacent-drop", "over-anytime");
      overSlot?.classList.remove("slot-drop-target", "slot-adjacent-anchor");
      overSlot = null;
      overZone = null;
      clearAnytimeTarget();
      chip.classList.remove("is-visible", "drop-chip-act");
      hideAdjacentPreview();
      railRef.current?.classList.remove("rail-drop-active", "rail-return-armed");
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      committedSlotDropIntentRef.current = null;
      armed = Boolean(el?.closest?.("[data-task-drag], [data-project-drag], .evt-task"));
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
      dropPointRef.current = { x: e.clientX, y: e.clientY };
      // Hit-test slots by geometry, not elementFromPoint: FullCalendar stacks the
      // .fc-highlight selection box and the drag mirror *above* the slot event, so
      // elementFromPoint+closest never sees the slot and the drop lands beside it.
      // The slot block's left/right edges are "place beside"; the middle joins it.
      let slotEl: HTMLElement | null = null;
      let zone: SlotDropZone | null = null;
      // `[data-slot-id]` — a REAL slot, not the drag preview. Dragging a project
      // renders a mirror that wears `.evt-slot` (it's a picture of the sitting
      // you're about to make), and without this the preview hit-tests itself:
      // the ghost fades to 10% and a chip offers to drop the project into the
      // block it hasn't created yet.
      for (const el of document.querySelectorAll<HTMLElement>(".fc-event.evt-slot[data-slot-id]")) {
        const r = el.getBoundingClientRect();
        const hit = slotDropZoneFromPointer(r, e.clientX, e.clientY);
        if (!hit) continue;
        slotEl = el;
        zone = hit;
        break;
      }
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
      // Anytime row (week/day all-day band, or a month cell): hit-test the day
      // cells themselves. :hover on `.fc-daygrid-day` painted a wash the frame
      // covered, so the pointer could be over a real drop and still look idle.
      let anytimeEl: HTMLElement | null = null;
      if (!slotEl) {
        for (const el of document.querySelectorAll<HTMLElement>(".fc-daygrid-body .fc-daygrid-day")) {
          const r = el.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            anytimeEl = el;
            break;
          }
        }
      }
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
        chip.style.left = `${fixedCssPx(e.clientX + 14)}px`;
        chip.style.top = `${fixedCssPx(e.clientY + 16)}px`;
        chip.classList.add("is-visible");
      } else if (anytimeEl) {
        hideAdjacentPreview();
        // Pill preview in the cell — FC's all-day mirror is a blank scrap; this
        // is the chip you're about to get, with the title, before you commit.
        // Compact chip on the left of the cell — a full-bleed bar read as a
        // zone wash, not as the anytime pill you're about to get.
        const frame =
          anytimeEl.querySelector<HTMLElement>(".fc-daygrid-day-events") ??
          anytimeEl.querySelector<HTMLElement>(".fc-daygrid-day-frame") ??
          anytimeEl;
        const r = frame.getBoundingClientRect();
        const padX = 6;
        const padY = 3;
        const label = dragLabel();
        anytimePreview.style.left = `${fixedCssPx(r.left + padX)}px`;
        anytimePreview.style.top = `${fixedCssPx(r.top + padY)}px`;
        anytimePreview.style.width = "auto";
        anytimePreview.style.maxWidth = `${fixedCssPx(Math.max(120, r.width - padX * 2))}px`;
        anytimePreviewTitle.textContent = label;
        anytimePreview.classList.add("is-visible");
        const dateStr = anytimeEl.getAttribute("data-date");
        const dayBit = dateStr
          ? ` · ${format(parseDateISO(dateStr), "EEE")}`
          : "";
        chip.textContent = `↳ Plan anytime${dayBit}`;
        chip.classList.add("drop-chip-act");
        chip.style.left = `${fixedCssPx(e.clientX + 14)}px`;
        chip.style.top = `${fixedCssPx(e.clientY + 16)}px`;
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
          e.clientX >= rr.left && e.clientX <= rr.right && e.clientY >= rr.top && e.clientY <= rr.bottom;
        overRail = onRail && !slotEl && !anytimeEl;
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
        // Freeze intent before FullCalendar's async drop handlers run.
        committedSlotDropIntentRef.current = slotDropIntentRef.current;
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
      dragTitle = null;
      fromRail = false;
      calTask = false;
      overRail = false;
      committedSlotDropIntentRef.current = null;
      slotDropIntentRef.current = null;
      dragGroupRef.current = null;
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
      preview.remove();
      anytimePreview.remove();
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
        // A clearly teal container — stronger than a task/event tint (14%) so a
        // slot is unmistakable. Border comes from .evt-slot (dashed teal) in CSS.
        backgroundColor: "color-mix(in srgb, var(--slot) 32%, var(--surface))",
        borderColor: "color-mix(in srgb, var(--slot) 68%, var(--line))",
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
  }, [tasks, events, slots, slotTasks, hidden, hiddenKeys, showHidden, accountById, now, taskAccent, slotTitle, slotProject]);

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
  const draftPreviewEvent = previewRange
    ? {
        id: "draft:preview",
        title: "",
        start: previewRange.start.toISOString(),
        end: (previewRange.allDay ? addDays(previewRange.end, 1) : previewRange.end).toISOString(),
        allDay: previewRange.allDay,
        editable: false,
        classNames: ["evt-task", "evt-draft-preview"],
        ...blockColors("var(--accent)"),
        extendedProps: { kind: "task" as const, refId: "", barColor: "var(--accent)", recurring: false },
      }
    : null;

  const findTask = (id: string) => tasksRef.current.find((t) => t.id === id);
  const findEvent = (id: string) => eventsRef.current.find((e) => e.id === id);
  const findSlot = (id: string) => slotsRef.current.find((s) => s.id === id);

  /** Instant check, then the write. The paint is the click; the mutation is
   *  scheduled as a macrotask so React/FullCalendar cannot take this frame. */
  const toggleCalendarTaskDone = (task: Task, el?: HTMLElement | null) => {
    const goingDone = task.status !== "done";
    if (el) paintCalendarTaskDone(el, goingDone);
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
      // Only a REAL slot gets the handle. The drag preview for a project mounts
      // through here too (it is drawn as the sitting it will become) with no id
      // of its own — stamping an empty one made the drop hit-test find the
      // ghost, which then offered to drop the project into itself.
      if (refId) arg.el.setAttribute("data-slot-id", refId);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTaskMenu(null);
        return;
      }
      // Same act as the rail: Delete/Backspace trash. The menu used to ignore
      // them, so right-click → Delete on a calendar block was a silent no-op.
      if (e.key === "Backspace" || e.key === "Delete") {
        if (isTypingIn(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        mutations.trash(taskMenu.task);
        setTaskMenu(null);
      }
    };
    const onBlur = () => setTaskMenu(null);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [taskMenu, mutations]);

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
    const resolved = resolveSlotDrop(start, intent, slotsRef.current, defaultDurationMins);

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

  const onReceive = (info: EventReceiveArg) => {
    const el = info.draggedEl;
    const start = info.event.start;
    const allDay = info.event.allDay;

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
    const resolved = resolveSlotDrop(start, intent, slotsRef.current, defaultDurationMins);

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
          const intent = takeSlotDropIntent();
          const resolved = resolveSlotDrop(
            info.event.start,
            intent,
            slotsRef.current,
            defaultDurationMins,
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
  const onSelect = (arg: DateSelectArg) => {
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
    }
    // React's draft preview is the ghost now. Drop FC's own mirror so it
    // can't outlive the composer if the leftover mouseup click dismisses it.
    queueMicrotask(() => calRef.current?.getApi().unselect());
  };

  const onDateClick = (arg: DateClickArg) => {
    // This same click may have just dismissed an open event/task/slot popover
    // (a separate system reacting to the same physical click) — that click
    // was a dismiss, not a request to also start a new draft.
    if (consumeCalendarClickHandled()) return;
    clearFocus(); // clicking empty space drops the focused block
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
          ? allDayRangeFromStart(start, end)
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
        if (task) toggleCalendarTaskDone(task, info.el);
        return;
      }
    }
    // A click brings the block to the front of any overlap (full width, on top)
    // and opens its detail — the lift lands this frame, the detail opens with it.
    focusBlock(info.el);
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
  };

  // Hovering a block warms its detail payload, so the popover opens complete
  // rather than filling in a beat later (see usePrefetchEventDetails). Only a
  // *resting* pointer counts: a sweep across a dense week would otherwise fire
  // one row read per block it crossed.
  const hoverWarmRef = useRef<number | null>(null);
  const onEventHover = (info: { event: { extendedProps: unknown } }) => {
    const { kind, refId } = info.event.extendedProps as ExtendedProps;
    if (kind === "task" || kind === "slot") return;
    if (hoverWarmRef.current) window.clearTimeout(hoverWarmRef.current);
    hoverWarmRef.current = window.setTimeout(() => prefetchEventDetails(findEvent(refId)), 120);
  };
  const onEventUnhover = () => {
    if (hoverWarmRef.current) window.clearTimeout(hoverWarmRef.current);
    hoverWarmRef.current = null;
  };
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
            className="relative flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border"
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
    const TimeLine = !compact ? (
      <div className="mono mt-px truncate text-micro leading-none text-muted">{arg.timeText}</div>
    ) : null;
    const Recur = recurring ? <RecurMark className="shrink-0 opacity-45" /> : null;
    const titleCls = "truncate text-label font-semibold leading-[1.2]";

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
              <span className={titleCls}>
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
            className="relative mt-[1px] flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border"
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
              <span data-evt-title="" className={titleCls}>
                {isProject ? `▸ ${arg.event.title}` : arg.event.title}
              </span>
              {Recur}
            </div>
            {TimeLine}
          </div>
        </div>
      </div>
    );
  }, []);

  const isMonth = view === "dayGridMonth";

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

  const handleDatesSet = (arg: DatesSetArg) => {
    // currentStart, not start: the month grid's `start` is the previous month's
    // tail, and reopening on it would show the wrong month.
    remountCache.dateISO = arg.view.currentStart.toISOString();
    onRangeChange(arg.start.toISOString(), arg.end.toISOString());
    if (arg.view.type === "dayGridMonth") setMonthTitle(arg.view.title);
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
            {/* Duplicate — tasks and slots have had it all along; an external
                event was the one thing on this grid you had to retype. Guests
                and recurrence deliberately do NOT carry: a copy that silently
                re-invited eight people would be the app mailing on the user's
                behalf, and a copied series is two series. */}
            {writable && (
              <EventMenuItem onClick={() => {
                setEventMenu(null);
                void eventMutations.createEvent({
                  title: `${ev.title} (copy)`,
                  start_at: ev.start_at,
                  end_at: ev.end_at,
                  all_day: ev.all_day,
                  location: ev.location ?? undefined,
                  accountId: ev.account_id,
                  calendarId: ev.calendar_id,
                  notifyGuests: false,
                });
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
                        : `Delete ${eventDeleteConfirm === "ALL" ? "all events in this series" : "this event"}?`}
                    </p>
                    {/* The copy has to track what's true. A single occurrence
                        now records an undo (useCalendar's `del`), so saying
                        otherwise would be a lie that costs the user a decision.
                        A whole series still can't be put back from one row, and
                        a guest who has already been mailed stays mailed. */}
                    <p className="mt-0.5 text-meta text-muted">
                      {eventDeleteConfirm === "ALL"
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
                  const el = taskMenu.el;
                  const rect = el.getBoundingClientRect();
                  setTaskMenu(null);
                  onOpenTask(task, rect, el);
                }}>
                  Open
                </EventMenuItem>
                <EventMenuItem onClick={() => {
                  const el = taskMenu.el;
                  setTaskMenu(null);
                  toggleCalendarTaskDone(task, el);
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
              const el = slotMenu.el;
              const rect = el.getBoundingClientRect();
              setSlotMenu(null);
              onOpenSlot(slot, rect, el);
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
              const el = slotMenu.el;
              const rect = el.getBoundingClientRect();
              setSlotMenu(null);
              // A plain, empty, non-recurring slot deletes outright. Anything with
              // occurrence scope or tasks inside needs the full picker in the slot
              // detail panel (SlotDeleteButton) — don't reimplement that choice here.
              if (!recurring && childCount === 0) slotMutations.removeSlot(slot);
              else onOpenSlot(slot, rect, el);
            }}>
              <span style={{ color: "var(--signal)" }}>
                {!recurring && childCount === 0 ? "Delete slot" : "Delete slot…"}
              </span>
            </EventMenuItem>
          </div>
        );
      })()}

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
                title="Previous (Alt+←)"
              >
                <Icon name="chevron-left" size={14} />
              </button>
              <button
                onClick={() => pageBy(1)}
                className="fast flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-bg hover:text-ink"
                title="Next (Alt+→)"
              >
                <Icon name="chevron-right" size={14} />
              </button>
              <button
                onClick={pageToday}
                className="fast shrink-0 rounded border border-line px-2 py-0.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
                title="Go to today (Alt+T)"
              >
                Today
              </button>
            </>
          )}
          <div data-tauri-drag-region className="min-w-2 flex-1 self-stretch" />
        </div>

        {/* Center — Month's only orientation cue (Week/Day rely on the "THIS
              WEEK" rail label instead); otherwise a flexible drag region. */}
        {isMonth ? (
          <div
            data-tauri-drag-region
            className="pointer-events-none flex max-w-[220px] select-none justify-center truncate leading-none"
          >
            <span className="masthead truncate text-lead leading-none text-text">{monthTitle}</span>
          </div>
        ) : (
          <div className="w-0" data-tauri-drag-region />
        )}

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
              now={now}
              weekStartsOn={firstDayOfWeek(settings)}
              onPickDay={(d) => openYearDate(d, "timeGridDay")}
              onPickMonth={(d) => openYearDate(d, "dayGridMonth")}
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
        <FullCalendar
          ref={calRef}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          // Only read at mount. The pane can now mount while a non-FC view is
          // active (a reload straight into the Year), and "year" is not a
          // FullCalendar view name — it would throw. The changeView effect
          // above puts it right the moment an FC view is selected.
          initialView={isFcView(view) ? view : "timeGridWeek"}
          initialDate={remountCache.dateISO ?? undefined}
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
            // Month's column headers are *day-of-week* headers, not days: one
            // header spans five or six rows, so FullCalendar renders them from a
            // dummy week (Sun 04 Jan 1970 → Sat 10 Jan 1970). Reading a date off
            // that is how the row came to read "SUN 4 … SAT 10" over every month
            // and never move when you paged. Month therefore shows the weekday
            // alone — the day *cell* carries the real number — and takes it from
            // `dow` rather than the dummy marker, which a local-timezone read
            // lands a day behind anywhere west of UTC.
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
            // en-CA locale reliably produces YYYY-MM-DD in local time
            const dateStr = arg.date.toLocaleDateString("en-CA");
            const wx = showWeather ? weatherIndex.get(dateStr) : undefined;
            // Week/Day: today is a signal disc (the "now" colour — theme-aware).
            const todayChip = isToday;
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
          // Always keep the draft ghost out of the "+N more" overflow — a
          // packed month day would otherwise bury it behind real events.
          eventOrder={(a: unknown, b: unknown) =>
            (a as EventApi).id === "draft:preview" ? -1 : (b as EventApi).id === "draft:preview" ? 1 : 0
          }
          events={draftPreviewEvent ? [...fcEvents, draftPreviewEvent] : fcEvents}
          editable
          droppable
          selectable
          selectMirror
          unselectAuto={false}
          selectMinDistance={5}
          selectAllow={(arg) =>
            !arg.allDay || canCreateEvents || toDateISO(addDays(arg.end, -1)) === toDateISO(arg.start)
          }
          select={onSelect}
          dateClick={onDateClick}
          eventReceive={onReceive}
          eventDrop={onDrop}
          eventResize={onResize}
          eventDragStop={onDragStop}
          eventClick={onClick}
          eventMouseEnter={onEventHover}
          eventMouseLeave={onEventUnhover}
          eventContent={renderEvent}
            eventDidMount={handleEventDidMount}
            datesSet={handleDatesSet}
          />
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
