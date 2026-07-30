import { useState } from "react";
import type { Label, Task } from "../lib/types";
import { ENERGY_META } from "../lib/energy";
import { liveSuggestion } from "../lib/grooming";
import { fmtDuration, fmtLateness, fmtTime, isOverdue, todayISO, tomorrowISO } from "../lib/dates";
import { PriorityDot } from "./ui";

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
  const done = task.status === "done";
  const overdue = !done && isOverdue(task, now);
  const taskLabels = (task.task_labels ?? [])
    .map((tl) => labels.find((l) => l.id === tl.label_id))
    .filter((l): l is Label => Boolean(l));

  const toggle = () => {
    if (!done) {
      setCompleting(true);
      onToggleDone(); // fire mutation immediately so optimistic update lands before animation ends
      window.setTimeout(() => { setCompleting(false); }, 200);
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
  const trailing = !groom && (state || durText || areaName) ? (
    <div className="flex shrink-0 items-center gap-1.5 pl-2">
      {state && (
        <span
          title={state.title}
          className={`mono text-meta ${state.signal ? "font-medium text-signal" : "text-muted"}`}
        >
          {state.text}
        </span>
      )}
      {durText && <span className="mono text-meta text-muted">{durText}</span>}
      {/* The area chip spends its hue ONCE: a wash for the ground, and the same hue
          pulled most of the way to --muted for the label. A domain-coloured label
          on a domain-coloured ground is two colour signals stacked on the row's
          quietest element, which is how a chip meant to whisper identity ends up
          dominating the surface. Named, not just tinted — colour alone fails
          because nobody memorises the palette. */}
      {areaName && (
        <span
          className="max-w-[92px] truncate rounded px-1.5 py-px text-meta"
          style={
            areaColor
              ? {
                  background: `color-mix(in srgb, ${areaColor} 9%, transparent)`,
                  color: `color-mix(in srgb, ${areaColor} 45%, var(--muted))`,
                }
              : { background: "color-mix(in srgb, var(--muted) 9%, transparent)", color: "var(--muted)" }
          }
          title={areaName}
        >
          {areaName}
        </span>
      )}
    </div>
  ) : null;

  const bg = multiSelected
    ? "bg-accent-soft"
    : selected
      ? "bg-bg"
      : "hover:bg-bg";

  // Type the grooming guess so the inbox reads as two piles, not one uniform
  // list. A project/initiative binding is a "push" — it moves a real object up
  // the vertical, so it earns presence: a colored spine + the parent as an
  // eyebrow + its weight up front. A domain/none guess is a loose task and stays
  // a compact one-liner. Only inbox rows carry a guess, so nothing else changes.
  const groomPush =
    groom != null &&
    (groom.level === "project" || groom.level === "initiative") &&
    Boolean(groom.targetLabel);
  // The push spine borrows the suggested domain color even before the task is
  // filed; loose rows fall back to the row's own accent (usually none in inbox).
  const spineColor = groomPush && groom ? (groom.domainColor ?? accent ?? null) : (accent ?? null);

  // Accept / dismiss — shared by the push weight line and the loose one-liner.
  const acceptControls = groom ? (
    <span className="ml-auto flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
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

  return (
    <div
      data-task-drag={draggable ? task.id : undefined}
      data-task-drag-group={dragGroup}
      data-task-title={task.title}
      data-task-duration={task.duration_minutes ?? ""}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      className={`fast group flex cursor-pointer select-none gap-2 border-b border-line last:border-b-0 px-3 ${
        groom ? "min-h-[52px] items-start py-2" : "h-11 items-center py-0"
      } ${completing ? "task-completing" : ""} ${bg}`}
      style={spineColor ? { boxShadow: `inset ${groomPush ? 3 : 2}px 0 0 0 ${spineColor}` } : undefined}
    >
      {/* Checkbox */}
      <button
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={`fast relative ${groom ? "mt-[2px]" : ""} flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border ${
          completing ? "bloom" : ""
        } ${done || completing ? "border-accent bg-accent text-white" : "border-line hover:border-accent"}`}
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
        {/* Push eyebrow — the parent this work moves, small-caps in its color. */}
        {groom && groomPush && (
          <div
            className="mb-[3px] flex items-center gap-1 truncate text-micro font-semibold uppercase tracking-[0.04em]"
            style={{ color: groom.domainColor ?? "var(--muted)" }}
            title={groom.rationale}
          >
            <span aria-hidden className="mono">✦</span>
            <span className="truncate">{groom.targetLabel}</span>
          </div>
        )}
        {/* Line 1 — the title, ALONE. The only thing allowed to cross it is the
            prework mark, because "prep is ready" is the one fact that acts right
            now. Everything that used to pile up here — the repeat glyph, the roll
            chip, the word "overdue", the deadline flag — moved to the gutter as a
            number. And the title keeps its ink when late: red-alert styling for a
            non-urgent state is exactly what P4 forbids. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`min-w-0 flex-1 truncate text-body ${done ? "text-muted line-through" : ""}`}>
            {task.title}
          </span>

          {task.prework_at && task.prework && !done && (
            <span className="mono shrink-0 text-micro text-accent" title="Prework ready">✦</span>
          )}
          {trailing}

          {/* Loose guess (domain / none) stays a compact one-liner: its whole
              identity + weight rides the title row, so it reads as batchable. */}
          {groom && !groomPush && (
            <>
              {groom.level === "domain" && groom.targetLabel && (
                <span
                  className="flex shrink-0 items-center gap-1 text-meta font-medium"
                  style={{ color: groom.domainColor ?? "var(--muted)" }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: groom.domainColor ?? "var(--muted)" }}
                  />
                  <span className="max-w-[90px] truncate">{groom.targetLabel}</span>
                </span>
              )}
              {groom.durationMinutes ? (
                <span className="mono shrink-0 text-meta text-muted">{fmtDuration(groom.durationMinutes)}</span>
              ) : null}
              {groom.energy && (
                <span className="shrink-0 text-meta text-muted">
                  {ENERGY_META[groom.energy].icon} {ENERGY_META[groom.energy].label}
                </span>
              )}
              {acceptControls}
            </>
          )}
        </div>

        {/* Push weight line — the deep/decide register + estimate in the parent's
            color, so the commitment reads before you accept it. */}
        {groom && groomPush && (
          <div
            className="mt-[5px] flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
            title={groom.rationale}
          >
            {(groom.energy || groom.durationMinutes) && (
              <span
                className="text-meta font-medium"
                style={{ color: groom.domainColor ?? "var(--ink)" }}
              >
                {groom.energy ? `${ENERGY_META[groom.energy].icon} ${ENERGY_META[groom.energy].label}` : ""}
                {groom.energy && groom.durationMinutes ? " · " : ""}
                {groom.durationMinutes ? fmtDuration(groom.durationMinutes) : ""}
              </span>
            )}
            {acceptControls}
          </div>
        )}
      </div>

      {action}
    </div>
  );
}
