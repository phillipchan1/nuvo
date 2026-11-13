// The checklist inside a task — one component, both shells.
//
// A task was a leaf until now (audit rank 5). What a step IS, and the fields it
// is forbidden, are explained in migration 60 and in `Task.parent_task_id`; the
// short version is that a step is not a task, so this surface offers exactly
// four acts — add, tick, rename, remove — and no scheduling of any kind.
//
// Instrument: list rows on the panel, never a bordered card. Nothing here
// floats, so nothing here is framed (P14).
//
// Keyboard, which is most of the reason a checklist is worth having. The rows
// are always-editable fields, so the list grammar (D-146) is spoken in the
// keys a field can spare — the add box is still the row after the last:
//   Enter on the composer  add the step and stay, ready for the next
//   ↑ / ↓                  walk the steps and the add box
//   Enter on a row         commit the rename, step down
//   ⌘↵ on a row            tick / untick
//   ⌥↑ / ⌥↓                move the step
//   ⌫ on an empty row      remove that step and focus the one above
//   Esc                    abandon the edit — and rest on the list, not the page
//
// Resting (the list itself focused, a cursor on one step) is the same list in
// the letters a field can't spare: j k / ↑ ↓ walk, ↵ edits, e ticks, ⌫
// removes, ⌥↑↓ moves, a adds. A second Esc falls through to the surface
// around it. Escaping a field used to drop focus on the page, where no key
// reached the checklist again without the mouse.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "../lib/types";
import type { useTaskMutations } from "../hooks/useTasks";
import { useTaskSteps } from "../hooks/useTasks";
import { byManualOrder } from "../lib/taskOrder";
import TaskComposer, { type TaskComposerHandle } from "./tasks/TaskComposer";
import { Icon } from "./Icon";
import { Checkbox, IconButton } from "./kit";

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
  keyboardEntry = false,
}: {
  task: Task;
  mutations: Mutations;
  touch?: boolean;
  /** ↓ / j with nothing focused rests on the steps — for the one surface on
   *  screen that owns the keyboard (the desktop task popover). */
  keyboardEntry?: boolean;
}) {
  const { data } = useTaskSteps(task.id);
  // A move patches rows in place; nothing re-sorts the cache but us.
  const steps = useMemo(() => byManualOrder(data ?? []), [data]);
  // Positions for lines added in one breath (a pasted list lands before the
  // steps query has seen any of them). After the last, wherever moves put it.
  const lastOrder = steps.length ? steps[steps.length - 1]!.sort_order : -1;
  const nextPos = useRef(lastOrder + 1);
  nextPos.current = Math.max(nextPos.current, lastOrder + 1);
  const add = (title: string) => {
    void mutations.addStep(task, title, nextPos.current++);
  };

  const composerRef = useRef<TaskComposerHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [resting, setResting] = useState(false);
  const rest = (i: number) => {
    setCursor(Math.max(0, Math.min(i, steps.length - 1)));
    listRef.current?.focus();
  };
  const restRef = useRef(rest);
  restRef.current = rest;
  useEffect(() => {
    if (!keyboardEntry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.activeElement !== document.body) return;
      if (e.key !== "ArrowDown" && e.key !== "j") return;
      e.preventDefault();
      restRef.current(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboardEntry]);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusAt = (i: number) => {
    const s = steps[i];
    const el = s ? inputs.current.get(s.id) : null;
    if (!el) {
      if (i >= steps.length) composerRef.current?.focus();
      return;
    }
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= steps.length) return;
    const ids = steps.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    mutations.reorder(steps, ids);
  };
  const { done, total } = stepProgress(steps);

  const onRestKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = steps[cursor];
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.metaKey || e.ctrlKey) return;
    if (e.altKey) {
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && step) {
        const by = e.key === "ArrowUp" ? -1 : 1;
        move(cursor, by);
        setCursor(Math.max(0, Math.min(cursor + by, steps.length - 1)));
        handled();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
      case "j":
        if (cursor >= steps.length - 1) composerRef.current?.focus();
        else setCursor(cursor + 1);
        return handled();
      case "ArrowUp":
      case "k":
        setCursor(Math.max(0, cursor - 1));
        return handled();
      case "Enter":
        if (step) focusAt(cursor);
        return handled();
      case "e":
      case " ":
        if (step) mutations.toggleStep(step);
        return handled();
      case "Backspace":
      case "Delete":
        if (step) {
          void mutations.removeStep(step);
          if (steps.length === 1) composerRef.current?.focus();
          else setCursor(Math.min(cursor, steps.length - 2));
        }
        return handled();
      case "a":
        composerRef.current?.focus();
        return handled();
    }
  };

  return (
    <div
      ref={listRef}
      tabIndex={-1}
      aria-label="Steps"
      onKeyDown={onRestKey}
      onFocus={(e) => setResting(e.target === e.currentTarget)}
      onBlur={(e) => {
        if (e.target === e.currentTarget) setResting(false);
      }}
      className="flex flex-col outline-none"
    >
      {total > 0 && (
        <div className="steps-progress">
          {/* The fill moves by transform (scaleX), never by width. */}
          <div className="steps-track" aria-hidden>
            <span style={{ transform: `scaleX(${done / total})` }} />
          </div>
          <span className="steps-count">
            {done}/{total}
          </span>
        </div>
      )}

      {steps.map((s, i) => (
        <StepRow
          key={s.id}
          step={s}
          touch={touch}
          current={resting && i === cursor}
          onRest={() => rest(i)}
          inputRef={(el) => {
            if (el) inputs.current.set(s.id, el);
            else inputs.current.delete(s.id);
          }}
          onFocusStep={(by) => focusAt(i + by)}
          onMove={(by) => move(i, by)}
          onToggle={() => mutations.toggleStep(s)}
          onRename={(title) => mutations.renameStep(s, title)}
          onRemove={() => void mutations.removeStep(s)}
        />
      ))}

      {/* The app's one add box, in plain mode: a step is a line of text, not a
          capture, so nothing is parsed — but Enter, Escape and paste behave
          exactly as they do on every other list. */}
      <TaskComposer
        ref={composerRef}
        plain
        onArrowUp={steps.length ? () => focusAt(steps.length - 1) : undefined}
        submitOnBlur
        placeholder={total ? "Add a step" : "Break this into steps"}
        aria-label="Add a step"
        onPlainSubmit={add}
        onLeave={steps.length ? () => rest(steps.length - 1) : undefined}
        className={touch ? "" : "-my-1"}
      />
    </div>
  );
}

