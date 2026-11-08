import type { RecordUndoInput } from "../hooks/useUndoStack";

/**
 * A deck drag as one ⌘Z.
 *
 * The project and initiative decks write a span (start / target date) and a
 * status when a card is dropped. Before D-182's follow-up those writes went
 * straight to the store and ⌘Z skipped them, so a slipped drop could only be
 * repaired by dragging it back by eye. This writes the patch, then records the
 * exact fields it touched as they were — undo restores them, redo re-applies
 * the patch. Silent tier: like a calendar drag, the move is visible on the
 * grid already, so it rides ⌘Z rather than a toast.
 */
export function writeWithUndo<T extends object>(
  write: (patch: Partial<T>) => void,
  current: T,
  patch: Partial<T>,
  recordUndo: (input: RecordUndoInput) => void,
  label: string,
  shortLabel: string,
): void {
  const before = {} as Partial<T>;
  for (const k of Object.keys(patch) as (keyof T)[]) {
    // `undefined` would be dropped by the store; a field that was unset goes back to null.
    before[k] = (current[k] ?? null) as T[keyof T];
  }
  write(patch);
  recordUndo({
    label,
    shortLabel,
    tier: "silent",
    undo: () => write(before),
    redo: () => write(patch),
  });
}
