// What an offer would do, shown before it is pressed (docs/offer-rules.md R3, D-216).
//
// An offer chip lives in the rail; the grid it would change lives in
// CalendarPane. Rather than threading a callback through every surface that
// mounts a chip (the week crown, the day list, the inbox), the chip writes the
// spot it points at here and the Schedule reads it. One preview at a time —
// the chip under the pointer or the keyboard.
//
// Nothing here writes data (P3): it is a picture of a destination, cleared the
// moment the pointer or focus leaves the chip, or the chip is pressed.

import { useSyncExternalStore } from "react";

export interface OfferPreview {
  /** the chip's identity — so only the chip that set it clears it */
  id: string;
  /** what the block would say on the grid */
  label: string;
  start: Date;
  end: Date;
}

let current: OfferPreview | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showOfferPreview(p: OfferPreview): void {
  if (current && current.id === p.id && current.start.getTime() === p.start.getTime() && current.end.getTime() === p.end.getTime()) return;
  current = p;
  emit();
}

/** Clears the preview — only if `id` still owns it, so leaving one chip can't
 *  wipe the one the pointer just entered. */
export function clearOfferPreview(id?: string): void {
  if (!current) return;
  if (id && current.id !== id) return;
  current = null;
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useOfferPreview(): OfferPreview | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
