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

import { useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Task } from "../../lib/types";
import { useTaskMutations } from "../../hooks/useTasks";
import { TaskCaptureSinkContext } from "../../hooks/useTaskCapture";
import { useLabels } from "../../hooks/useCalendar";
import { useListReorder } from "../../hooks/useListReorder";
import { useLongPressReorder } from "../../hooks/useLongPressReorder";
import { useIsMobile } from "../../hooks/useIsMobile";
import { tomorrowISO } from "../../lib/dates";
import { announce } from "../../lib/announce";
import { shiftId } from "../../lib/taskOrder";
import type { CaptureContext } from "../../lib/captureDraft";
import TaskRow, { type TaskMeta, type TaskRowHandle } from "../TaskRow";
import TaskComposer, { type TaskComposerHandle } from "./TaskComposer";
import TaskActionsMenu from "./TaskActionsMenu";
import { TaskDateMenu, TaskMoveMenu, usePriorityAct, useRenameAct } from "./TaskMenus";
import { orderBeside, useTaskListKeys } from "./useTaskListKeys";
import type { PathDraft } from "./usePathDraft";

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
  /** A project's open draft (Draft the path, D-193): its steps are drawn among
   *  the rows, with the same row, and the list's keys hand over to the draft. */
  draft?: PathDraft | null;
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
  draft,
}: TaskListViewProps) {
  const liveMutations = useTaskMutations();
  // A harness that captures into a sink is looking, not editing: its rows'
  // acts go nowhere either (fixture ids must never reach the outbox).
  const sink = useContext(TaskCaptureSinkContext);
  const mutations = useMemo(() => (sink ? inert(liveMutations) : liveMutations), [sink, liveMutations]);
  const { labels } = useLabels();
  // A phone: no keys and no menus; rows swipe (right done, left tomorrow), a
  // hold on the grip reorders (a touch drag would fight the scroll), and a tap
  // opens the task sheet. Same row, same add box.
  const phone = useIsMobile();
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
  // While a draft is open the list draws its layout — your rows and the drafted
  // steps interleaved — and a drag orders both.
  const drafting = Boolean(draft?.items);
  const items = useMemo(
    () => draft?.items ?? tasks.map((task) => ({ kind: "task" as const, task })),
    [draft?.items, tasks],
  );
  const ids = useMemo(() => items.map((i) => i.task.id), [items]);

  const rowEl = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-list-row="${CSS.escape(id)}"]`) ?? null;
  const rowRect = (id: string) => rowEl(id)?.getBoundingClientRect() ?? new DOMRect(360, 200, 0, 40);

  const reorderTo = (next: string[]) => (drafting && draft ? draft.reorder(next) : mutations.reorder(tasks, next));
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
    disabled: phone || (!reorderable && !dropZones),
  });
  const hold = useLongPressReorder({
    containerRef: listRef,
    itemSelector: "[data-list-row]",
    idAttr: "data-list-row",
    ids: () => ids,
    onCommit: (next) => reorderTo(next),
    disabled: !phone || !reorderable,
  });

  // The draft's keys (↵ keep, ⌫ drop, ⇥ version…) replace the list's while it's open.
  draft?.setKeys(keyboard && !phone && !menu);

  // The rows make room as each drafted step lands — FLIP, transform only, and
  // only while a draft is open (it reads every row's box, once per change).
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!drafting) {
      tops.current.clear();
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    el.querySelectorAll<HTMLElement>("[data-list-row]").forEach((row) => {
      const id = row.dataset.listRow as string;
      const top = row.getBoundingClientRect().top;
      next.set(id, top);
      const was = tops.current.get(id);
      if (reduce) return;
      if (was == null) {
        if (tops.current.size) row.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
      } else if (Math.abs(was - top) > 1) {
        row.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
    tops.current = next;
  }, [drafting, ids]);

  useTaskListKeys({
    enabled: keyboard && !phone && !menu && !editingId && !drafting,
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
      toComposer: () => composer.current?.focus(),
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
        {hold.lineTop != null && <div className="reorder-insert-line" style={{ top: hold.lineTop }} aria-hidden />}
        {items.map((item) => {
          const t = item.task;
          if (item.kind === "draft" && draft) {
            const k = item.step.key;
            return (
              <div key={t.id} role="listitem" data-list-row={t.id}>
                <TaskRow
                  task={t}
                  labels={labels}
                  selected={draft.cursor === k}
                  draggable={false}
                  dragging={draggingId === t.id || hold.draggingId === t.id}
                  action={
                    phone && reorderable ? (
                      <span
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          hold.press(e, t.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Press and hold to move"
                        className="task-list-grip tap-icon"
                        data-arming={hold.armingId === t.id ? "" : undefined}
                      >
                        ⠿
                      </span>
                    ) : undefined
                  }
                  swipeActions={phone ? { onDefer: () => draft.drop(k) } : undefined}
                  flush={flush}
                  editing={draft.editing === k}
                  onRename={(title) => draft.rename(k, title)}
                  onSelect={() => draft.setCursor(k)}
                  onOpen={() => draft.setCursor(k)}
                  onToggleDone={() => draft.keep(k)}
                  draft={{
                    open: draft.cursor === k && draft.phase === "review",
                    why: item.step.why,
                    evidence: item.step.evidence.text,
                    version: item.step.versions.length > 1 ? { at: item.step.version + 1, of: item.step.versions.length } : null,
                    keys: !phone,
                    onKeep: () => draft.keep(k),
                    onDrop: () => draft.drop(k),
                    onVersion: () => draft.version(k, 1),
                    onEdit: () => draft.setEditing(k),
                  }}
                />
              </div>
            );
          }
          return (
          <div key={t.id} role="listitem" data-list-row={t.id} data-landed={draft?.landed.has(t.id) ? "" : undefined}>
            <TaskRow
              ref={(h) => {
                if (h) handles.current.set(t.id, h);
                else handles.current.delete(t.id);
              }}
              task={t}
              labels={labels}
              selected={!phone && t.id === cursorId}
              multiSelected={selectedIds.has(t.id)}
              draggable={Boolean(dragData)}
              dragData={dragData?.(t)}
              dragging={draggingId === t.id || hold.draggingId === t.id}
              accent={accentFor?.(t) ?? null}
              meta={metaFor?.(t)}
              action={
                phone && reorderable && tasks.length > 1 ? (
                  <>
                    {rowAction?.(t)}
                    <span
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        hold.press(e, t.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Press and hold to reorder"
                      className="task-list-grip tap-icon"
                      data-arming={hold.armingId === t.id ? "" : undefined}
                    >
                      ⠿
                    </span>
                  </>
                ) : (
                  rowAction?.(t)
                )
              }
              swipeActions={phone ? { onDefer: () => mutations.planFor(t, tomorrowISO(), { undo: "toast" }) } : undefined}
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
                if (phone || e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                setCursorId(t.id);
                setMenu({ kind: "actions", task: t, x: e.clientX, y: e.clientY });
              }}
            />
          </div>
          );
        })}
        {items.length === 0 && emptyHint && <div className="task-list-empty">{emptyHint}</div>}
      </div>

      <TaskComposer
        ref={composer}
        // The add box sits on the rows' own left edge — flush rows, flush box.
        className={flush ? "task-composer-flush" : ""}
        context={context}
        contextLabel={contextLabel}
        placeholder={composerPlaceholder}
        autoFocus={composerAutoFocus && !phone}
        submitOnBlur={phone}
        onLeave={() => listRef.current?.focus()}
        onArrowUp={(placedAfter) => {
          // Back to the row the box sat beside, else the last row.
          const beside = placedAfter == null ? null : [...tasks].reverse().find((t) => t.sort_order <= placedAfter);
          setCursorId((beside ?? tasks[tasks.length - 1])?.id ?? null);
          listRef.current?.focus();
        }}
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

/** The same shape, every act a no-op. */
function inert<T extends object>(real: T): T {
  return new Proxy(real, {
    get: (target, key) => {
      const v = (target as Record<string | symbol, unknown>)[key];
      return typeof v === "function" ? () => undefined : v;
    },
  });
}
