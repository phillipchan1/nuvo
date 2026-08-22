import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import type { Label, Task } from "../lib/types";
import { ENERGY_META } from "../lib/energy";
import { liveSuggestion } from "../lib/grooming";
import { fmtDuration, fmtLateness, fmtTime, isOverdue, todayISO, tomorrowISO } from "../lib/dates";
import { RecurMark } from "./ui";
import { pressable } from "../lib/a11y";

/** Row exit + checkbox bloom — keep in sync with `--d-task-complete` in index.css. */
const COMPLETE_MS = 180;

export interface TaskMeta {
  project?: string | null;
  initiative?: string | null;
  domain?: string | null;
  domainColor?: string | null;
}

/** Bottom status bar — domain hue on the strip, name states specificity. */
type RowIdentity = {
  barColor: string | null;
  placeName: string | null;
  placeHint: string | null;
  proposal: boolean;
  proposalColor: string | null;
  /** The task's already-committed home, shown struck through alongside a live
   *  suggestion so accepting isn't a leap of faith about what it's replacing —
   *  a domain tag is deliberately NOT a home, so a suggestion can disagree with
   *  one that's already set. Null when there's nothing to contrast against, or
   *  the suggestion agrees with the current place. */
  currentName: string | null;
};

/** The task's real, already-filed place — ignoring any live suggestion. */
function filedIdentity(
  meta: TaskMeta | undefined,
  taskLabels: Label[],
  accent: string | null | undefined,
): RowIdentity {
  const empty: RowIdentity = {
    barColor: null,
    placeName: null,
    placeHint: null,
    proposal: false,
    proposalColor: null,
    currentName: null,
  };
  const domainColor = meta?.domainColor ?? accent ?? null;
  const domainName = meta?.domain ?? null;

  const filedName = meta?.project ?? meta?.initiative ?? null;
  if (filedName) {
    return {
      ...empty,
      barColor: domainColor,
      placeName: filedName,
      placeHint: domainName ? `${filedName} · ${domainName}` : filedName,
    };
  }

  if (domainName && domainColor) {
    return { ...empty, barColor: domainColor, placeName: domainName, placeHint: domainName };
  }

  const label = taskLabels[0];
  if (label) {
    return { ...empty, barColor: label.color ?? null, placeName: label.name, placeHint: label.name };
  }

  return empty;
}

function resolveRowIdentity(
  meta: TaskMeta | undefined,
  taskLabels: Label[],
  groom: ReturnType<typeof liveSuggestion>,
  accent: string | null | undefined,
): RowIdentity {
  const filed = filedIdentity(meta, taskLabels, accent);
  if (!groom) return filed;

  const domainColor = meta?.domainColor ?? accent ?? null;
  const bar = groom.domainColor ?? domainColor;
  const name = groom.targetLabel || filed.placeName;
  if (!name && !bar) return { ...filed, proposal: false, proposalColor: null };

  return {
    barColor: bar,
    placeName: name,
    placeHint: name,
    proposal: true,
    proposalColor: groom.domainColor ?? domainColor,
    currentName: filed.placeName && filed.placeName !== name ? filed.placeName : null,
  };
}

/** Status/meta — two steps below the title so it reads as primary.
 *
 *  The desktop step used to be a bare `text-[8px]`: below the type scale's own
 *  floor, below any legibility floor, and applied to the highest-frequency
 *  loop in the product (inbox triage reads its Accept / ✕ through this class).
 *  It is now `--text-micro`, the smallest step the scale actually owns, which
 *  costs 1.5px of density and buys back a readable row. Phones keep the larger
 *  caption step. */
const META = "text-caption md:text-micro";

