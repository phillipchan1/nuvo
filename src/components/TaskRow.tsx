import { useEffect, useRef, useState } from "react";
import type { Label, Task } from "../lib/types";
import { ENERGY_META } from "../lib/energy";
import { liveSuggestion } from "../lib/grooming";
import { fmtDuration, fmtLateness, fmtTime, isOverdue, todayISO, tomorrowISO } from "../lib/dates";
import { PriorityDot } from "./ui";

/** Row exit + checkbox bloom — keep in sync with `--d-task-complete` in index.css. */
const COMPLETE_MS = 640;

export interface TaskMeta {
  project?: string | null;
  domain?: string | null;
  domainColor?: string | null;
}

export default function TaskRow({
  task,
  labels,
  selected,
  multiSelected,
  draggable,
  dragging,
  dragGroup,
  onSelect,
  onOpen,
  onToggleDone,
  onMultiToggle,
  onRangeSelect,
  onContextMenu,
  accent,
  meta,
  action,
  onAcceptSuggestion,
  onDismissSuggestion,
  now,
}: {
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
  /** Shift-click: extend the selection from the anchor to this row. */
  onRangeSelect?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Domain color — the task's thread back up the vertical. */
  accent?: string | null;
  meta?: TaskMeta;
  /** Optional trailing control (e.g. "▸ today" in the Week rail). */
  action?: React.ReactNode;
  /** Apply the passive-grooming guess (placement / duration / energy). */
  onAcceptSuggestion?: () => void;
  /** Spend the guess without applying it. */
  onDismissSuggestion?: () => void;
  /** The surface's ticking clock. Passed so a row can never disagree with the
   *  group it was sorted into — both sides must judge "overdue" off one now. */
  now?: Date;
}) {
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
    onOpen(e.currentTarget.getBoundingClientRect());
  };

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
  // One chip, and the vertical wins it: a project or domain says where this work
  // lives. A loose task with no home falls back to its first label, so the slot is
  // never wasted and an uncategorised row still says something about itself.
  const areaName = meta?.project ?? meta?.domain ?? taskLabels[0]?.name ?? null;
  const areaColor = meta?.project || meta?.domain ? meta?.domainColor : taskLabels[0]?.color;
  const dateText = dateLabel && !task.start_time ? dateLabel : null;
  const rollText = task.roll_count > 0 ? `↻${task.roll_count}` : task.recurrence_id ? "↻" : null;
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
  // height. The suggested parent takes the area chip (in its own hue, so a
  // proposal still reads as a proposal), the estimate takes the weight slot, and
  // the energy read survives in the row's tooltip rather than a whole line.
  const showArea = groom ? groom.targetLabel : areaName;
  const showColor = groom ? groom.domainColor : areaColor;
  const showDur = groom
    ? (groom.durationMinutes ? fmtDuration(groom.durationMinutes) : null)
    : durText;
  const showState = groom ? null : state;

  // Accept / dismiss — the one thing that genuinely distinguishes a guess from a
  // filed fact, so it's what marks the row instead of a taller silhouette.
  const acceptControls = groom ? (
    <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); onAcceptSuggestion?.(); }}
        className="fast rounded px-1.5 py-px text-micro font-medium text-accent hover:bg-accent-soft"
      >
        Accept
      </button>
      <button
        aria-label="Dismiss suggestion"
        onClick={(e) => { e.stopPropagation(); onDismissSuggestion?.(); }}
        className="fast rounded px-1 py-px text-micro text-muted hover:text-ink"
      >
        ✕
      </button>
    </span>
  ) : null;

  const trailing = showState || showDur || showArea || groom ? (
    <div className="flex shrink-0 items-center gap-1.5 pl-2">
      {showState && (
        <span
          title={showState.title}
          className={`mono text-meta ${showState.signal ? "font-medium text-signal" : "text-muted"}`}
        >
          {showState.text}
        </span>
      )}
      {showDur && <span className="mono text-meta text-muted">{showDur}</span>}
      {/* The area chip spends its hue ONCE: a wash for the ground, and the same hue
          pulled most of the way to --muted for the label. A domain-coloured label
          on a domain-coloured ground is two colour signals stacked on the row's
          quietest element, which is how a chip meant to whisper identity ends up
          dominating the surface. Named, not just tinted — colour alone fails
          because nobody memorises the palette. */}
      {showArea && (
        <span
          className="max-w-[92px] truncate rounded px-1.5 py-px text-meta"
          style={
            showColor
              ? {
                  background: `color-mix(in srgb, ${showColor} 9%, transparent)`,
                  color: `color-mix(in srgb, ${showColor} 45%, var(--muted))`,
                }
              : { background: "color-mix(in srgb, var(--muted) 9%, transparent)", color: "var(--muted)" }
          }
          title={showArea}
        >
          {showArea}
        </span>
      )}
      {acceptControls}
    </div>
  ) : null;

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

  // A guess that binds a project/initiative is a "push" — it moves a real object
  // up the vertical, so its spine reads thicker. That's the whole tell now; the
  // eyebrow and the third line are gone (see the inbox note above).
  const groomPush =
    groom != null &&
    (groom.level === "project" || groom.level === "initiative") &&
    Boolean(groom.targetLabel);
  // The push spine borrows the suggested domain color even before the task is
  // filed; loose rows fall back to the row's own accent (usually none in inbox).
  const spineColor = groomPush && groom ? (groom.domainColor ?? accent ?? null) : (accent ?? null);

  return (
    <div
      {...(draggable ? { "data-tauri-drag-region": "false" as const } : {})}
      data-task-drag={draggable ? task.id : undefined}
      data-task-drag-group={dragGroup}
      data-task-title={task.title}
      data-task-duration={task.duration_minutes ?? ""}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      /* The guess's energy read used to own a whole line; it survives here, where
         it costs no height. The estimate and the parent already ride the row. */
      title={
        groom
          ? [groom.energy ? `${ENERGY_META[groom.energy].icon} ${ENERGY_META[groom.energy].label}` : null, groom.rationale]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
      className={`fast group flex h-11 cursor-pointer select-none items-center gap-2 border-b border-line last:border-b-0 px-3 ${
        completing ? "task-completing" : ""
      } ${dragging ? "row-dragging" : bg}`}
      style={spineColor ? { boxShadow: `inset ${groomPush ? 3 : 2}px 0 0 0 ${spineColor}` } : undefined}
    >
      {/* Checkbox */}
      <button
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        /* The empty box wore `border-line` — 1.16:1 against the paper, where the
           minimum for a non-text UI control is 3:1. It wasn't dim, it was
           invisible, and an invisible control is most of why a row didn't read as
           actionable. `--line` is defined as "hairlines at the edge of
           perception": right for a divider, wrong for the one thing on the row
           you're meant to click. `--muted` clears the bar at 3.7:1 without
           becoming an accent (accent would read as already-checked).
           `--line-strong` was not an option — 1.37:1 still fails. */
        className={`fast relative flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border ${
          completing ? "bloom" : ""
        } ${done || completing ? "border-accent bg-accent text-white" : "border-muted hover:border-accent"}`}
      >
        {(done || completing) && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )}
      </button>

      <PriorityDot priority={task.priority} />

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        {/* Line 1 — the title, ALONE. The only thing allowed to cross it is the
            prework mark, because "prep is ready" is the one fact that acts right
            now. Everything that used to pile up here — the repeat glyph, the roll
            chip, the word "overdue", the deadline flag — moved to the gutter as a
            number. And the title keeps its ink when late: red-alert styling for a
            non-urgent state is exactly what P4 forbids. */}
        <div className="flex min-w-0 items-center gap-1.5">
          {/* WEIGHT carries the hierarchy here, not size. The title used to have a
              2.5px size gap and a ZERO weight gap over the metadata annotating it
              — both 400 — while the chips carry fills, so 10.5px chip text had
              visual mass that unfilled 13px title text didn't. The title barely
              outranked its own footnotes, which is what read as thin and
              un-actionable.
              So the title went the other way from the obvious fix: DOWN a size
              step (13 → 12, `text-caption`) and UP a weight step (400 → 500).
              14px and 15px were both driven against real data and were
              overcompensation — they bought less than the weight step and cost
              real title characters. 12/500 is calmer than 13/500 *and* truncates
              less than 13/400 ever did. Contrast was never the lever: ink is
              already 15.29:1 of a possible 18.62:1 on the paper. */}
          <span className={`min-w-0 flex-1 truncate text-caption font-medium ${done || completing ? "text-muted line-through" : ""}`}>
            {task.title}
          </span>

          {task.prework_at && task.prework && !done && (
            <span className="mono shrink-0 text-micro text-accent" title="Prework ready">✦</span>
          )}
          {trailing}
        </div>
      </div>

      {action}
    </div>
  );
}
