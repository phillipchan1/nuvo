/**
 * TaskListView — a task list that isn't the rail: a record's work, a slot's
 * children. The rail keeps its own sections and tabs, but it is built from the
 * same three parts, and so is this:
 *
 *   · the row       — `TaskRow` (D-111: one grammar per noun)
 *   · the keys      — `useTaskListKeys` (one grammar per list)
 *   · the add box   — `TaskComposer` (one grammar per capture)
 *
 * plus the shared drag (`useListReorder`) and the shared row menus. The host
 * only says what the list is (`context`) and how a task opens (`onOpen`).
 */

import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Task } from "../../lib/types";
import { useTaskMutations } from "../../hooks/useTasks";
import { useLabels } from "../../hooks/useCalendar";
import { useListReorder } from "../../hooks/useListReorder";
import { announce } from "../../lib/announce";
import { shiftId } from "../../lib/taskOrder";
import type { CaptureContext } from "../../lib/captureDraft";
import TaskRow, { type TaskMeta, type TaskRowHandle } from "../TaskRow";
import TaskComposer, { type TaskComposerHandle } from "./TaskComposer";
import TaskActionsMenu from "./TaskActionsMenu";
import { TaskDateMenu, TaskMoveMenu, usePriorityAct, useRenameAct } from "./TaskMenus";
import { orderBeside, useTaskListKeys } from "./useTaskListKeys";

export interface TaskListViewProps {
  /** In display order. */
  tasks: Task[];
  /** Where the list is — the add box files into it. */
  context: CaptureContext;
  contextLabel?: { name: string; color?: string | null } | null;
  /** The list's keys are live. A host passes false while something else owns the screen. */
  keyboard: boolean;
  onOpen: (t: Task, anchor: DOMRect, el: HTMLElement | null) => void;
  /** A row's place tag. Omit where the surface already says it (a record). */
  metaFor?: (t: Task) => TaskMeta | undefined;
  accentFor?: (t: Task) => string | null;
  /** A trailing control on each row (a key-result chip). */
  rowAction?: (t: Task) => ReactNode;
  /** Rows the user orders by hand. False for lists sorted by something else. */
  reorderable?: boolean;
  /** Drag a row out of the list — the slot's rail / calendar drops. */
  dropZones?: {
    at: (x: number, y: number, id: string) => string | null;
    drop: (zone: string, t: Task) => void;
    label: (zone: string, t: Task) => string;
  };
  composerRef?: RefObject<TaskComposerHandle>;
  composerPlaceholder?: string;
  composerAutoFocus?: boolean;
  /** The checkbox sits on the host's left edge. */
  flush?: boolean;
  /** The surface already says when these happen (a slot) — rows don't repeat it. */
  whenShown?: boolean;
  emptyHint?: ReactNode;
  className?: string;
  /** Extra data-* on each row's root (the slot's calendar drag reads them). */
  dragData?: (t: Task) => Record<string, string> | undefined;
}

