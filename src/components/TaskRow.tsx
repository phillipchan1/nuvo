import { useState } from "react";
import type { Label, Task } from "../lib/types";
import { fmtDuration, fmtTime, isOverdue } from "../lib/dates";
import { PriorityDot, RollBadge } from "./ui";

export default function TaskRow({
  task,
  labels,
  selected,
  draggable,
  onSelect,
  onOpen,
  onToggleDone,
  accent,
  action,
}: {
  task: Task;
  labels: Label[];
  selected: boolean;
  draggable: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onToggleDone: () => void;
  /** Domain color — the task's thread back up the vertical. */
  accent?: string | null;
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
      window.setTimeout(() => {
        setCompleting(false);
        onToggleDone();
      }, 160);
    } else {
      onToggleDone();
    }
  };

  return (
    <div
      data-task-drag={draggable ? task.id : undefined}
      data-task-title={task.title}
      data-task-duration={task.duration_minutes ?? ""}
      onMouseDown={onSelect}
      onClick={onOpen}
      className={`fast group flex cursor-pointer items-center gap-2 border-b border-line px-3 py-2 ${
        completing ? "task-completing" : ""
      } ${selected ? "bg-accent-soft" : "hover:bg-bg"}`}
      style={accent ? { boxShadow: `inset 2px 0 0 0 ${accent}` } : undefined}
    >
      <button
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className={`fast flex h-[15px] w-[15px] shrink-0 items-center justify-center border ${
          done ? "border-accent bg-accent text-white" : "border-line hover:border-accent"
        }`}
      >
        {done && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )}
      </button>

      <PriorityDot priority={task.priority} />

      <span
        className={`min-w-0 flex-1 truncate text-[13px] ${
          done ? "text-muted line-through" : overdue ? "text-signal" : ""
        }`}
      >
        {task.title}
      </span>

      {taskLabels.map((l) => (
        <span
          key={l.id}
          className="shrink-0 border px-1 py-px text-[10px] leading-none"
          style={{ borderColor: l.color, color: l.color }}
        >
          {l.name}
        </span>
      ))}

      <RollBadge count={task.roll_count} />

      {overdue && (
        <span className="mono shrink-0 text-[10px] font-medium text-signal">overdue</span>
      )}

      {task.deadline && !done && (
        <span className="mono shrink-0 text-[10px] text-signal" title={`Deadline ${task.deadline}`}>
          ⚑{task.deadline.slice(5)}
        </span>
      )}

      {task.start_time ? (
        <span className="mono shrink-0 text-[11px] text-muted">
          {fmtTime(task.start_time)}·{fmtDuration(task.duration_minutes)}
        </span>
      ) : task.duration_minutes ? (
        <span className="mono shrink-0 text-[11px] text-muted">{fmtDuration(task.duration_minutes)}</span>
      ) : null}

      {action}
    </div>
  );
}
