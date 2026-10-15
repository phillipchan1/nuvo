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
