import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { haptic } from "../lib/haptics";
import { resistedTravel } from "../lib/gesture";
import { Icon } from "./Icon";
import type { Label, Task } from "../lib/types";
import { ENERGY_META } from "../lib/energy";
import { autoFiled, liveSuggestion } from "../lib/grooming";
import { fmtDuration, fmtLateness, fmtTime, isOverdue, todayISO, tomorrowISO } from "../lib/dates";
import { carriedTitle } from "./ui";
import { pressable } from "../lib/a11y";
import { motionMs, motionOff } from "../lib/motion";
import { at, span } from "./mobile/dayPlan";
import { Button, Chip, Dot, IconButton, TaskCheck } from "./kit";

// The task row — ONE row, wherever a task appears, on both shells (D-111).
//
// Instrument (D-190): a single line in the kit's list-row geometry — the round
// TaskCheck · the title · where it belongs · the facts in tabular figures ·
// the domain's Dot. 32px and inset on the desktop, 48px and full-bleed on a
// phone (`.task-row`, styles/rail.css). Selected is an accent wash with an
// accent edge, in place; done is faint; hover is instant in and fades out.
//
// Every row is identical in SHAPE, which is what makes a dense list calm: one
// line, one height, the facts always in the same order. The title truncates —
// a title you can open beats a column you can't scan.

/** The whole completion — LAND (the check stamps, the strike draws), then LET
 *  GO (the row folds away) — read from the material's `--d-task-complete`
 *  (styles/momentum.css), so the write waits exactly as long as the row takes
 *  to leave. 440ms is the fallback, used only when no stylesheet answers (a
 *  test). D-187. */
const COMPLETE_FALLBACK_MS = 440;

export interface TaskMeta {
  project?: string | null;
  initiative?: string | null;
  domain?: string | null;
  domainColor?: string | null;
}

/** Where a row belongs — the domain's hue, and the name that states it. */
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
  /** The place is a project or initiative (named on the row), not just a
   *  domain (which the Dot already says). */
  filed: boolean;
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
    filed: false,
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
      filed: true,
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
    filed: true,
  };
}

/** The place, said in words — only when the Dot alone can't say it: a project
 *  or initiative by name, or a proposal (which must name what it proposes). */
function PlaceTag({ identity }: { identity: RowIdentity }) {
  if (!identity.placeName || !identity.placeHint) return null;
  if (identity.proposal) {
    const hint = identity.currentName ? `${identity.currentName} → ${identity.placeHint}` : identity.placeHint;
    return (
      <span className="task-row-place" title={hint}>
        {identity.currentName && <s>{identity.currentName}</s>}
        <Chip dot={identity.proposalColor ?? undefined}>{identity.placeName}</Chip>
      </span>
    );
  }
  if (!identity.filed) return null;
  return (
    <span className="task-row-place" title={identity.placeHint}>
      {identity.placeName}
    </span>
  );
}

