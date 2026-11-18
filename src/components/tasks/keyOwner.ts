/**
 * Which Schedule pane the list keys belong to — the rail or the calendar grid.
 *
 * Both speak `useTaskListKeys`, both listen on window in the capture phase, and
 * which listener hears a key first is whichever subscribed first — an accident
 * of mount order (the grid is lazy, so the rail usually wins). Two panes acting
 * on one ⌫ was the bug D-154 fixed for the rail's cursor; this is the general
 * rule: **the keyboard belongs to the last pane you pressed in.** A press in the
 * grid claims it for the grid, a press in the rail for the rail, and a press
 * anywhere else (a menu, the chat, a popover) leaves it where it was.
 *
 * A plain variable, not state: it changes inside the very pointerdown that may
 * start a drag, and re-rendering either pane there is what D-154 removed. The
 * hook asks it at keystroke time (`enabled` as a function).
 */

export type KeyPane = "rail" | "grid";

let owner: KeyPane = "rail";

export function keyOwner(): KeyPane {
  return owner;
}

export function claimKeys(pane: KeyPane): void {
  owner = pane;
}

/**
 * **The keys crossing panes by keyboard** — → off a rail row into the grid, ←
 * off the grid's first day back into the rail. The same claim a press makes,
 * plus a word to the pane receiving it so it can light a row: `taskId` is the
 * task the keys left from, so the other pane can land on that task's copy when
 * it has one (a scheduled task is a row in the rail AND a block on the grid).
 */
export interface KeyHandoff {
  to: KeyPane;
  taskId?: string | null;
}

const handoffListeners = new Set<(h: KeyHandoff) => void>();

export function handKeysTo(to: KeyPane, taskId?: string | null): void {
  owner = to;
  handoffListeners.forEach((fn) => fn({ to, taskId }));
}

export function onKeysHanded(fn: (h: KeyHandoff) => void): () => void {
  handoffListeners.add(fn);
  return () => {
    handoffListeners.delete(fn);
  };
}
