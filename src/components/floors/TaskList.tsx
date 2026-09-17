// A record's task list — a project's work, the loose tasks under a bet or a
// domain. It is the app's one task list (`tasks/TaskListView`): the real
// `TaskRow`, the shared keys, the shared add box. What's left here is only what
// a record adds: its one left edge, and the Groom pass.
//
// ── `spine` — the record's layout ────────────────────────────────────────────
// The record modal hangs every control in one 26px gutter so the section label,
// every task title and the composer share ONE left edge. Without it the label,
// the composer's box padding and the checkbox each started at a different x, and
// three ragged left edges is most of what "disjointed" was. Rows are `flush`, and
// the add box's ＋ sits where the checkboxes do.
//
// The add box waits at the foot and takes the caret only while the list is
// empty (scaffolding a new project). `a` reaches it from any row, `t` from
// anywhere in the record when no row is under the cursor.

import { useMemo, useState, type RefObject } from "react";
import { format } from "date-fns";
import { useVertical, type TaskParent } from "../../hooks/useVertical";
import { useAllTasks } from "../../hooks/useTasks";
import type { VTask } from "../../lib/vertical";
import type { Task } from "../../lib/types";
import TaskRefine from "./TaskRefine";
import TaskListView from "../tasks/TaskListView";
import type { TaskComposerHandle } from "../tasks/TaskComposer";

export type { TaskParent };

/** When a task actually happens, said in as few characters as it takes.
 *
 *  The record used to be silent about time: you could look at a project's whole
 *  list and not learn which piece had a block on Thursday. Answering it is the
 *  point of `docs/` calling a scheduled task a time block — the block is the
 *  plan, so a project that can't show its blocks can't show its plan.
 *
 *  Three states, three different commitments, never flattened into one:
 *    · a real block  → "Thu 9:00am"
 *    · in a sitting  → "Thu · in a sitting" (the slot holds the clock, not the task)
 *    · a day, no block → "Thu" — planned for that day, not blocked on it
 *
 *  Returns null when there is no time at all. Backlog work is *deliberately*
 *  undated (glossary), so stamping "no time" on every row would dress a decision
 *  up as a debt — P4, and P9's quiet-by-default. Silence is the honest render. */
export function whenText(t: VTask): string | null {
  if (t.startTime) {
    const d = new Date(t.startTime);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "pm" : "am";
    const hh = ((h + 11) % 12) + 1;
    return `${format(d, "EEE")} ${m === 0 ? `${hh}${ampm}` : `${hh}:${String(m).padStart(2, "0")}${ampm}`}`;
  }
  if (!t.doDate) return null;
  const day = format(new Date(`${t.doDate}T00:00:00`), "EEE");
  return t.slotId ? `${day} · in a sitting` : day;
}

/** Moved to `lib/a11y.ts` — the gate belongs with the other keyboard rules, not
 *  in a list component that half the app imports it from. Re-exported so the
 *  existing call sites keep their import. */
export { isTypingIn } from "../../lib/a11y";

export default function TaskList({
  tasks,
  parent,
  accent,
  emptyHint = "No tasks yet.",
  spine = false,
  keyboardNav = false,
  composerRef,
  refining: refiningProp,
  onRefining,
  onOpenTask,
}: {
  tasks: VTask[];
  parent: TaskParent;
  accent: string;
  emptyHint?: string;
  /** The record's one-left-edge layout (see the note above). */
  spine?: boolean;
  /** The shared list keys are live (the record owns the screen). */
  keyboardNav?: boolean;
  /** So the record's `t` can put the caret in the add box from anywhere. */
  composerRef?: RefObject<TaskComposerHandle>;
  /** Lift the Groom pass into the surface's own action cluster. When these are
   *  passed the list drops its inline button and obeys the parent. */
  refining?: boolean;
  onRefining?: (v: boolean) => void;
  /** ↵ / a click — the host opens the task's popover over the record. */
  onOpenTask?: (t: Task, anchor: DOMRect, el: HTMLElement | null) => void;
}) {
  const { data } = useVertical();
  const { data: allTasks } = useAllTasks();
  const [refiningLocal, setRefiningLocal] = useState(false);

  // The record reads the vertical's VTasks; the row needs the task itself. The
  // unfiltered pool is the same cache the vertical is built from.
  const rows = useMemo(() => {
    const byId = new Map((allTasks ?? []).map((t) => [t.id, t]));
    return tasks.map((v) => byId.get(v.id)).filter((t): t is Task => Boolean(t));
  }, [tasks, allTasks]);

  const contextLabel = useMemo(() => {
    const p = parent.projectId ? data.projects.find((x) => x.id === parent.projectId) : null;
    const i = !p && parent.initiativeId ? data.initiatives.find((x) => x.id === parent.initiativeId) : null;
    const d = data.domains.find((x) => x.id === (p?.domainId ?? i?.domainId ?? parent.domainId));
    const name = p?.name ?? i?.name ?? d?.name;
    return name ? { name, color: d?.color ?? null } : null;
  }, [data.projects, data.initiatives, data.domains, parent.projectId, parent.initiativeId, parent.domainId]);

  const controlled = refiningProp != null;
  const refining = controlled ? refiningProp : refiningLocal;
  const setRefining = (v: boolean) => (controlled ? onRefining?.(v) : setRefiningLocal(v));

  // The Groom pass. When the surface owns the trigger (the record's ✦), only the
  // diff renders here.
  const groom = parent.projectId ? (
    refining ? (
      <div className="mt-2">
        <TaskRefine
          projectId={parent.projectId}
          parent={parent}
          tasks={tasks}
          accent={accent}
          onClose={() => setRefining(false)}
        />
      </div>
    ) : controlled ? null : (
      <div className="mt-2">
        <button
          onClick={() => setRefining(true)}
          className="fast inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-meta text-muted hover:border-line-strong hover:text-ink"
          title="Let Nuvo tighten wording, add missing steps, and suggest an order"
        >
          <span style={{ color: accent }}>✦</span> Groom with Nuvo
        </button>
      </div>
    )
  ) : null;

  return (
    <div>
      <TaskListView
        tasks={rows}
        context={parent}
        contextLabel={contextLabel}
        keyboard={keyboardNav}
        onOpen={(t, rect, el) => onOpenTask?.(t, rect, el)}
        flush={spine}
        composerRef={composerRef}
        composerPlaceholder={spine ? "Add a task…" : "Add a task… ↵ to add another, or paste a list"}
        composerAutoFocus={spine && rows.length === 0}
        emptyHint={spine ? null : emptyHint}
      />
      {groom}
    </div>
  );
}
