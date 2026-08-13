// The checklist inside a task — one component, both shells.
//
// A task was a leaf until now (audit rank 5). What a step IS, and the fields it
// is forbidden, are explained in migration 60 and in `Task.parent_task_id`; the
// short version is that a step is not a task, so this surface offers exactly
// four acts — add, tick, rename, remove — and no scheduling of any kind.
//
// Warm Paper: hairline rows on the paper, never a bordered card. Nothing here
// floats, so nothing here is framed (P14).
//
// Keyboard, which is most of the reason a checklist is worth having:
//   Enter on the composer  add the step and stay, ready for the next
//   Enter on a row         commit the rename
//   ⌫ on an empty row      remove that step and focus the one above
//   Esc                    abandon the edit

import { useRef, useState } from "react";
import type { Task } from "../lib/types";
import type { useTaskMutations } from "../hooks/useTasks";
import { useTaskSteps } from "../hooks/useTasks";

type Mutations = ReturnType<typeof useTaskMutations>;

/** n of m done — the one number a checklist owes its parent. */
export function stepProgress(steps: Task[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.status === "done").length, total: steps.length };
}

export default function TaskSteps({
  task,
  mutations,
  /** Phone: bigger rows and a 44px composer. */
  touch = false,
}: {
  task: Task;
  mutations: Mutations;
  touch?: boolean;
}) {
  const { data: steps = [] } = useTaskSteps(task.id);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLInputElement>(null);

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    await mutations.addStep(task, title, steps.length);
    // Stay in the composer: a checklist is written in one breath, and making
    // the user re-click between lines is what makes people give up on them.
    composerRef.current?.focus();
  };

  const rowH = touch ? "tap-h" : "min-h-[26px]";
  const { done, total } = stepProgress(steps);

  return (
    <div className="flex flex-col">
      {total > 0 && (
        <div className="mb-1 flex items-center gap-2">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${Math.round((done / total) * 100)}%` }}
            />
          </div>
          <span className="mono shrink-0 text-micro text-muted/75">
            {done}/{total}
          </span>
        </div>
      )}

      {steps.map((s) => (
        <StepRow
          key={s.id}
          step={s}
          rowH={rowH}
          onToggle={() => mutations.toggleStep(s)}
          onRename={(title) => mutations.renameStep(s, title)}
          onRemove={() => void mutations.removeStep(s)}
        />
      ))}

      <div className={`flex items-center gap-2 ${rowH}`}>
        <span className="h-3.5 w-3.5 shrink-0 rounded-[4px] border border-dashed border-line-strong" aria-hidden />
        <input
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              void add();
            }
            if (e.key === "Escape") setDraft("");
          }}
          onBlur={() => void add()}
          placeholder={total ? "Add a step" : "Break this into steps"}
          aria-label="Add a step"
          className="fast min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-body text-ink outline-none placeholder:text-muted/55 hover:border-line hover:bg-bg focus:border-line-strong focus:bg-bg"
        />
      </div>
    </div>
  );
}

function StepRow({
  step,
  rowH,
  onToggle,
  onRename,
  onRemove,
}: {
  step: Task;
  rowH: string;
  onToggle: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(step.title);
  const done = step.status === "done";

  return (
    <div className={`group flex items-center gap-2 border-b border-line/60 last:border-b-0 ${rowH}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Undo ${step.title}` : `Complete ${step.title}`}
        onClick={onToggle}
        className={`fast grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border ${
          done ? "border-accent bg-accent text-on-accent" : "border-line-strong hover:border-accent"
        }`}
      >
        {done && (
          <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden>
            <path d="M1.5 5.2 3.9 7.5 8.5 2.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          const next = title.trim();
          if (!next) {
            // An emptied step is a removed step — the same gesture every
            // checklist in the world uses, so it needs no second control.
            onRemove();
            return;
          }
          if (next !== step.title) onRename(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setTitle(step.title);
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === "Backspace" && title === "") {
            e.preventDefault();
            onRemove();
          }
        }}
        aria-label="Step"
        className={`fast min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-body outline-none hover:border-line hover:bg-bg focus:border-line-strong focus:bg-bg ${
          done ? "text-muted line-through" : "text-ink"
        }`}
      />

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${step.title}`}
        // Visible on focus as well as hover — a hidden gesture must never be
        // the only path to an act.
        className="fast tap shrink-0 rounded px-1 text-label text-muted opacity-0 hover:text-signal focus-visible:opacity-100 group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
