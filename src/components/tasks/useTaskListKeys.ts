/**
 * One keyboard grammar for every task list — the rail, a record's list, a slot.
 *
 *   j k ↑ ↓    move the cursor           ↵       open the task
 *   e          complete / reopen          ⌘E      rename in place
 *   t          when… (a day, a time)      v       move to… (a home, out of a slot)
 *   1 2 3 4    priority high … none       x       select (then any act hits all)
 *   ⌫          trash, with undo           ⌥↑ ⌥↓   reorder
 *   a / ⇧A     add below / above          esc     clear the selection, then the cursor
 *   .          the row's menu             ⌘D      duplicate
 *
 * Bare s / w / d / m are the Schedule's, and ⌘↑/⌘↓ travel the ladder (D-051),
 * which is why reorder sits on ⌥. A host adds its own keys through `extra`
 * (the rail's triage letters, its filter, its trash face) and those run first.
 *
 * The rows needn't be tasks. The calendar grid speaks the same grammar over its
 * blocks — tasks, events and slots in time order (D-158) — so the hook is
 * generic over anything with an id; `status` is only read to know whether `e`
 * is finishing a row (and so should step past it).
 *
 * The listener is on window (capture phase), gated by `enabled`: a surface
 * that owns the screen passes false to the lists behind it. Every key it
 * handles is `preventDefault`ed; app-wide letter bindings check for that.
 */

import { useEffect, useRef } from "react";
import { isTypingIn } from "../../lib/a11y";
import type { Task } from "../../lib/types";

/** What a list's rows must have: an id, and — when `e` can finish one — a status. */
export type KeyRow = { id: string; status?: string | null };

export interface TaskListKeyActs<T extends KeyRow = Task> {
  open: (t: T) => void;
  /** Complete (or reopen) — the host runs the row's own animation. */
  complete: (targets: T[]) => void;
  trash: (targets: T[]) => void;
  date: (targets: T[]) => void;
  move: (targets: T[]) => void;
  priority: (targets: T[], p: Task["priority"]) => void;
  rename: (t: T) => void;
  /** Move a row one place (⌥↑ -1, ⌥↓ +1). Absent when the list's order isn't
   *  the user's to set. */
  reorderBy?: (t: T, delta: 1 | -1) => void;
  /** Focus the list's add box, placing the new task beside `anchor`. */
  add?: (anchor: T | null, where: "below" | "above") => void;
  /** ↓ past the last row — into the list's add box. */
  toComposer?: () => void;
  /** `.` — the row's own menu (the one right-click opens), so no act is
   *  reachable only by a mouse. */
  menu?: (t: T) => void;
  /** ⌘D — copy the targets. The host decides where the cursor lands. */
  duplicate?: (targets: T[]) => void;
  /** Host keys, tried first. Return true when handled. */
  extra?: (e: KeyboardEvent, targets: T[]) => boolean;
}

export interface TaskListCursor {
  /** The row keys act on. Must be a row the user can SEE is lit — a host that
   *  remembers an unlit row (a click that only opened its popover) passes it as
   *  `homeId` instead, or ⌫ trashes something nobody pointed at. */
  cursorId: string | null;
  /** Where j / k start when no cursor is lit: the first press lights this row
   *  rather than jumping to the top. Never an act target. */
  homeId?: string | null;
  setCursorId: (id: string | null) => void;
  selectedIds: ReadonlySet<string>;
  setSelectedIds: (ids: Set<string>) => void;
}

const PRIORITY_KEYS: Record<string, Task["priority"]> = { "1": "high", "2": "medium", "3": "low", "4": "none" };