export default function TaskListView({
  tasks,
  context,
  contextLabel,
  keyboard,
  onOpen,
  metaFor,
  accentFor,
  rowAction,
  reorderable = true,
  dropZones,
  composerRef,
  composerPlaceholder = "Add a task…",
  composerAutoFocus,
  flush,
  whenShown,
  emptyHint,
  className = "",
  dragData,
}: TaskListViewProps) {
  const mutations = useTaskMutations();
  const { labels } = useLabels();
  const setPriority = usePriorityAct(mutations);
  const renameTask = useRenameAct(mutations);

  const [cursorId, setCursorId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<
    | { kind: "date" | "move"; targets: Task[]; anchor: DOMRect }
    | { kind: "actions"; task: Task; x: number; y: number }
    | null
  >(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const innerComposer = useRef<TaskComposerHandle>(null);
  const composer = composerRef ?? innerComposer;
  const handles = useRef(new Map<string, TaskRowHandle>());
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const ids = useMemo(() => tasks.map((t) => t.id), [tasks]);

  const rowEl = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-list-row="${CSS.escape(id)}"]`) ?? null;
  const rowRect = (id: string) => rowEl(id)?.getBoundingClientRect() ?? new DOMRect(360, 200, 0, 40);

  const reorderTo = (next: string[]) => mutations.reorder(tasks, next);
  // The click that ends a drag lands on the row it started on; it isn't an open.
  const lastDrag = useRef(0);
  const open = (t: Task) => {
    if (Date.now() - lastDrag.current < 300) return;
    onOpen(t, rowRect(t.id), rowEl(t.id));
  };

  const { draggingId } = useListReorder({
    containerRef: listRef,
    itemSelector: "[data-list-row]",
    idAttr: "data-list-row",
    bandOf: () => (reorderable ? "list" : null),
    bandIds: () => ids,
    onCommit: (_band, next) => reorderTo(next),
    externalDropAt: dropZones ? (x, y, id) => dropZones.at(x, y, id) : undefined,
    onExternalDrop: dropZones
      ? (zone, id) => {
          const t = byId.get(id);
          if (t) dropZones.drop(zone, t);
        }
      : undefined,
    zoneLabel: dropZones
      ? (zone, id) => {
          const t = byId.get(id);
          return t ? dropZones.label(zone, t) : "";
        }
      : undefined,
    onDragEnd: () => {
      lastDrag.current = Date.now();
    },
    disabled: !reorderable && !dropZones,
  });

  useTaskListKeys({
    enabled: keyboard && !menu && !editingId,
    rows: tasks,
    cursor: { cursorId, setCursorId, selectedIds, setSelectedIds },
    acts: {
      open: (t) => onOpen(t, rowRect(t.id), rowEl(t.id)),
      complete: (targets) =>
        targets.forEach((t) => {
          if (t.status === "done") return mutations.uncomplete(t, { undo: "toast" });
          const h = handles.current.get(t.id);
          if (h) h.triggerToggle();
          else mutations.complete(t, { undo: "toast" });
        }),
      trash: (targets) => targets.forEach((t) => mutations.trash(t, { undo: "toast" })),
      date: (targets) => setMenu({ kind: "date", targets, anchor: rowRect(targets[0].id) }),
      move: (targets) => setMenu({ kind: "move", targets, anchor: rowRect(targets[0].id) }),
      priority: setPriority,
      rename: (t) => setEditingId(t.id),
      reorderBy: reorderable
        ? (t, delta) => {
            const next = shiftId(ids, t.id, delta);
            if (next) reorderTo(next);
            const at = (next ?? ids).indexOf(t.id);
            announce(next ? `${t.title}, position ${at + 1} of ${ids.length}` : "Can't move this row any further");
          }
        : undefined,
      add: (anchor, where) => {
        const sortOrder = anchor ? orderBeside(tasks, anchor, where) : undefined;
        composer.current?.focus(
          anchor && sortOrder != null ? { sortOrder, label: `${where} “${anchor.title}”` } : undefined,
        );
      },
    },
  });

  const rangeTo = (id: string) => {
    const from = anchorId ? ids.indexOf(anchorId) : -1;
    const to = ids.indexOf(id);
    if (from < 0 || to < 0) return setSelectedIds(new Set([id]));
    const [a, b] = from < to ? [from, to] : [to, from];
    setSelectedIds(new Set(ids.slice(a, b + 1)));
  };

  return (
    <div className={className}>
      <div ref={listRef} className="relative outline-none" role="list" tabIndex={-1}>
        {tasks.map((t) => (
          <div key={t.id} role="listitem" data-list-row={t.id}>
            <TaskRow
              ref={(h) => {
                if (h) handles.current.set(t.id, h);
                else handles.current.delete(t.id);
              }}
              task={t}
              labels={labels}
              selected={t.id === cursorId}
              multiSelected={selectedIds.has(t.id)}
              draggable={Boolean(dragData)}
              dragData={dragData?.(t)}
              dragging={draggingId === t.id}
              accent={accentFor?.(t) ?? null}
              meta={metaFor?.(t)}
              action={rowAction?.(t)}
              flush={flush}
              whenShown={whenShown}
              editing={editingId === t.id}
              onRename={(title) => {
                setEditingId(null);
                if (title) renameTask(t, title);
              }}
              onSelect={() => {
                setCursorId(t.id);
                setAnchorId(t.id);
                setSelectedIds(new Set());
              }}
              onOpen={() => open(t)}
              onToggleDone={() =>
                t.status === "done" ? mutations.uncomplete(t, { undo: "toast" }) : mutations.complete(t, { undo: "toast" })
              }
              onMultiToggle={() => {
                const next = new Set(selectedIds);
                if (next.has(t.id)) next.delete(t.id);
                else next.add(t.id);
                setSelectedIds(next);
                setAnchorId(t.id);
              }}
              onRangeSelect={() => rangeTo(t.id)}
              onContextMenu={(e) => {
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                setCursorId(t.id);
                setMenu({ kind: "actions", task: t, x: e.clientX, y: e.clientY });
              }}
            />
          </div>
        ))}
        {tasks.length === 0 && emptyHint && <div className="py-2 text-caption italic text-muted">{emptyHint}</div>}
      </div>

      <TaskComposer
        ref={composer}
        context={context}
        contextLabel={contextLabel}
        placeholder={composerPlaceholder}
        autoFocus={composerAutoFocus}
        onLeave={() => listRef.current?.focus()}
      />

      {menu?.kind === "date" && (
        <TaskDateMenu anchor={menu.anchor} targets={menu.targets} mutations={mutations} onClose={() => setMenu(null)} />
      )}
      {menu?.kind === "move" && (
        <TaskMoveMenu anchor={menu.anchor} targets={menu.targets} mutations={mutations} onClose={() => setMenu(null)} />
      )}
      {menu?.kind === "actions" && (
        <TaskActionsMenu
          task={menu.task}
          x={menu.x}
          y={menu.y}
          mutations={mutations}
          onOpen={() => {
            onOpen(menu.task, rowRect(menu.task.id), rowEl(menu.task.id));
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
          onDate={() => setMenu({ kind: "date", targets: [menu.task], anchor: rowRect(menu.task.id) })}
          onMove={() => setMenu({ kind: "move", targets: [menu.task], anchor: rowRect(menu.task.id) })}
          onRename={() => setEditingId(menu.task.id)}
        />
      )}
    </div>
  );
}