function StepRow({
  step,
  touch,
  current,
  onRest,
  inputRef,
  onFocusStep,
  onMove,
  onToggle,
  onRename,
  onRemove,
}: {
  step: Task;
  /** Phone: 44px rows, a 16px field (iOS won't zoom). */
  touch: boolean;
  /** The resting cursor is on this step. */
  current: boolean;
  /** Leave the field for the list (Escape). */
  onRest: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
  /** Focus the step `by` rows away; past the last is the add box. */
  onFocusStep: (by: -1 | 1) => void;
  onMove: (by: -1 | 1) => void;
  onToggle: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(step.title);
  // A rename from another surface (or the server) lands here too.
  useEffect(() => setTitle(step.title), [step.title]);
  const done = step.status === "done";
  // Escape abandons the edit; the blur it causes must not commit it (that
  // render's `title` is still the edited text — emptied, it would delete).
  const abandoning = useRef(false);

  return (
    <div
      aria-current={current ? "true" : undefined}
      data-done={done ? "" : undefined}
      data-touch={touch ? "" : undefined}
      className="step-row group"
    >
      {/* A step is not a task: it wears the kit's SQUARE check, so a step
          inside a task never reads as the task's own round tick twice. Its
          hit area grows to 44px under a finger without the box growing. */}
      <Checkbox
        checked={done}
        onChange={onToggle}
        label={done ? `Undo ${step.title}` : `Complete ${step.title}`}
      />

      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (abandoning.current) {
            abandoning.current = false;
            return;
          }
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
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            const by = e.key === "ArrowUp" ? -1 : 1;
            e.preventDefault();
            if (e.altKey) onMove(by);
            else if (!e.metaKey && !e.ctrlKey && !e.shiftKey) onFocusStep(by);
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onToggle();
            return;
          }
          if (e.key === "Enter") {
            // Leaving the field commits the rename (onBlur).
            e.preventDefault();
            onFocusStep(1);
            return;
          }
          if (e.key === "Escape") {
            // The field owns Escape first (D-051): abandon the edit, keep the task open.
            e.stopPropagation();
            setTitle(step.title);
            abandoning.current = true;
            onRest();
          }
          if (e.key === "Backspace" && title === "") {
            // Stepping away blurs the emptied row, and blur removes it.
            e.preventDefault();
            onFocusStep(-1);
            if (document.activeElement === e.currentTarget) onRemove();
          }
        }}
        aria-label="Step"
        className="step-input"
      />

      {/* Visible on hover and on focus — a hidden gesture must never be the
          only path to an act. On a phone it stays inert until the step is
          focused (tap the title): an invisible 44px target at the row's edge
          removed steps by accident. */}
      <IconButton
        size="xs"
        className="step-remove"
        label={`Remove ${step.title}`}
        icon={<Icon name="close" size={12} />}
        onClick={onRemove}
      />
    </div>
  );
}