export function useTaskListKeys<T extends KeyRow = Task>({
  enabled,
  rows,
  cursor,
  acts,
  handOff = true,
}: {
  /** A boolean, or a question asked at keystroke time — for a gate that changes
   *  without re-rendering the host (which pane was pressed last, `keyOwner`). */
  enabled: boolean | (() => boolean);
  /** The list in display order. */
  rows: T[];
  cursor: TaskListCursor;
  acts: TaskListKeyActs<T>;
  /** Hand the cursor to the next row when its row leaves the list. The grid
   *  says no: a block leaves its rows when you page away from it, and the
   *  cursor jumping to a stranger in another week is not "the next row". */
  handOff?: boolean;
}) {
  // Read fresh on every keystroke without re-subscribing per render.
  const live = useRef({ rows, cursor, acts, enabled });
  live.current = { rows, cursor, acts, enabled };
  const isOn = () => {
    const on = live.current.enabled;
    return typeof on === "function" ? on() : on;
  };

  // A row that leaves under the cursor (done, dated away, trashed) hands the
  // cursor to whatever took its place, so the next key still has a target.
  const lastIndex = useRef(-1);
  const idx = cursor.cursorId ? rows.findIndex((t) => t.id === cursor.cursorId) : -1;
  if (idx >= 0) lastIndex.current = idx;
  useEffect(() => {
    if (!handOff || !isOn() || !cursor.cursorId || idx >= 0) return;
    const fallback = rows[Math.min(lastIndex.current, rows.length - 1)];
    cursor.setCursorId(fallback?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idx, rows, cursor, handOff]);

  // Subscribed ONCE, for the list's lifetime. Re-subscribing when `enabled`
  // flips (a popover opening and closing) moved this listener behind the
  // surface around it, so that surface's Escape ran first and closed the whole
  // record on the press that should only have cleared the cursor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isOn()) return;
      if (e.defaultPrevented || isTypingIn(e.target)) return;
      // A floating surface owns the keys while it's up — a block's menu on the
      // calendar, a row menu, a task popover inside a record. `enabled` only
      // knows about the host's own overlays, so ↑↓ in a calendar menu used to
      // walk the rail's cursor behind it, and ⌫ hit both.
      if (document.querySelector("[data-nested-surface]")) return;
      const { rows, cursor, acts } = live.current;
      const at = cursor.cursorId ? rows.findIndex((t) => t.id === cursor.cursorId) : -1;
      const current = at >= 0 ? rows[at] : null;
      const selection = rows.filter((t) => cursor.selectedIds.has(t.id));
      const targets = selection.length ? selection : current ? [current] : [];

      if (acts.extra?.(e, targets)) {
        // Handled keys are marked, so the app-wide letters (P / I, the 1–3 tabs)
        // stand aside for a key a list already spent.
        e.preventDefault();
        return;
      }

      const go = (by: number) => {
        if (!rows.length) return;
        const home = at < 0 && cursor.homeId ? rows.findIndex((t) => t.id === cursor.homeId) : -1;
        const next =
          at >= 0
            ? rows[Math.max(0, Math.min(rows.length - 1, at + by))]
            : home >= 0
              ? rows[home]
              : rows[0];
        cursor.setCursorId(next.id);
      };
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      // ⌥↑ ⌥↓ — reorder the cursor row.
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (!acts.reorderBy || !current) return;
        acts.reorderBy(current, e.key === "ArrowDown" ? 1 : -1);
        return handled();
      }
      // ⌘E — rename in place.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "e") {
        if (!current) return;
        acts.rename(current);
        return handled();
      }
      // ⌘D — duplicate (the browser's bookmark is not what a list means by it).
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
        if (!acts.duplicate || !targets.length) return;
        acts.duplicate(targets);
        return handled();
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          // Off the end of the list is the add box, Todoist-style.
          if (acts.toComposer && (rows.length === 0 || at === rows.length - 1)) {
            cursor.setCursorId(null);
            acts.toComposer();
            return handled();
          }
          go(1);
          return handled();
        case "k":
        case "ArrowUp":
          go(-1);
          return handled();
        case "Enter":
          if (!current) return;
          acts.open(current);
          return handled();
        case ".":
          if (!acts.menu || !current) return;
          acts.menu(current);
          return handled();
        case "e": {
          if (!targets.length) return;
          const advancing = targets.length === 1 && targets[0].status !== "done";
          acts.complete(targets);
          if (selection.length) cursor.setSelectedIds(new Set());
          // Holding e walks down the list: each row finishes behind you.
          else if (advancing && at >= 0 && at < rows.length - 1) cursor.setCursorId(rows[at + 1].id);
          return handled();
        }
        case "t":
          if (!targets.length) return;
          acts.date(targets);
          return handled();
        case "v":
          if (!targets.length) return;
          acts.move(targets);
          return handled();
        case "1":
        case "2":
        case "3":
        case "4":
          if (!targets.length) return;
          acts.priority(targets, PRIORITY_KEYS[e.key]);
          return handled();
        case "x": {
          if (!current) return;
          const next = new Set(cursor.selectedIds);
          if (next.has(current.id)) next.delete(current.id);
          else next.add(current.id);
          cursor.setSelectedIds(next);
          return handled();
        }
        case "Backspace":
        case "Delete": {
          if (!targets.length) return;
          const after = selection.length ? null : rows[at + 1] ?? rows[at - 1] ?? null;
          acts.trash(targets);
          cursor.setSelectedIds(new Set());
          cursor.setCursorId(after?.id ?? null);
          return handled();
        }
        case "a":
        case "A":
          if (!acts.add) return;
          acts.add(current, e.shiftKey ? "above" : "below");
          return handled();
        case "Escape":
          if (selection.length) {
            cursor.setSelectedIds(new Set());
            return handled();
          }
          if (cursor.cursorId) {
            cursor.setCursorId(null);
            return handled();
          }
          return;
      }
    };
    // Capture phase: the list hears its keys before the app-wide bubble
    // listeners, whatever order the effects happened to subscribe in.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/** The sort_order a new task needs to land beside `anchor` in `rows`. */
export function orderBeside(rows: Task[], anchor: Task | null, where: "below" | "above"): number | undefined {
  if (!anchor) return undefined;
  const i = rows.findIndex((t) => t.id === anchor.id);
  if (i < 0) return undefined;
  const neighbour = where === "below" ? rows[i + 1] : rows[i - 1];
  const a = anchor.sort_order;
  if (!neighbour) return where === "below" ? a + 1 : a - 1;
  const b = neighbour.sort_order;
  // Equal neighbours can't hold anything between them; land just past the anchor.
  if (a === b) return where === "below" ? a + 1e-3 : a - 1e-3;
  return (a + b) / 2;
}