function PlaceTag({ identity }: { identity: RowIdentity }) {
  if (!identity.placeName || !identity.placeHint) return null;
  const color = identity.proposal ? identity.proposalColor : identity.barColor;
  const tinted = color
    ? { color: `color-mix(in srgb, ${color} 55%, var(--muted))` }
    : undefined;

  if (identity.proposal && color) {
    const hint = identity.currentName
      ? `${identity.currentName} → ${identity.placeHint}`
      : identity.placeHint;
    return (
      <span title={hint} className={`flex min-w-0 max-w-full items-center gap-1 truncate ${META}`}>
        {identity.currentName && (
          <span className="shrink-0 text-muted/50 line-through">{identity.currentName}</span>
        )}
        <span
          className="min-w-0 truncate rounded px-1.5 py-px"
          style={{
            ...tinted,
            background: `color-mix(in srgb, ${color} 8%, transparent)`,
          }}
        >
          {identity.placeName}
        </span>
      </span>
    );
  }

  return (
    <span title={identity.placeHint} className={`min-w-0 truncate ${META} text-muted`} style={tinted}>
      {identity.placeName}
    </span>
  );
}

function StatsCluster({
  showDur,
  showState,
  recurring,
  acceptControls,
}: {
  showDur: string | null;
  showState: { text: string; signal: boolean; title?: string } | null;
  recurring: boolean;
  acceptControls: ReactNode;
}) {
  if (!showDur && !showState && !recurring && !acceptControls) return null;

  return (
    <span className={`flex shrink-0 items-center gap-2 ${META}`}>
      {recurring && (
        <span className="text-muted" title="Repeats">
          <RecurMark className="opacity-50" />
        </span>
      )}
      {showDur && <span className="mono text-muted">{showDur}</span>}
      {showDur && showState && (
        <span className="text-muted/35 select-none" aria-hidden>
          ·
        </span>
      )}
      {showState && (
        <span
          title={showState.title}
          className={`mono ${showState.signal ? "font-medium text-signal" : "text-muted"}`}
        >
          {showState.text}
        </span>
      )}
      {acceptControls}
    </span>
  );
}

/** Imperative escape hatch for keyboard-driven completion, which has no click
 *  to hang the row's bloom-and-collapse animation off of — `triggerToggle()`
 *  runs the exact same path `toggle()` gives the checkbox. */
export interface TaskRowHandle {
  triggerToggle: () => void;
}