/** Imperative escape hatch for keyboard-driven completion, which has no click
 *  to hang the row's land-and-let-go off of — `triggerToggle()` runs the exact
 *  same path `toggle()` gives the checkbox. */
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
   *  must not restate it — neither the date word nor the clock. Set by the
   *  rail's crown, where a placed piece carries a `Tue 7:15am ↗` chip: "45m ·
   *  tomorrow" beside it is the same day said twice, and two answers to one
   *  question is P8. Lateness, a deadline and the roll count are different
   *  facts the chip doesn't carry, and they stay. */
  whenShown?: boolean;
  /** The surface already names the DAY (the rail's Today face) — the row drops
   *  the date word but still says its clock. */
  dayShown?: boolean;
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
  /** Take back a domain Nuvo filed on its own (the router was sure enough to
   *  write it). Passed only where the row is an Inbox row. */
  onUndoAutoFile?: () => void;
  /** The surface's ticking clock. Passed so a row can never disagree with the
   *  group it was sorted into — both sides must judge "overdue" off one now. */
  now?: Date;
  /** Mobile-only: horizontal swipe actions — right completes (the same land
   *  path as the checkbox), left defers via this handler (snooze, with its own
   *  undo toast). Pointer events, never HTML5 DnD (Tauri swallows it). Omitted
   *  on desktop, where the row is byte-identical to before. */
  swipeActions?: { onDefer: () => void };
  /** ⌘E — the title becomes a field in place. `onRename(null)` means cancel. */
  editing?: boolean;
  onRename?: (title: string | null) => void;
  /** The checkbox sits on the host's left edge (a record's spine) instead of
   *  inset — the hover wash and the selection still get room either side. */
  flush?: boolean;
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
    dayShown,
    dragData,
    onAcceptSuggestion,
    onDismissSuggestion,
    onUndoAutoFile,
    now,
    swipeActions,
    editing,
    onRename,
    flush,
  },
  ref,
) {
  const [completing, setCompleting] = useState(false);
  const rowEl = useRef<HTMLDivElement | null>(null);
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
      // Reduced motion: the write is the whole act — no land, no wait.
      if (motionOff()) {
        onToggleDone();
        return;
      }
      // Pin the fold's starting box to what's actually on screen (see
      // `task-complete` in index.css).
      const el = rowEl.current;
      if (el) {
        const cs = getComputedStyle(el);
        el.style.setProperty("--row-h", `${el.offsetHeight}px`);
        el.style.setProperty("--row-pt", cs.paddingTop);
        el.style.setProperty("--row-pb", cs.paddingBottom);
      }
      setCompleting(true);
      completeTimer.current = window.setTimeout(() => {
        completeTimer.current = null;
        onToggleDone();
      }, motionMs("--d-task-complete") || COMPLETE_FALLBACK_MS);
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
  // Past the fire threshold the action is "armed": the reveal fills solid and a
  // haptic ticks once, the way Mail / Reminders tell you letting go will act.
  const swipeArmed = useRef(false);

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
        haptic("medium");
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
    // Follows the finger 1:1 up to the threshold, then with rubber-band
    // resistance — never a hard wall.
    setSwipeX(resistedTravel(dx, SWIPE_FIRE_PX, 150));
    const armed = Math.abs(dx) >= SWIPE_FIRE_PX;
    if (armed !== swipeArmed.current) {
      swipeArmed.current = armed;
      if (armed) haptic("selection");
    }
  };
  const onSwipeUp = (e: React.PointerEvent) => {
    cancelHold();
    const s = swipe.current;
    swipe.current = null;
    if (!s?.engaged) return;
    const dx = e.clientX - s.x;
    swipeArmed.current = false;
    setSwipeSnap(true);
    setSwipeX(0);
    if (Math.abs(dx) < SWIPE_FIRE_PX) return;
    justSwiped.current = Date.now();
    if (dx > 0) { haptic(done ? "light" : "success"); toggle(); }
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

  // ── the facts a row states ──────────────────────────────────────────────────
  // WHERE it belongs (the Dot, and a project's name), WHEN or HOW LONG, and —
  // only when abnormal — WHAT STATE it's in. In that order, every row.
  const dateLabel = (() => {
    if (!task.do_date) return null;
    const t = todayISO();
    const tm = tomorrowISO();
    if (task.do_date === t) return "today";
    if (task.do_date === tm) return "tomorrow";
    return task.do_date.slice(5).replace("-", "/"); // MM/DD
  })();

  // The clock, in the one spelling (`at` / `span`, dayPlan) — except where the
  // surface already says when: the crown's time chip, or a slot's header (a
  // slot's tasks share its start, so a clock on each would be one time, wrong
  // N times).
  const clockText = (() => {
    if (!task.start_time || whenShown || task.slot_id) return null;
    const start = new Date(task.start_time);
    if (Number.isNaN(start.getTime())) return null;
    return task.duration_minutes ? span(start, new Date(start.getTime() + task.duration_minutes * 60_000)) : at(start);
  })();
  const durText = task.duration_minutes ? fmtDuration(task.duration_minutes) : null;
  const dateText = dateLabel && !task.start_time && !whenShown && !dayShown ? dateLabel : null;
  // `roll_count` is days carried (D-147), so the mark says how long, not how often.
  const rollText = task.roll_count > 0 ? `↻${task.roll_count}d` : null;
  const pastDeadline = Boolean(task.deadline && !done && task.deadline < todayISO());

  // AT MOST ONE `--signal` item per row, and it says how far gone the work is
  // rather than naming a state: "2d late" is the fact you decide on.
  const lateText = overdue ? fmtLateness(task, now) : null;
  type State = { text: string; kind: "late" | "deadline" | "roll" | "date"; title?: string };
  const state: State | null = lateText
    ? { text: lateText, kind: "late", title: task.start_time ? `Was ${fmtTime(task.start_time)}` : undefined }
    : pastDeadline && task.deadline
      ? { text: `⚑${task.deadline.slice(5)}`, kind: "late", title: `Deadline passed ${task.deadline}` }
      : task.deadline && !done
        ? { text: `⚑${task.deadline.slice(5)}`, kind: "deadline", title: `Deadline ${task.deadline}` }
        : rollText
          ? { text: rollText, kind: "roll", title: carriedTitle(task.roll_count) }
          : dateText
            ? { text: dateText, kind: "date" }
            : null;

  // Passive grooming's guess — surfaced only where the row wired up accept/dismiss
  // (the inbox), and only when fresh and actionable.
  const groom = onAcceptSuggestion ? liveSuggestion(task) : null;
  // A domain Nuvo already wrote. It is not a proposal: the place shows it as
  // filed (the task really carries that domain), and the only act left is Undo.
  const auto = !groom && onUndoAutoFile ? autoFiled(task) : null;

  const identity = resolveRowIdentity(meta, taskLabels, groom, accent);
  // A guess carries its own estimate; a late row's clock is history, so its
  // lateness stands in for it.
  const showTime = groom
    ? groom.durationMinutes
      ? fmtDuration(groom.durationMinutes)
      : null
    : lateText
      ? durText
      : clockText ?? durText;
  const showState = groom ? null : state;

  // Accept / dismiss — the one thing that genuinely distinguishes a guess from a
  // filed fact. Opposite decisions sit 4px apart in different weights, never in
  // identical type.
  const acceptControls = groom ? (
    <span className="task-row-acts" onClick={(e) => e.stopPropagation()}>
      <Button
        size="xs"
        className="tap-bloom"
        onClick={(e) => {
          e.stopPropagation();
          onAcceptSuggestion?.();
        }}
      >
        Accept
      </Button>
      <IconButton
        size="xs"
        className="tap-bloom"
        label="Dismiss suggestion"
        icon={<Icon name="close" size={12} />}
        onClick={(e) => {
          e.stopPropagation();
          onDismissSuggestion?.();
        }}
      />
    </span>
  ) : auto ? (
    <span className="task-row-acts" onClick={(e) => e.stopPropagation()}>
      <Button
        size="xs"
        kind="ghost"
        className="tap-bloom"
        aria-label={`Undo: filed to ${auto.targetLabel}`}
        onClick={(e) => {
          e.stopPropagation();
          onUndoAutoFile?.();
        }}
      >
        Undo
      </Button>
    </span>
  ) : null;

  const rowHint = auto
    ? `Filed to ${auto.targetLabel} automatically${auto.rationale ? ` · ${auto.rationale}` : ""}`
    : groom
    ? [groom.energy ? `${ENERGY_META[groom.energy].icon} ${ENERGY_META[groom.energy].label}` : null, groom.rationale]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  const checked = done || completing;
  // The Dot is identity, so a proposal (which draws its own, in a chip) and a
  // row with no place at all have none.
  const dotColor = identity.proposal ? null : identity.barColor;

  return (
    <div
      ref={rowEl}
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
      // option inside a listbox.
      aria-current={selected || multiSelected ? "true" : undefined}
      title={rowHint}
      data-swiping={swipeX !== 0 ? "true" : undefined}
      data-selected={selected && !dragging ? "" : undefined}
      data-multi={multiSelected && !selected && !dragging ? "" : undefined}
      data-done={done ? "" : undefined}
      data-completing={completing ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      data-flush={flush ? "" : undefined}
      className={`task-row group ${completing ? "task-completing" : ""} ${swipeActions ? "overflow-hidden" : ""}`}
      style={swipeActions ? { touchAction: "pan-y" } : undefined}
    >
      {swipeActions && swipeX !== 0 && (() => {
        const armed = Math.abs(swipeX) >= SWIPE_FIRE_PX;
        const hue = swipeX > 0 ? "var(--ok)" : "var(--accent)";
        return (
          <div
            aria-hidden
            className="task-row-swipe"
            // A tint while you're deciding; solid once letting go will act.
            style={{ background: armed ? hue : `color-mix(in srgb, ${hue} 14%, transparent)` }}
          >
            <span
              style={{
                color: armed ? "var(--on-accent)" : "var(--ok)",
                opacity: swipeX > 0 ? 1 : 0,
                transform: `scale(${armed && swipeX > 0 ? 1.08 : 1})`,
              }}
            >
              <Icon name="check" size={14} />
              Done
            </span>
            <span
              style={{
                color: armed ? "var(--on-accent)" : "var(--accent)",
                opacity: swipeX < 0 ? 1 : 0,
                transform: `scale(${armed && swipeX < 0 ? 1.08 : 1})`,
              }}
            >
              Tomorrow
              <Icon name="arrow-right" size={14} />
            </span>
          </div>
        );
      })()}
      <div
        className="task-row-body"
        style={
          swipeActions
            ? {
                transform: `translateX(${swipeX}px)`,
                transition: swipeSnap ? "transform var(--d-native) var(--ease-native)" : undefined,
              }
            : undefined
        }
      >
        {/* LAND: the check stamps in on the material's land easing, once — the
            kit's round TaskCheck, which keeps a 28px (44px under touch) hit
            area around a 14px mark. */}
        <TaskCheck
          checked={checked}
          onChange={() => toggle()}
          label={done ? "Mark not done" : "Mark done"}
          className={completing ? "land-stamp" : undefined}
        />

        {editing ? (
          <RenameField title={task.title} onDone={(t) => onRename?.(t)} />
        ) : (
          <span className="task-row-title">
            {/* While it lands, the strike is DRAWN across the words (an inline
                span, so it is exactly as long as the title) rather than
                switched on — the one beat that says "that's done". */}
            {completing ? <span className="land-strike">{task.title}</span> : task.title}
          </span>
        )}

        {!done && (task.priority === "high" || task.priority === "medium") && (
          <span
            // Priority isn't time: `--signal` is now / late (D-054 — one
            // signal mark per row). Ink carries the weight instead.
            className="task-row-flag"
            data-tone={task.priority === "high" ? undefined : "medium"}
            title={task.priority === "high" ? "High priority" : "Medium priority"}
            aria-label={task.priority === "high" ? "High priority" : "Medium priority"}
          >
            !
          </span>
        )}

        {task.prework_at && task.prework && !done && (
          <span className="task-row-flag" data-tone="prework" title="Prework ready">
            ✦
          </span>
        )}

        <PlaceTag identity={identity} />
        {/* A domain Nuvo filed on its own is named beside its Undo — an undo
            must say what it takes back. */}
        {auto && !identity.filed && (
          <span className="task-row-place" title={rowHint}>
            {auto.targetLabel}
          </span>
        )}

        {(showState || showTime || task.recurrence_id) && (
          <span className="task-row-meta">
            {task.recurrence_id && <Icon name="repeat" size={12} title="Repeats" />}
            {showState && (
              <span
                title={showState.title}
                data-late={showState.kind === "late" ? "" : undefined}
                data-deadline={showState.kind === "deadline" ? "" : undefined}
              >
                {showState.text}
              </span>
            )}
            {showTime && <span>{showTime}</span>}
          </span>
        )}

        {action}

        {dotColor && <Dot color={dotColor} title={identity.placeHint ?? undefined} />}

        {acceptControls}
      </div>
    </div>
  );
});

export default TaskRow;

/** The title as a field, in place (⌘E). Enter or blur keeps it, Escape (or an
 *  emptied field) puts the old title back — a row is never renamed to nothing. */
function RenameField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    const t = next?.trim();
    onDone(t && t !== title ? t : null);
  };
  return (
    <input
      autoFocus
      value={value}
      aria-label="Rename task"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
      className="nuvo-inline-input task-row-rename"
    />
  );
}
