import { useState } from "react";
import type { Label, Task } from "../lib/types";
import { fmtDuration, fmtTime, isOverdue, todayISO, tomorrowISO } from "../lib/dates";
import { PriorityDot, RollBadge } from "./ui";

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
}) {
  const [completing, setCompleting] = useState(false);
  const done = task.status === "done";
  const overdue = !done && isOverdue(task);
  const taskLabels = (task.task_labels ?? [])
    .map((tl) => labels.find((l) => l.id === tl.label_id))
    .filter((l): l is Label => Boolean(l));

  const toggle = () => {
    if (!done) {
      setCompleting(true);
      window.setTimeout(() => { setCompleting(false); onToggleDone(); }, 200);
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

  const hasMeta = Boolean(
    meta?.project || meta?.domain || task.duration_minutes || (dateLabel && !task.start_time) || taskLabels.length > 0,
  );

  const bg = multiSelected
    ? "bg-accent-soft"
    : selected
      ? "bg-bg"
      : "hover:bg-bg";

  return (
    <div
      data-task-drag={draggable ? task.id : undefined}
      data-task-drag-group={dragGroup}
      data-task-title={task.title}
      data-task-duration={task.duration_minutes ?? ""}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      className={`fast group flex cursor-pointer select-none items-start gap-2 border-b border-line px-3 py-2 ${
        completing ? "task-completing" : ""
      } ${bg}`}
      style={accent ? { boxShadow: `inset 2px 0 0 0 ${accent}` } : undefined}
    >
      {/* Checkbox */}
      <button
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={`fast relative mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border ${
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
        {/* Primary line */}
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`min-w-0 flex-1 truncate text-body ${
              done ? "text-muted line-through" : overdue ? "text-signal" : ""
            }`}
          >
            {task.title}
          </span>

          {task.prework_at && task.prework && !done && (
            <span className="mono shrink-0 text-micro text-accent" title="Prework ready">✦</span>
          )}
          {task.recurrence_id && (
            <svg width="9" height="9" viewBox="0 0 14 14" fill="none" className="shrink-0 text-muted" aria-label="Repeats">
              <title>Repeats</title>
              <path d="M3 5a4 4 0 016.9-2.7M11 9a4 4 0 01-6.9 2.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M10 1.5V4H7.5M4 12.5V10h2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <RollBadge count={task.roll_count} />
          {overdue && (
            <span className="mono shrink-0 text-micro font-medium text-signal">overdue</span>
          )}
          {task.deadline && !done && (
            <span className="mono shrink-0 text-micro text-signal" title={`Deadline ${task.deadline}`}>
              ⚑{task.deadline.slice(5)}
            </span>
          )}
          {task.start_time && (
            <span className="mono shrink-0 text-meta text-muted">
              {fmtTime(task.start_time)}
            </span>
          )}
        </div>

        {/* Context line */}
        {hasMeta && (
          <div className="mt-[3px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {(meta?.project || meta?.domain) && (
              <span
                className="max-w-[110px] truncate text-meta font-medium"
                style={{ color: meta?.domainColor ?? "var(--muted)" }}
              >
                {meta?.project ?? meta?.domain}
              </span>
            )}
            {task.duration_minutes ? (
              <span className="mono text-meta text-muted">{fmtDuration(task.duration_minutes)}</span>
            ) : null}
            {dateLabel && !task.start_time && (
              <span className={`mono text-meta ${dateLabel === "today" || overdue ? "text-signal" : "text-muted"}`}>
                {dateLabel}
              </span>
            )}
            {taskLabels.map((l) => (
              <span
                key={l.id}
                className="rounded-sm px-1 py-px text-micro font-medium leading-none"
                style={{ background: `color-mix(in srgb, ${l.color} 15%, var(--surface))`, color: l.color }}
              >
                {l.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {action}
    </div>
  );
}