const TaskRow = forwardRef<TaskRowHandle, {
  task: Task;
  labels: Label[];
  selected: boolean;
  multiSelected?: boolean;
  draggable: boolean;
  /** This row is the one currently being dragged — it reads as the *source*
   *  (quiet, left behind) while the ghost under the cursor is the live copy. */
  dragging?: boolean;
  /** Comma-joined ids of the whole multi-selection, set on each selected row so
   *  dragging any one of them carries the group onto the calendar. */
  dragGroup?: string;
  onSelect: () => void;
  onOpen: (anchor: DOMRect) => void;
  onToggleDone: () => void;
  onMultiToggle?: () => void;
  /** Touch hold — the phone's way into multi-select (there is no ⌘-click on a
   *  thumb). Fires once per press, at LONG_PRESS_MS, and cancels the moment the
   *  finger travels enough to be a swipe or a scroll. */
  onLongPress?: () => void;
  /** Shift-click: extend the selection from the anchor to this row. */
  onRangeSelect?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Domain color — the task's thread back up the vertical. */
  accent?: string | null;
  meta?: TaskMeta;
  /** Optional trailing control (e.g. "▸ today" in the Week rail). */
  action?: React.ReactNode;
  /** The surface already states this row's *when* in its own voice, so the row
   *  must not restate it as a bare date word. Set by the rail's crown, where a
   *  placed piece carries a `Tue 7:15am ↗` chip: "45m · tomorrow" beside it is
   *  the same day said twice, and two answers to one question is P8. Suppresses
   *  ONLY the date label — lateness, a deadline and the roll count are different
   *  facts the chip doesn't carry, and they stay. */
  whenShown?: boolean;
  /** Extra `data-*` stamped on the row's ROOT, for drops that need more than the
   *  id. `CalendarPane` mounts one FullCalendar `Draggable` over the rail with
   *  `itemSelector: "[data-task-drag]"` and reads `data-task-week` /
   *  `data-task-project` off **that same element** — so a crown row carrying
   *  them on a wrapper would drop as a bare block instead of into the project's
   *  sitting. Omitted everywhere else; the row is byte-identical without it. */
  dragData?: Record<string, string>;
  /** Apply the passive-grooming guess (placement / duration / energy). */
  onAcceptSuggestion?: () => void;
  /** Spend the guess without applying it. */
  onDismissSuggestion?: () => void;
  /** The surface's ticking clock. Passed so a row can never disagree with the
   *  group it was sorted into — both sides must judge "overdue" off one now. */
  now?: Date;
  /** Mobile-only: horizontal swipe actions — right completes (the same bloom
   *  path as the checkbox), left defers via this handler (snooze, with its own
   *  undo toast). Pointer events, never HTML5 DnD (Tauri swallows it). Omitted
   *  on desktop, where the row is byte-identical to before. */
  swipeActions?: { onDefer: () => void };
}>(function TaskRow(
  {
    task,
    labels,
    selected,
    multiSelected,
    draggable,
    dragging,
    dragGroup,
    onSelect,
    onOpen,
    onLongPress,
    onToggleDone,
    onMultiToggle,
    onRangeSelect,
    onContextMenu,
    accent,
    meta,
    action,
    whenShown,
    dragData,
    onAcceptSuggestion,
    onDismissSuggestion,
    now,
    swipeActions,
  },
  ref,
) {
  const [completing, setCompleting] = useState(false);
  const completeTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (completeTimer.current) clearTimeout(completeTimer.current);
    },
    [],
  );
  const done = task.status === "done";
  const overdue = !done && isOverdue(task, now);
  useEffect(() => {
    if (done) setCompleting(false);
  }, [done]);
  const taskLabels = (task.task_labels ?? [])
    .map((tl) => labels.find((l) => l.id === tl.label_id))
    .filter((l): l is Label => Boolean(l));

  const toggle = () => {
    if (completing) return;
    if (!done) {
      const instant =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (instant) {
        onToggleDone();
        return;
      }
      setCompleting(true);
      completeTimer.current = window.setTimeout(() => {
        completeTimer.current = null;
        onToggleDone();
      }, COMPLETE_MS);
    } else {
      onToggleDone();
    }
  };

  useImperativeHandle(ref, () => ({ triggerToggle: toggle }));

  // Selection is resolved on mousedown (not click) so a modifier-press always
  // registers even when FullCalendar's rail Draggable is watching for a drag —
  // a tiny pointer wobble would otherwise turn the click into a (no-op) drag and
  // swallow it. shift = range from the anchor, cmd/ctrl = toggle one.
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onRangeSelect?.();
    } else if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      onMultiToggle?.();
    } else {
      onSelect();
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // Modifier selection already handled on mousedown; just don't open here.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.stopPropagation();
      return;
    }
    // Right-click (and WebKit's leftover click after contextmenu) must not
    // also open the task — that swapped the nav, unmounted the menu, and
    // made "right-click → Delete" a no-op.
    if (e.button !== 0 || Date.now() - justContexted.current < 500) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // The release that ended a swipe — or a long press — must not also open it.
    if (Date.now() - justHeld.current < 500) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (Date.now() - justSwiped.current < 400) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onOpen(e.currentTarget.getBoundingClientRect());
  };

  // ── mobile swipe actions ──────────────────────────────────────────────────
  // Engages only once travel is clearly horizontal (2:1, >12px) — a vertical
  // wobble hands the touch back to the list scroll — and never from the 24px
  // left edge that belongs to the iOS back gesture. Below SWIPE_FIRE_PX the
  // row snaps back and nothing fires.
  const SWIPE_FIRE_PX = 60;
  const swipe = useRef<{ x: number; y: number; id: number; engaged: boolean } | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const [swipeSnap, setSwipeSnap] = useState(false);
  const justSwiped = useRef(0);

  // Long press → multi-select. Same 450ms the record sheet and the deck use, so
  // "hold to act on this" feels like one gesture across the phone.
  const LONG_PRESS_MS = 450;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justHeld = useRef(0);
  const justContexted = useRef(0);
  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const onSwipeDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" && onLongPress) {
      cancelHold();
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        justHeld.current = Date.now();
        // A selection appearing under your thumb with no feedback reads as a
        // glitch; the platform haptic is the cheapest honest confirmation.
        navigator.vibrate?.(8);
        onLongPress();
      }, LONG_PRESS_MS);
    }
    if (!swipeActions || e.pointerType === "mouse") return;
    if (e.clientX < 24) return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId, engaged: false };
    setSwipeSnap(false);
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const s = swipe.current;
    // Any real travel means this is a swipe or a scroll, not a hold.
    if (holdTimer.current && s && (Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8)) cancelHold();
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.engaged) {
      if (Math.abs(dy) > 14) {
        swipe.current = null;
        return;
      }
      if (Math.abs(dx) > 12 && Math.abs(dx) > 2 * Math.abs(dy)) {
        s.engaged = true;
        e.currentTarget.setPointerCapture(s.id);
      } else {
        return;
      }
    }
    setSwipeX(Math.max(-120, Math.min(120, dx)));
  };
  const onSwipeUp = (e: React.PointerEvent) => {
    cancelHold();
    const s = swipe.current;
    swipe.current = null;
    if (!s?.engaged) return;
    const dx = e.clientX - s.x;
    setSwipeSnap(true);
    setSwipeX(0);
    if (Math.abs(dx) < SWIPE_FIRE_PX) return;
    justSwiped.current = Date.now();
    if (dx > 0) toggle();
    else swipeActions?.onDefer();
  };
  // Attached whenever EITHER gesture is wanted — the long press lives on the
  // same pointer stream as the swipe, so a row with only one still gets it.
  const swipeHandlers =
    swipeActions || onLongPress
      ? {
          onPointerDown: onSwipeDown,
          onPointerMove: onSwipeMove,
          onPointerUp: onSwipeUp,
          onPointerCancel: onSwipeUp,
        }
      : {};

  // Format do_date relative
  const dateLabel = (() => {
    if (!task.do_date) return null;
    const t = todayISO();
    const tm = tomorrowISO();
    if (task.do_date === t) return "today";
    if (task.do_date === tm) return "tomorrow";
    return task.do_date.slice(5).replace("-", "/"); // MM/DD
  })();

  // ── the three facts a row states ────────────────────────────────────────────
  // WHERE it belongs, HOW LONG it takes, and — only when abnormal — WHAT STATE
  // it's in. That's the set; everything else the row used to carry was ours, not
  // the reader's.
  //
  // No clock time. On the Schedule the calendar sits inches away rendering the
  // very same block, and design-language's own rule kills a list that restates
  // the calendar.
  const durText = task.duration_minutes ? fmtDuration(task.duration_minutes) : null;
  const dateText = dateLabel && !task.start_time && !whenShown ? dateLabel : null;
  const rollText = task.roll_count > 0 ? `↻${task.roll_count}` : null;
  const rollTitle = task.roll_count > 0 ? `Rolled over ${task.roll_count}×` : "Repeats";
  const pastDeadline = Boolean(task.deadline && !done && task.deadline < todayISO());

  // AT MOST ONE `--signal` item per row, and it says how far gone the work is
  // rather than naming a state: "2d late" is the fact you decide on; "overdue" is
  // a word you already knew from the group it's sitting in.
  const lateText = overdue ? fmtLateness(task, now) : null;
  const state: { text: string; signal: boolean; title?: string } | null = lateText
    ? { text: lateText, signal: true, title: task.start_time ? `Was ${fmtTime(task.start_time)}` : undefined }
    : pastDeadline && task.deadline
      ? { text: `⚑${task.deadline.slice(5)}`, signal: true, title: `Deadline passed ${task.deadline}` }
      : task.deadline && !done
        ? { text: `⚑${task.deadline.slice(5)}`, signal: false, title: `Deadline ${task.deadline}` }
        : rollText
          ? { text: rollText, signal: false, title: rollTitle }
          : dateText
            ? { text: dateText, signal: false }
            : null;

  // Passive grooming's guess — surfaced only where the row wired up accept/dismiss
  // (the inbox), and only when fresh and actionable.
  const groom = onAcceptSuggestion ? liveSuggestion(task) : null;

  // ── one line, one height, one order ─────────────────────────────────────────
  // Calm in a dense list comes from UNIFORMITY, not from showing less. Every row
  // is one line of the same height: title left, then a narrow band of metadata
  // right, always in the same order (state · weight · area). Six tasks are six eye
  // stops. The two-line version was ragged — some rows one line, some two, the
  // area chip landing at a different x on every row — and eleven eye stops at
  // three indents is what actually reads as noise, whatever the palette. The
  // reference list we kept losing to shows MORE metadata than we did and still
  // reads quieter, because every row of it is identical in shape.
  //
  // The title truncates. That is the price, and it's the right price: a title you
  // can open beats a column you can't scan.
  // The INBOX wears the same row. A grooming guess used to get its own shape — a
  // small-caps parent eyebrow, a third line for energy + estimate, `items-start`,
  // 67px — so the inbox mixed 44px and 67px rows and stayed exactly as ragged as
  // the Today list used to be. A guess is still distinguishable, but through the
  // thing that actually differs: it carries Accept / ✕. Not through a different
  // height. The suggested parent takes a pill (in its own hue, so a proposal
  // still reads as a proposal), the estimate takes the weight slot, and the
  // energy read survives in the row's tooltip rather than a whole line.
  // Title on top; floating meta below — schedule · duration · place, fixed slots.
  const identity = resolveRowIdentity(meta, taskLabels, groom, accent);
  const showDur = groom
    ? (groom.durationMinutes ? fmtDuration(groom.durationMinutes) : null)
    : durText;
  const showState = groom ? null : state;
  const hasPlace = Boolean(identity.placeName);
  const hasMeta = Boolean(showState || showDur || task.recurrence_id || groom);

  // Accept / dismiss — the one thing that genuinely distinguishes a guess from a
  // filed fact, so it's what marks the row instead of a taller silhouette.
  const acceptControls = groom ? (
    // gap-2 on the desk, not gap-1: Accept and ✕ are opposite decisions, and at
    // 4px apart in identical type a misclick threw away the guess. 8px is the
    // WCAG 2.5.8 spacing allowance and the smallest gap that reads as "two
    // controls" rather than one cluster.
    <span className="flex shrink-0 items-center gap-1 md:gap-2" onClick={(e) => e.stopPropagation()}>
      {/* The desktop floor is written as `md:min-h-6` rather than a `.tap-desk`
          class because these buttons already carry an explicit `md:min-h-0`
          from the phone rule — two same-specificity declarations whose winner
          would depend on stylesheet order. An explicit utility can't race. */}
      <button
        onClick={(e) => { e.stopPropagation(); onAcceptSuggestion?.(); }}
        className={`fast min-h-[44px] rounded px-3 md:min-h-6 md:px-2 md:py-px ${META} font-medium text-accent hover:bg-accent-soft`}
      >
        Accept
      </button>
      <button
        aria-label="Dismiss suggestion"
        onClick={(e) => { e.stopPropagation(); onDismissSuggestion?.(); }}
        className={`fast min-h-[44px] rounded px-3 md:min-h-6 md:min-w-6 md:px-1 md:py-px ${META} text-muted hover:text-ink`}
      >
        ✕
      </button>
    </span>
  ) : null;

  // Accept / ✕ deliberately do NOT travel inside StatsCluster any more. They
  // used to ride whichever content line the stats landed on — the title line on
  // a placeless row, the place line on a row carrying a domain chip — which put
  // the same two controls at two different heights depending on the row's
  // contents. Measured: 9.8px below the row's centre on a two-line row, dead
  // centre on a one-line one. In a list you triage by clicking the same spot
  // over and over, that is the whole cost. They are now a sibling of the
  // content column, so the row's own `items-center` centres them against the
  // full row height whatever it contains.
  const stats = (
    <StatsCluster
      showDur={showDur}
      showState={showState}
      recurring={Boolean(task.recurrence_id)}
      acceptControls={null}
    />
  );

  // The rail is transparent, so its rows already sit ON `--bg` — which means the
  // original `hover:bg-bg` / `selected:bg-bg` painted the row the exact colour it
  // already was. Measured: canvas 0.8808 luminance, hover target 0.8808. Hover
  // and selection were literal no-ops, which is why nothing here read as
  // touchable.
  // Then the first fix overshot: a full `bg-surface` row is a +11.6% luminance
  // jump, which reads as the row lighting up rather than answering the pointer.
  // `.row-hover` is 40% of that (~+3.9%) — see the note on it in index.css. The
  // focal row still *lifts* rather than gaining a flat ring, and stays the louder
  // of the two states, which is the correct order.
  const bg = multiSelected
    ? "bg-accent-soft"
    : selected
      ? "glass-lift-row"
      : "row-hover";

  const rowHint = groom
    ? [groom.energy ? `${ENERGY_META[groom.energy].icon} ${ENERGY_META[groom.energy].label}` : null, groom.rationale]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <div
      {...(draggable ? { "data-tauri-drag-region": "false" as const } : {})}
      data-task-drag={draggable ? task.id : undefined}
      data-task-drag-group={dragGroup}
      data-task-title={task.title}
      data-task-duration={task.duration_minutes ?? ""}
      {...dragData}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={(e) => {
        justContexted.current = Date.now();
        onContextMenu?.(e);
      }}
      {...swipeHandlers}
      // The row is a div (it carries a drag handle, a context menu, swipe
      // gestures and nested buttons — none of which survive a <button>), so it
      // has to be told how to be one. Enter/Space opens, same as the click.
      {...pressable(
        (e) => onOpen((e.currentTarget as HTMLElement).getBoundingClientRect()),
        { label: task.title },
      )}
      // `aria-current`, not `aria-selected`: the row announces itself as a
      // button (Enter opens it), and `aria-selected` is only meaningful on an
      // option inside a listbox. Claiming it here would describe a listbox the
      // rail doesn't implement.
      aria-current={selected || multiSelected ? "true" : undefined}
      title={rowHint}
      className={`group cursor-pointer select-none border-b border-line px-3.5 py-2.5 last:border-b-0 ${
        completing ? "task-completing" : "fast"
      } ${dragging ? "row-dragging" : bg} ${swipeActions ? "relative overflow-hidden" : ""}`}
      style={swipeActions ? { touchAction: "pan-y" } : undefined}
    >
      {swipeActions && swipeX !== 0 && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-between px-4 text-caption font-medium"
          style={{
            background:
              swipeX > 0
                ? "color-mix(in srgb, var(--ok) 16%, transparent)"
                : "color-mix(in srgb, var(--accent) 12%, transparent)",
          }}
        >
          <span style={{ color: "var(--ok)", opacity: swipeX > 0 ? 1 : 0 }}>✓ done</span>
          <span style={{ color: "var(--accent)", opacity: swipeX < 0 ? 1 : 0 }}>tomorrow ↷</span>
        </div>
      )}
      <div
        className="flex min-w-0 items-center gap-3"
        style={
          swipeActions
            ? {
                transform: `translateX(${swipeX}px)`,
                transition: swipeSnap ? "transform 180ms var(--ease-out)" : undefined,
              }
            : undefined
        }
      >
        <button
          aria-label={done ? "Mark not done" : "Mark done"}
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          // tap-bloom gives the phone 44px; tap-desk-bloom gives the mouse its
          // own 24px floor. Both are invisible ::before area — the drawn 15px
          // box is untouched, so the row's density reads exactly as before.
          className={`tap-bloom tap-desk-bloom relative flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-none ${
            completing ? "bloom" : ""
          } ${done || completing ? "border-accent bg-accent text-on-accent" : "border-muted hover:border-accent"}`}
        >
          {(done || completing) && (
            <Icon name="check" size={9} />
          )}
        </button>

        <div className={`min-w-0 flex-1 ${hasPlace ? "flex flex-col gap-1" : ""}`}>
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`min-w-0 flex-1 text-head leading-snug line-clamp-2 md:line-clamp-none md:truncate md:text-caption font-medium ${done || completing ? "text-muted line-through" : ""}`}
            >
              {task.title}
            </span>

            {task.prework_at && task.prework && !done && (
              <span className="mono shrink-0 text-micro text-accent" title="Prework ready">
                ✦
              </span>
            )}

            {!hasPlace && hasMeta && stats}

            {action}
          </div>

          {hasPlace && (
            <div className="flex min-w-0 items-center justify-between gap-3">
              <PlaceTag identity={identity} />
              {stats}
            </div>
          )}
        </div>

        {/* Row-level, so it centres against the whole row rather than a text
            line. See the note on `stats` above. */}
        {acceptControls}
      </div>
    </div>
  );
});

export default TaskRow;
